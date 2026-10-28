# Agent-Node Split Plan — One Node's Output, Many Node Runs

**Scope (design-first):** `lib/engine/nodes/kinds/agent/**` (`AgentDefSchema`, `AGENT_CONFIG_FIELDS`), a new generic split runtime under `lib/engine/runtime/`, `lib/engine/nodes/shared/{node-definition,capabilities}.ts`, consumer-side config knobs, the agent configurator.
**Principle:** this plan is written from the contracts out, not from the existing plan-step fan-out machinery. Where that machinery today does similar work (expansion, scheduling, join), it is *one possible carrier* for these semantics — the design must not inherit its plan-shaped assumptions. The migration question is deferred to the last section.

---

## 1. The model

Three independent roles, each owned by a different party:

```
┌────────────┐  publishes   ┌─────────┐  routes to   ┌─────────────────────┐
│ SOURCE node │ ──────────▶ │  UNITS  │ ───────────▶ │ TARGET              │
│ (agent, …)  │  units       │ (facts) │  per unit    │ template OR node key│
└────────────┘              └─────────┘              └─────────────────────┘
                                                              │
                                                 CONSUMER decides the mode:
                                                 whole    → one run, full output
                                                 per-unit → one run per unit
                                                 source   → the source recommends
```

1. **Source** — a node whose run produces *units*: a structured, addressable list of independent work items. Splitting is a fact about its output, declared declaratively (`def.split`). An agent node is the canonical source; any node with a structured output can be one.
2. **Target** — where a unit goes: **another template** (a declarative child flow) or **another node** (a builtin chain node key, e.g. `build`). The split config carries a default target; a unit may override it (heterogeneous routing: branch A → `build`, branch B → a docs template).
3. **Consumer** — the target node itself decides how it runs: **`whole`** (one run receiving everything — today's edge semantics, unchanged), **`per-unit`** (the engine instantiates one run/child flow per unit, then joins), or **`source`** (defer to the source's published recommendation). The *next node determines the behavior* — the producer never dictates execution.

This division is the point: an agent node that outputs 5 units says nothing about concurrency, child flows, or approval. Whoever consumes the output decides.

---

## 2. The contracts

### 2.1 Unit + source (producer side)

```ts
// lib/engine/nodes/shared/split.ts — port per AGENTS.md §3.2
export interface SplitUnit {
  /** stable identity across re-expansions (a re-run adds children for new
   *  units only — unchanged units keep their child runs) */
  key: string;
  title: string;
  /** declared ordering — the ONLY scheduling input. Eligible = all deps
   *  resolved + slot free. No inferred safety: the producer owns semantics. */
  dependsOn: string[];
  /** default target from the split config; a unit may override — a node key
   *  or a template id (resolution in §2.3) */
  target?: string;
  /** the unit's data — rides to the child as its input (`{{input.unit.*}}`).
   *  File scopes and every other domain attribute live HERE, in item data —
   *  the contract carries only what the engine reads (key, title, dependsOn,
   *  target). */
  item: unknown;
}

// NodeDefinition — default null = not a split source
splitUnits(ctx: FlowCtx): SplitUnit[] | null { return null; }

/** A source MAY publish a recommendation with its output (unit count,
 *  entanglement rationale) — honored only by consumers set to `source`. */
splitResolution?(ctx: FlowCtx): "whole" | "per-unit";
```

### 2.2 The declarative split on `AgentDef` (what makes an agent node a source)

```ts
// AgentDefSchema extension — absent ⇒ the node is not a source (no behavior change)
split: z.object({
  /** the output_schema array field to iterate — REQUIRED. The array is already
   *  schema-enforced by the output contract (AgentOutputError), so units are
   *  validated data by construction. */
  field: z.string(),
  /** per-unit key: the item path holding the stable unit id */
  key_field: z.string().default("key"),
  /** where units go by default: a node key or a template id */
  target: z.string().optional(),
  /** per-item target override path (optional heterogeneous routing) */
  target_field: z.string().optional(),
  /** per-item dependencies path (string[] of unit keys) */
  depends_on_field: z.string().default("dependsOn"),
}).optional()
```

