# Plan Node Refactor — One Plan Mode, on the Agent-Node Infrastructure

**Scope:** `lib/engine/nodes/kinds/plan/**`, `lib/engine/flow-engine.ts` (plan entry points), `lib/engine/prompts/prompt-defaults.ts` (plan templates), `app/api/flows/[id]/action/route.ts`, `components/flows/plan/**`.
**Reference infra:** `lib/engine/nodes/kinds/agent/agent-node.ts` (`AgentTemplateNode`) and the tiers below it (`AgentRunNode.execute`, `NodeDefinition.applyOutcome`, `AgentOutputError`, `json-schema-lite`, `TemplateRenderer`/`TemplateComposer`).

## 0. The three decisions this doc implements

1. **One planning mode.** Simple vs complex is a false dichotomy: there is exactly one plan response schema (`markdown` + `steps` + optional `branches`). The `complex` input flag, the `default_complex` knob and the `plan_complex` / `plan_complex_refine` templates are deleted.
2. **Sub-plan is the only decomposition, and a branch is a child flow.** The planner decomposes into branches; each branch's sub-plan runs as its own child flow (the fan-out unit is the branch, not the step). The per-step `execution: "steps"` fan-out is retired in favor of branch child flows.
3. **Agent-node output validation, not PlanMetaParser.** The plan response is enforced by the standard output-contract machinery — `AgentOutputError.directive(schema)` on the prompt, shared `extractJson`, one bounded feedback retry on the same agent, loud failure after the retry. `PlanMetaParser`, `ParseModeConfig`, the `malformed` soft-fail output and `PlanFailureAlert` are deleted. Plan-specific rules (unique branch names, `dependsOn` resolution, step-id normalization) live in the zod schema itself.

`PlanNode` keeps what is genuinely plan-domain: PromptLibrary templates, the context-block registry, deterministic merge/diff, checklist sync, scoped refines. Everything else it copied from before the agent-node infra existed is replaced by that infra.

---