- `AgentTemplateNode.splitUnits(ctx)` returns null without `def.split`, or when the run output's array is empty. Units are mapped from the validated output items — no second validation pass.
- **Prompt directive:** when `split` is set, `getPrompt` appends a short block: produce items that are unit-shaped (stable `key`; `dependsOn` for anything order-constrained — especially work sharing files or other resources). Same pattern as the existing output-contract directive; text lives in one place, appended after it. Anything item-level the producer wants to convey (file scopes, summaries) is item data — child and sibling prompts read it via `{{input.unit.*}}` / `{{input.siblings.*.item.*}}`, never through the contract.
- The agent node **never spawns anything**. It only answers "here are my units" through the port.

### 2.3 Target resolution (template OR node)

```ts
// one resolver, two kinds — registry-backed, no string switches at call sites
resolveSplitTarget(target: string, ctx: FlowCtx): SplitTarget;

type SplitTarget =
  | { kind: "node";     key: string }   // a builtin chain node in this flow (e.g. "build")
  | { kind: "template"; id: string };   // a declarative node_templates row
```

- **Node key** → the child flow instantiates a minimal graph of that node and runs it there (integration semantics: the child delivers its unit *into the parent* — merge-back for code — and the parent chain continues; the child flow still gets monitoring/approval/reconcile at flow granularity). This is how a plan's branches point at `build`.
- **Template id** → a declarative child flow of that template — **its entire graph runs** (delivery semantics: the unit is processed end-to-end in a self-contained sub-flow). This is the "whole child graph" case: author (or reuse) a template whose graph is the mini-chain a unit needs, and route units to it. The map-reduce case ("review each service in `services[]`") is the single-node special case of this.
- A target that matches both a node key and a template id is an authoring error (keys and template ids live in disjoint registries; assert it in the resolver).
- **Why node targets never mean "run the suffix from here":** with `plan → build → review → resolve` and per-unit build children, suffix semantics would run `review` N+1 times (per-branch reviews of *unmerged* code, then the parent's review of the merged whole) and force hidden "skip the parent's node, the children did it" logic. The author's decision rule: units that are **parts of one deliverable** route to a node target (integrate, one shared review); units that are **independent deliverables** route to a delivery template (each unit ships end-to-end). Mixing both in one source is allowed via `unit.target` override.
- Compatibility check at authoring time: a `template` target's start contract must accept the unit's item shape (`validateAgainstContract` from `kinds/start/contract`); a `node` target must declare a split-capable input (its `consume` knob, §2.4).

### 2.4 Consumer behavior (the next node decides)

```ts
// consumer-side knob — flat key `split_consume` in every config layer,
// same layering as every knob (class defaults ← app settings ← flow snapshot)
consume: z.enum(["whole", "per-unit", "source"]).default("whole")
```

- **`whole`** — the default and today's semantics: the source's output flows to the next node as one input. Zero new machinery on this path.
- **`per-unit`** — the engine expands: one run per unit of the *same node def* (a builtin node runs N times across child flows; a declarative node spawns N child flows of its template), each receiving `{ unit, parent, siblings }` as input, then **joins**: the node's output becomes the aggregate (array of per-unit outputs, in unit order), validated against the node's aggregate output contract. The sibling context carries generic facts (key, title, status, output summary) plus each sibling's `item` — so a consumer template that wants "avoid files other units own" renders it from sibling items; the contract itself stays file-agnostic.
- **`source`** — the consumer honors the source's published `splitResolution()` (absent ⇒ `whole`). This generalizes today's `from-plan` handshake: a recommendation with a rationale, overridable by the consumer's explicit choice.
- The knob lives on the **consumer's config** — different consumers of the same source can disagree (build consumes plan branches `per-unit`; a reporting node consumes the same branches `whole`).

---

## 3. The runtime (engine-owned, source-agnostic)

One new service class (`SplitManager`, `lib/engine/runtime/split/split-manager.ts` — §3.1 class, constructor-injected, the documented singleton pattern). Responsibilities — all mechanics, no domain:

- **Expansion** — on a consumer's run trigger with `consume: "per-unit"`: resolve units from the source (`splitUnits`), reconcile against existing children (new units get children; unchanged units keep theirs — `unit.key` stability), create child runs. Cycle detection on the unit DAG at expansion (a cycle is a producer error — loud, like a contract failure).
- **Scheduling** — start eligible units (deps resolved + free slot) up to `parallel_max` (default **1** — parallelism is opt-in). No file-overlap inference, no special-cased failure rules: a failed unit fails its dependents; non-dependents proceed.
- **Join** — collect child outputs, publish the aggregate on the consumer node (validated against its aggregate contract), release the parent to continue. A failed unit → the aggregate surfaces it; the consumer node holds at the appropriate status.
- **Actions** — skip/retry/approve/cancel per unit, addressed by `unit.key` through the generic child-flow linkage (below).

**Child linkage (recommendation 1):** unit ↔ child-flow association is derived from `flows` (`parent_flow_id` + the persisted child input's `parentNodeKey`/`unit.key`) — no new table, no schema change. The manager indexes per (parent, consumer) from one query; payloads are parsed at that point only. A `split_units` table stays the documented escalation path, behind the manager's narrow linkage interface.

**Nesting guard:** children never split (a `per-unit` consumer inside a child flow resolves to `whole`) — one level, enforced in the runtime, not by convention.

---

## 4. What is deliberately NOT in this design

- **No plan concepts.** No `plan_steps`, no plan-meta `execution`, no step ordering, no file-disjoint qualification, no failed-code-sibling stall. The plan node and build node become just the first (source, consumer) pair — see migration.
- **No orchestration in node classes.** Nodes publish units and declare consumption; the manager owns flows, scheduling, join. A node that wants different behavior writes a different `splitUnits()`/config, never flow-spawning code.
- **No new prompt/variable system.** Child input rides `{{input.unit.*}}`; the directive is an appended static block like the output-contract one.
- **No inferred safety.** If units share files and the producer didn't declare a dependency, they may run in parallel (up to `parallel_max`) — conflicts surface through the merge/conflict repair path where one exists. Declared semantics, mechanical guards.

---

## 5. Open decisions → recommendations (implementation-blocking; sign-off recorded here)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| 1 | Child linkage storage | **`flows`-derived, no new table.** Unit↔child association = child flow's `parent_flow_id` + the persisted child input's `parentNodeKey`/`unit.key`; the manager builds an in-memory index per (parent, consumer) from one query and parses payloads at that point (tens of units — negligible) | A snapshot table (`split_units`) re-creates the `plan_steps` sync problem — the exact subsystem whose reconciliation pain motivated this plan. Units are *derivable* (pure function of the source output); only linkage needs persisting, and the child flow already persists its input. Escalate to a table only on measured need: hundreds of children per parent, or a proven N+1 in the scheduling hot path |
| 2 | A child's graph shape | **The child always runs a whole graph — the target decides which.** `node` target → the minimal graph of that node (integration semantics: the child delivers its unit into the parent, the parent chain continues — review runs once on the integrated whole). `template` target → that template's **entire graph** (delivery semantics: a self-contained sub-flow runs the unit end-to-end). Do NOT add "run the suffix from the consumer node" — it double-runs the parent's post-consumer nodes (per-branch review + integrated review of the same code). Whole-child-graph delivery is expressed by routing the unit to a delivery template via `unit.target` — heterogeneous routing already supports mixing integration units and delivery units in one source. (Worked example with the `plan → build → review → resolve` chain is in §2.3.) |
| 3 | Multiple consumers of one source | **Per-consumer expansion — as a principle, not a default to revisit** | The expensive part (the source run that produced units) is shared regardless; re-expansion is mapping a validated array — free. Shared expansion would couple consumers' lifecycles, parallel limits and approval states (temporal-join semantics for no measured gain). The model's point is that different consumers choose different modes; that requires independent expansions. If a real duplicate-work case appears, add an opt-in shared-expansion key later |
| 4 | Aggregate ordering + partial failure | **Unit order + run-all with dependency cutoff.** A failed unit = failed entry in the aggregate; its dependents are never started and surface as `blocked` (visible, retryable); join publishes when no unit can advance; consumer node status = worst-of (failed > awaiting_approval > done) | Unit order is deterministic — stable across runs, diffable, testable; completion order is UI churn. Run-all honors "the trail shows what happened" and matches the existing rollup precedence (`childNodeStatus`: failed > awaiting > running > done). Fail-fast would discard independent work the producer deliberately declared unordered — contradicting the dependsOn contract |

---

## 6. Phased plan

### Phase 1 — Contracts only (types, schemas, resolver — zero behavior)

`SplitUnit`, `splitUnits()`, `splitResolution()`, the `AgentDef.split` schema, `resolveSplitTarget`, the `consume` knob schema — all landed with unit tests, nothing wired. The build stays green; no runtime path changes.

### Phase 2 — The split runtime

`SplitManager` with expansion/scheduling/join/actions against the contracts. Children are ordinary flows whose graph is the graph the target denotes: the node's minimal graph for `node` targets, the template's graph for `template` targets (recommendation 2). Demonstrated by a fixture source + fixture consumer in tests. The manager is still written against the narrow linkage interface (recommendation 1: `flows`-derived) so a future table swap, if ever needed, doesn't ripple.

### Phase 3 — The agent node as source

`AgentDef.split` knob + configurator fields (field/key/target pickers driven by `output_schema`); `AgentTemplateNode.splitUnits()`; the appended prompt directive. Config validation at authoring time: `field` is an array in `output_schema`, `key_field` resolves per item, targets resolve and are compatible.

### Phase 4 — Consumer modes

The `consume` knob on declarative defs and builtin config schemas; `whole` verified byte-identical on every existing edge; `per-unit` expansion + join through the manager; `source` honoring `splitResolution()`.

### Phase 5 — First real consumers + the plan/build migration

- A declarative smoke template (split → per-unit children → aggregate).
- **Plan as source:** `PlanNode.splitUnits()` returns branches (they already carry `dependsOn`); `build` consumes `per-unit` (or `whole` — its knob). This *replaces* the plan-node doc's Phase 6 machinery assumptions and retires the plan-step fan-out path and the `execution_default`/`from-plan` special cases — the published-execution recommendation becomes a plain `splitResolution()` on the source port. **This is the transition decision to schedule with the step-flows owner:** the existing runtime runs the flow graph until this plan's Phase 5 lands, then plan steps fan-out is deleted, not migrated. Deleting is the point — the generic runtime must be able to replace it, or the abstraction has failed.

---

## 7. Test plan

1. Contract/unit tests: unit mapping from output items (key/dependsOn/target selectors); target resolution (node key, template id, ambiguity error, compatibility check); cycle detection.
2. Runtime: expansion reconciles on re-run (new units added, unchanged keep children); scheduling = deps + slot; failed unit → dependents blocked, non-dependents proceed; join publishes the aggregate in unit order with a failed entry; skip/retry/approve/cancel per unit; nesting guard.
3. Agent source: `splitUnits` null when knob absent (byte-identical whole path); empty array → no expansion; authoring errors surfaced in the configurator.
4. Consumer modes: `whole` edge identical to today for every existing def; `per-unit` join output validated; `source` honors the recommendation, explicit consumer choice wins.
5. Definition of Done per phase: `npm run build` + `npm run lint` green; configurator loading/error/empty states; focused diffs.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Design drifts back into plan-shaped assumptions | §4 is the guardrail; the runtime imports nothing from plan modules; the smoke consumer in Phase 5 is non-plan |
| The generic runtime can't fully replace the plan-step path (Phase 5 fails) | Phase 2's runtime is judged against the plan/build migration explicitly — if a plan-specific behavior can't be expressed as units + declared deps + a consumer mode, that's a design bug to fix before migrating, not a reason to special-case |
| Parallel units without declared deps conflict (file-sharing) | `parallel_max` defaults to 1; conflicts route to the existing merge/conflict repair where the target is a code node; the prompt directive tells producers to declare deps |
| Child-linkage derivation proves too slow/clunky at scale | Escalation path documented: `split_units` table behind the manager's linkage interface — a bounded swap, no runtime rewrite |
| Children of `node` targets need builtin semantics (approvals, artifacts) | Node-target children are single-node flows at flow granularity — approvals/monitoring/reconcile already exist there; whole-graph delivery routes to `template` targets instead of suffixing node targets |