## 1. Findings (evidence, not vibes)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Two response schemas for one job — `ComplexPlanResponse` is `SimplePlanResponse` + optional `branches`; every consumer of "the plan meta" treats branches as optional anyway | `kinds/plan/schema.ts:69-117`; `plan-node.ts:388-393` collapses them back into one `PlanMeta` shape |
| F2 | The `complex` mode forks the entire pipeline: two templates, two refine templates, a config knob, an input flag, a mode selector in `generatePlan` — for a schema that differs by one optional field | `plan-node.ts:253,295,315,527-528,816-820`; `prompt-defaults.ts:107,151`; `flow-engine.ts:622,632`; `action/route.ts:19,38-39` |
| F3 | `PlanMetaParser` re-implements the agent-node output contract badly: private `extractJson` (duplicate of `json-schema-lite.ts:123`), a bespoke `PlanParseResult` shape, hand-written schema hints + requirement lines as prompt text, and a hand-rolled retry loop (`generatePlan`) that duplicates `applyOutputWithRetry`/`retryOutput` (`agent-node.ts:321-387`) | `plan-meta-parser.ts:24-71`; `plan-node.ts:832-880` |
| F4 | The soft-fail contract (`malformed: true` + `validationErrors` in the output column, previous artifact kept) is a parallel failure path agent-node already replaced with a loud, typed failure after one retry — and it leaks into the UI (`PlanFailureAlert`) | `plan-node.ts:460-480,1053-1063`; `components/flows/plan/PlanFailureAlert.tsx:21` |
| F5 | PlanNode hand-rolls the run lifecycle `execute()` owns (running status, recorded input blob, runner execution) and the persistence tail `applyOutcome` owns — in two places (`finalizePlan`, `runScoped`), already drifted in event wording | `plan-node.ts:345-347,363,1045-1060,705-720` vs `agent-run-node.ts:105-127`, `node-definition.ts:272-290` |
| F6 | `recover()` hand-persists instead of routing through `applyOutcome` (the byte-identical-rows guarantee agent-node's recover gets for free) | `plan-node.ts:1055-1130` vs `agent-node.ts:296-301` |
| F7 | Prompt internal blocks (schema hints, requirements, retry text, `executionDirective`) are `join("\n")` arrays duplicating what `TemplateComposer` + `AgentOutputError.directive()` exist to provide | `plan-node.ts:124-140,558-577`; `template-composer.ts`; `agent-output-error.ts:64-75` |
| F8 | Config layering re-implemented: `executionDefault()` re-merges `defaultConfig() ← appLayerConfig ← nodeByType(...).config` defensively, vs the base's `nodeConfig(ctx)` | `plan-node.ts:993-1008` vs `node-definition.ts:226-229` |

---

## 2. Target architecture

```
PlanNode.run(ctx, input, config)                    // input: no `complex`, no `default_complex`
│
│  prompt = buildPlanPrompt(...) | buildScopedPrompt(...)      // PromptLibrary, unchanged
│           + AgentOutputError.directive(PLAN_RESPONSE_JSON_SCHEMA)   // replaces WHOLE_PLAN_SCHEMA_HINT etc.
│
└─ return this.execute(ctx, {                       // AgentRunNode lifecycle (F5 gone)
     input: { ...input, prompt },
     prompt,
     agent: { mode: "plan", name, model, customSubagents, settingSources, followUpOn },
     label,
     finalize: (result) => this.applyPlanOutput(ctx, result, scoped),
   })

applyPlanOutput(ctx, result, scoped)                // plan's twin of applyOutputWithRetry
│  1. extractJson(result)                // shared json-schema-lite
│  2. PlanResponseSchema.safeParse()     // ONE schema; plan rules as superRefine
│     - scoped: SubPlanResponseSchema instead
│  3. failure → ONE feedback retry on lastAgentId (retryOutput pattern), then throw
│     AgentOutputError                    // loud fail — no `malformed` output
│  4. success → save artifact + checklist sync + (scoped) mergeBranchRefine
│  5. return outcome WITHOUT artifact → applyOutcome persists it
```

### Response schema (the one that replaces three)

```ts
// kinds/plan/schema.ts — the single whole-plan response
export const PlanResponse = SimplePlanResponse.extend({
  branches: z.array(PlanBranch).optional(),
})
  // plan-domain rules become schema, not parser code:
  .superRefine((val, ctx) => {
    // unique branch names; dependsOn references resolve; step.branch ∈ branches;
    // step-id normalization + duplicate detection (moved from validateComplexPlan /
    // normalizeStepIds — same messages, so the retry feedback text is unchanged)
  });
```

`SubPlanResponse` stays (scoped refines are a genuinely different contract) but is validated through the same machinery. `SimplePlanResponse` / `ComplexPlanResponse` / `validateSimplePlan` / `validateComplexPlan` / `validateSubPlan` / `PlanValidationError` / `PlanMetaParser` are deleted.

### Fan-out: branch child flows via a shared unit-source contract

With complex mode gone, decomposition is branches only. The branch is the child-flow unit.

**Where fan-out support lives (decision):** fan-out orchestration stays in the engine (`StepFlowManager` + the `startNodeStage` gate) — it does **not** move into `AgentTemplateNode`. Spawning, scheduling (`parallel_max` + the declared-`dependsOn` DAG), merge-arena serialization and join/aggregate-back are orchestration, and the runtime module is already documented as deliberately template-generic. `AgentTemplateNode` is the most generic node class in the system (one instance per template row, config = `AgentDef`); baking orchestration into it inverts the node-runs/orchestrator-wires layering and accretes the god-class the NodeDefinition plan warned about (F9 there). `PlanNode` also cannot inherit from it: plan is a builtin-chain node, agent is a declarative instance class — cross-kind subclassing is the F12 smell.

What *is* shared is the **unit-source contract** — the piece that is plan-coupled today because `StepFlowManager` hard-reads `plan_steps` rows. Extract it as an overridable on `NodeDefinition` (or a `SplitSource` port in `lib/engine/ports/`, §3.2):

```ts
/** One unit of fanned-out work. `dependsOn` is the scheduling contract:
 *  eligible = all deps resolved + slot free — a declared DAG. The old
 *  file-overlap qualification is retired (see below): it was an inference
 *  heuristic for plan steps, whose schema has no dependency field; branches
 *  declare dependencies directly. Named `SplitUnit` in the divergent plan. */
interface SplitUnit {
  key: string;          // stable identity — step id / branch name
  title: string;
  dependsOn: string[];  // declared ordering — plan branches already carry it
  /** where this unit goes: a node key or a template id (unit may override
   *  the source's default target) */
  target?: string;
  item: unknown;        // the unit's data (incl. file scopes) — {{input.unit.*}}
}

// NodeDefinition (default null = not a split source)
splitUnits(ctx: FlowCtx): SplitUnit[] | null { return null; }
```

- `PlanNode.splitUnits(ctx)` → the plan's **branches** (with sub-plan prompts as the child work order).
- `AgentTemplateNode` participates **declaratively**: a `split: { field, target, … }` config knob maps over a JSON output array — no imperative orchestration in the class, and declarative templates get map-reduce over their output for free.
- Consumer behavior is the next node's knob (`consume: whole | per-unit | source`) — the source publishes units and may recommend; it never dictates execution. `StepFlowManager`-class scheduling becomes **declared-dependency only** (`dependsOn` + `parallel_max` — merge arena, stale-base repair and the merge-fix path remain the mechanical guards). The file-disjoint qualification rule and the failed-code-sibling stall retire with the heuristic; the declarative plan lives in `docs/agent-node-divergent-support-plan.md`.
- The port is justified by the two-consumer rule: plan branches + declarative list fields is exactly the second consumer that moves it out of feature-local code.

**Migration cost to scope honestly (Phase 6):** the child trigger payload (`{plan, step, siblings}`), the `plan_steps.sub_flow_id` linkage, and the parent fan-out panels are plan-step-shaped. Re-pointing the unit to branches is a payload + UI change on the engine side — independent of where the extraction contract lives.

**Open decision (needs step-flows owner):** the `execution_default` knob collapses to `whole | follow` — `"steps"` (per-step child flows) is superseded by branch child flows. If per-step fan-out is still wanted for branch-less plans, keep `"steps"` as-is and let branch plans simply not use it; decide before Phase 1 ships.

---

## 3. What gets deleted

| Artifact | Where | Phase |
|---|---|---|
| `plan_complex`, `plan_complex_refine` templates + their `prompt-defaults` entries + `check-prompt-splits.ts` entries | `prompt-defaults.ts:107,151`, `scripts/check-prompt-splits.ts:45,73` | 1 |
| `complex` input flag, `default_complex` knob + config field | `schema.ts:254`, `plan-node.ts:295,315` | 1 |
| `planMode()`, `ParseModeConfig`, the `isComplex` plumbing through `run/generatePlan/finalizePlan/recover` | `plan-node.ts:816-820` and call sites | 1+2 |
| `SimplePlanResponse` / `ComplexPlanResponse` / the three `validate*Plan` functions / `PlanValidationError` | `schema.ts:69-117,121-238` | 2 |
| `PlanMetaParser` (whole file, incl. its private `extractJson`) + `plan-node.ts`'s `parser` field | `plan-meta-parser.ts` | 2 |
| `generatePlan()` retry loop, `runAgent()`, `finalizePlan()`/`runScoped()` persistence tails, manual `setNode(running)` + `recordInput` in `run()` | `plan-node.ts` | 3 |
| `malformed` / `validationErrors` from `PlanOutput`, and `PlanFailureAlert`'s malformed branch | `schema.ts:279-281`, `PlanFailureAlert.tsx` | 2 |
| `execution_default: "steps"` (pending the §2 open decision) | `plan-node.ts:308` | 6 |
| `recover()`'s hand-rolled persistence | `plan-node.ts:1055-1130` | 4 |

---

## 4. Phased plan

### Phase 1 — One plan mode (delete complex)

- Merge `ComplexPlanResponse` into `PlanResponse` (= `SimplePlanResponse` + optional `branches`). `buildPlanPrompt` uses `plan` / `plan_refine` unconditionally.
- Delete the `complex` input flag; update `startPlan`/`refinePlan` signatures and the `start_plan`/`refine_plan` action builders (`flow-engine.ts:622,632`, `action/route.ts:38-39`).
- Delete `default_complex` from `configSchema`/`configFields` and the two templates from `prompt-defaults.ts` + `check-prompt-splits.ts`.
- **Migration:** recorded inputs of in-flight nodes may carry `complex: true` — `PlanInput` parsing ignores unknown keys after the flag is removed (zod strips them by default with `.strip()`); a retried in-flight complex run re-runs as a plain plan. Acceptable: complex was never persisted differently (same artifact kind, `branches` already optional).
- **Deviation D1 (product-visible):** the "Default to complex plans" toggle disappears from plan settings. Existing configs that set it are ignored (unknown knob).

### Phase 2 — Agent-node output validation (delete PlanMetaParser)

- Prompt contract: append `AgentOutputError.directive(z.toJSONSchema(PlanResponse))` where the hand-written `WHOLE_PLAN_SCHEMA_HINT` block is today; `SubPlanResponse` likewise for scoped. `AgentOutputError.directive` already renders "one JSON object + schema + error envelope".
- Validation: shared `extractJson` → `PlanResponseSchema.safeParse` → on issues throw `AgentOutputError({ code: SCHEMA_MISMATCH, issues, response })`; unparseable → `NO_JSON`; agent self-report envelope → `AGENT_REPORTED`. Plan-domain cross-checks (branch uniqueness, `dependsOn`, step ids) are `superRefine` inside the schema so they ride the same `issues` payload and the same retry feedback.
- Retry: mirror `retryOutput` (`agent-node.ts:337-387`) — one feedback turn on `lastAgentId`, the specific issues as the feedback, the directive re-appended. Per-plan retry flavor (scoped retry stays scoped) is preserved by which schema's directive is re-appended.
- **Deviation D2 (failure semantics — the intended behavior change):** a plan that is still invalid after the retry **fails the node loudly** (`AgentOutputError` → failed status, manual Retry) instead of soft-failing with `malformed: true` and keeping the old artifact. The old artifact is kept anyway (no new version is saved on failure — same end state as today's scoped path), but the node row/output shape and `PlanFailureAlert` change: the malformed branch is deleted, and the alert renders the standard error payload. Coordinate the UI diff in the same PR.
- **Deviation D3 (envelope):** agents can now answer with the standard error envelope ("cannot comply") instead of garbage — a new, deliberate response path agent-node already supports.

### Phase 3 — `run()` through `execute()` / `applyOutcome()`

- `run()` = prompt building + one `this.execute(ctx, {...})` call (`agent-run-node.ts:105-127` owns running status + input blob + runner). `opts.input = { ...input, prompt }` preserves retry fidelity (recorded prompt = exact final text).
- `finalize` (`applyPlanOutput`) does Phase 2's validation, then the plan-domain work: artifact save + checklist sync (`persistPlan`), scoped merge (`mergeBranchRefine` + `replaceBranch` + `diffBranchSteps`), and returns the outcome. Artifact is saved in `finalize`, **not** via `outcome.artifact` — the output blob needs the artifact id/version (invariant I2 below). `applyOutcome` then persists status/agent-cursor/validated output/event, deleting the duplicated tails in `finalizePlan` and `runScoped`.
- **Deviation D4 (none behavioral):** `setNode(running)` now happens before `prepareScopedRefine`'s reads instead of after; both are synchronous reads on the same tick.

### Phase 4 — `recover()` through `applyOutcome()`

Keep the scoped-decline guard and the parse cascade (now: `extractJson` + `PlanResponseSchema`), build the same outcome a normal finish would, and call `this.applyOutcome(ctx, outcome, { note })` — recovered rows become byte-identical to a normal finish except the event note (`agent-node.ts:296-301` is the template).

- **Deviation D5 (event text):** the bespoke sentence `plan recovered (note) — ready for review` becomes `event (recovered: note)`. If the wording is load-bearing for feed tests, compose it into `outcome.event` and pass no `note`.

### Phase 5 — Prompt internal blocks on composer infra (opt-in, separate PR)

- `executionDirective` and the retry feedback text move to `TemplateRenderer.compose()` (`section()`/`addLines()` give skip-empty semantics). Byte-identical output asserted by snapshot.
- The directive's schema block is generated from the zod schema (Phase 2 already did this for the run prompt); the hand-maintained schema examples inside `prompt-defaults.ts` plan templates become a docs concern, not a runtime contract. Full generation of the template bodies is out of scope.

### Phase 6 — Branch child flows via `splitUnits()` (coordination phase, may be its own RFC)

Extract the `SplitUnit` / `splitUnits()` contract (§2 "Fan-out"): `PlanNode` sources branches, `AgentTemplateNode` maps a declarative output field, the generic split runtime (`docs/agent-node-divergent-support-plan.md`) replaces the `plan_steps`-reading machinery and schedules on declared `dependsOn` only. Re-point the child payload and fan-out panels from steps to branches; update the plan prompt's execution directive — "keep `files` disjoint" becomes "declare `dependsOn` between branches that share files" (the branch schema already validates `dependsOn` references; add a cycle check); resolve the `execution_default` open decision from §2 (its `from-plan` handshake becomes the generic `consume: "source"` + `splitResolution()` pair); update the plan panel's execution chip and approve-time override (`flow-engine.ts:1178-1195` writes `executionSource: "override"` — same meta, new value domain). Orchestration stays engine-side — no split logic enters either node class.

---

## 5. Invariants (what must survive untouched)

1. **Deterministic scoped refine.** `mergeBranchRefine` / `diffBranchSteps` / id-preserving merge are pure and stay as-is; a scoped retry never re-emits the full plan.
2. **Artifact-before-output.** The output blob derives from the just-saved artifact row (id, version, meta with `execution`/`scopedRefine` provenance) — the reason `finalize` saves the artifact itself.
3. **Prompt byte-parity for surviving templates.** `plan`, `plan_refine`, `plan_subplan_refine` bodies, `prompt_rules` placement, verbatim `input.prompt` path, and `promptIsBody` re-assembly produce identical text before/after (snapshot-tested). The only intended prompt delta is Phase 2's directive block replacing the hand-written schema hint.
4. **Builtin-chain affordances.** PromptLibrary templates, `capabilities`, `builtinApproval`, `chainRole`, `resourceArtifacts`, hardcoded `awaiting_approval` (the plan is always an approval gate — agent-node's trigger-driven `holdsForApproval` does not apply), `converse()` inherited unchanged.
5. **Context-block registry** (`CONTEXT_BLOCKS`, `assembleContext`, picker contract) — plan-only domain logic, no infra overlap.

---

## 6. Test plan

1. Schema tests: `PlanResponse` superRefine carries the old `validateComplexPlan` messages verbatim (the retry feedback text depends on them); step-id normalization identical.
2. `applyPlanOutput`: valid plan → `awaiting_approval` + artifact meta (`execution`, `executionSource`); NO_JSON → retry once on same agent → loud `AgentOutputError` after second failure; agent error envelope → immediate loud fail with the agent's reason; scoped variant stays scoped across the retry.
3. Scoped merge: other branches byte-identical; unknown `branchRef` falls back to whole-plan with the lifecycle note; scoped recovery still declined.
4. Prompt parity snapshots for: base run, feedback refine, `promptIsBody` modal edit, scoped refine, `follow`-mode run — before/after each phase.
5. Recover: recovered finish produces the same node/artifact rows as a normal finish except the event note.
6. Definition of Done: `npm run build` + `npm run lint` green per phase; UI loading/error/empty states re-verified where `PlanFailureAlert` changed; diffs focused per phase.

## 7. Risks & coordination

| Risk | Mitigation |
|---|---|
| In-flight flows recorded with `complex: true` (D1) | Zod strips the key; retried runs degrade to plain plan — document in the PR, no data migration |
| UI coupling to `malformed`/`validationErrors` (D2) | `PlanFailureAlert` rework ships in the same PR as Phase 2; error payload is richer (codes, issues, response excerpt) |
| Retry feedback text drift after validator swap (D2) | Message-parity tests against the old `validate*Plan` messages |
| Fan-out unit change touches step-flows (Phase 6) | Separate phase + RFC; `execution_default` decision owned by step-flows |
| Config-layer tolerance for malformed `config` column (F8 fix in Phase 3) | Verify `mergeConfigLayers` before dropping `executionDefault`'s try/catch; keep a guard + flag upstream if not (AGENTS.md §2.10) |
- Phases 5–6 implemented: the execution directive renders on the TemplateComposer (skip-empty part semantics, no `join` array), and plan branches are the split runtime's units — `PlanNode.splitUnits` publishes one unit per branch (target `build`, item carries the branch contract + the plan document) and `splitResolution` publishes the resolution the `split_consume: "source"` build honors (knob whole → whole; legacy knob steps → per-unit; follow → the published version meta).
- The legacy per-step `StepFlowManager` machinery remains but is dormant by default (build's fan-out knob stays `whole`); per-step fan-out is superseded by per-branch child flows, not deleted.
