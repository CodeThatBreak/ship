# Step Sub-Flows — Plan Fan-out with Per-Step Monitoring

Date: 2026-10-25 · Status: **implemented — phases 1–4 shipped** (rev 3 — fan-out is a
node-instance property, not a BuildNode internal (rev 2), and the whole/steps mode
resolution moved to the **plan node** so downstream contracts stay fully static.
Phase 4 added the monitoring surface: per-step cost/duration rollups on the parent
cards + graph subtitle, aggregate badge states on the fan-out node card, per-step
cost in the run-summary tooltips, a home-list step-progress line, and a
`seed:demo:fanout` variant that samples the UI mid fan-out)

## Goal

Today a complex plan is built by **one agent run**: the checklist is injected into the
build prompt, the agent reports back a `build-progress` block, and one aggregate
branch diff is all the user gets to review. The per-step checkmarks are
**self-reported claims** — nothing links a step to the code the agent actually
wrote for it (`plan_steps.files` is stored but nothing consumes it on the build side).

This plan adds **plan fan-out**: any node that runs *after* a plan node can, by
config, be expanded into **step sub-flows** — one real child flow per pending plan
step, each running that node's work on its own input slice, monitorable from the
flow screen the user already knows (graph, run activity, chat, diff, stop/retry,
approval).

- For the **built-in build node** this means: per-step branch, per-step diff, per-step
  approval gate, merge-back into the integration branch — the full per-step code
  story.
- For a **custom node** (agent / script / decision fan-out targets…) this means: the
  node's work runs once per step with step-scoped inputs, each child monitorable and
  individually approve-able or re-runnable, with child outputs aggregated back into
  the parent node's output contract for downstream mapping.

Defaults never change: fan-out off (`mode: whole`) keeps today's single-run behavior
byte-for-byte, for built-ins and custom nodes alike.

## Locked decisions (from design discussions 2026-10-25)

| Decision | Choice | Rationale |
|---|---|---|
| Where fan-out lives | **A knob on any node instance** (`flow_template_nodes.config` / runtime `nodes.config`), not inside a node class | The mechanism is orchestration; `plan → custom agent node` must decompose exactly like `plan → build` |
| What triggers expansion | The flow's `plan_steps` checklist (pending rows), resolved from whatever upstream plan node exists — checked at the moment the fan-out node's trigger fires | Checklist is already per-flow, def-agnostic state |
| Child shape | **Child template**: built-in `step-build` for code work; otherwise a *auto-wrapped copy* of the same node (same `node_templates` row + config snapshot + trigger type), step context as trigger payload. Any gallery template can be chosen explicitly | Built-ins get merge-back semantics; custom nodes get their exact configured behavior per step; no special-casing in the manager |
| Merge-back | **A capability hook (`mergeBack`), not the mechanism.** Children whose node def implements it (today: only `step_build`) get merge/branch lifecycle; everything else runs to terminal and aggregates | Branch machinery only makes sense for repo-writing children; the manager stays node-agnostic |
| Sub-flow granularity | **One node chain, not a full SDLC.** Children never gain plan/CI/review/resolve of their own | Per-step MRs = stacked-MR hell and CI ×N; those stay parent-level (one MR, one gate) |
| Branching (code children) | Branch per child, merged back into the parent integration branch on approve. No per-step MR | The step branch is a *scoping unit, not an MR unit*; merge commit annotated with the step id is the audit trail |
| Default | `mode: whole` for every node | N agent runs cost tokens and time; fan-out earns it only on complex plans |
| Parallelism | **Sequential by default**, capped by `parallel_max`; qualified parallel for steps with disjoint `files` and no overlap | Parallel siblings can't see each other's code; merge-back is the only enforcement — serialize anything unqualified |
| Context | Child build agents resume the parent build agent session lineage where possible; otherwise a **context pack** (whole plan + own step + sibling summaries). Custom-child prompts read the step context via their own input mapping | Split runs must know what the others are doing or they build against stale assumptions |
| Conflicts (code children) | Merge-back conflict → bounded **merge-fix agent** on the step branch (code failures), handback to the user (infra failures) | Reuses the commit-fix classification pattern |
| Completion | Parent node holds as **orchestrator** until every child is terminal, then publishes an **aggregate output contract** and `advance()`s downstream as one node | The fan-out replaces the *run*, not the node: downstream wiring, approvals and contracts are unchanged |
| Relation to custom-flows | **Different thing.** Runtime fan-out of a plan checklist, not "template as a node inside a template" (custom-flows-plan §12 stays open) | Avoid two features colliding on the word "sub-flow" |
| Mode resolution | The **plan node** publishes the resolved execution (`whole`/`steps`) in **plan-meta** — knob `execution_default` (`whole` default / `steps` / `follow` = planner decides, opt-in), user override at plan approve. Fan-out nodes honor it via `mode: from-plan`; a runtime checklist coin flip exists nowhere | The checklist size is only a runtime secret *downstream* of the plan; at the plan node it is known and the user is watching. Keeps downstream contracts fully static |

## Architecture overview

```
Plan node (checklist via plan-meta)  ── advances ──►  any downstream node X (builtin or custom)
                                                        │ trigger fires, X's fanout.mode ≠ whole
                                                        │ StepFlowManager.expand() reads plan_steps
                                                        ▼
        ┌────────────────── X (parent) = orchestrator: node status 'running', no direct run ──────────┐
        │  child flow s1: template T  → node run (step-scoped input) → [approval per trigger] → terminal
        │  child flow s2: template T  → node run → …                                                 │
        │  child code children additionally: own branch → per-step diff → [approve] → merge-back      │
        └─ all children terminal (done/skipped/failed-handled) → aggregate output → advance()         │
                                                                                                      ▼
                                          … downstream nodes / (build chain: aggregate diff → MR → gate → review → resolve)
```

For the SDLC loop, X = build: children land on the integration branch, the parent's
final approval creates the MR through the untouched existing chain. For a custom
template (`plan → acme_docs → notify`), X = acme_docs: children each produce their
output (artifact/JSON), the parent publishes the aggregate, `notify` maps from it —
and never knows fan-out happened.

## 1. Config and validation

### The fan-out knob (third knob layer, per custom-flows-plan §1)

Fan-out is config on the node instance, valid on any node whose template position is
downstream of a plan node:

```jsonc
{
  "fanout": {
    "mode": "whole" | "steps" | "from-plan",   // from-plan: the plan-meta 'execution' decides (see below)
    "child": null,                // flow template id; null = auto-wrap (see below)
    "parallel_max": 1
  }
}
```

- `configFields` descriptors render the same auto-form UI as every other knob.
- **`lintTemplate` extension** (`lib/engine/context-lint.ts`), four rules:
  1. a node with `fanout.mode != 'whole'` must be downstream of a plan key;
  2. a set `child` must resolve to an existing template;
  3. the child template must contain **no `plan` / `pipeline` / `review` / `resolve`
     node and no fan-out knob of its own** — the "children never gain a full SDLC"
     and "no nesting" locked decisions are **enforced here, not just declared**.
     This closes a real loophole: the SDLC loop *is* a gallery template, so without
     rule 3 Phase 3C lets a user pick it as a child and rebuild the stacked-MR hell
     this plan forbids;
  4. upstream-contract computation (static resolution of `{{nodes.X.output.*}}`
     refs from downstream nodes) uses the **effective fan-out contract** of the
     referenced node — fully static (see "who decides the mode" below):
     `whole` ⇒ the node's declared schema; `steps` and `from-plan` ⇒ the fan-out
     aggregate shape. Both are authoring-time statements; no runtime coin flip.
- The built-in build's fan-out child, when unset, defaults to the seeded
  `builtin/step-build` template at runtime (a fallback default, not a hard binding —
  every other node auto-wraps itself, next section).
- **`mode: from-plan`** — honors the execution mode the **plan node** published.
  The section below explains why the decision lives there.

### Who decides the mode: the plan node

The checklist size is only a runtime secret *downstream* of the plan. At the plan
node it is **known** (the checklist was just written) and the user is **watching**
(plan approve is already a human decision point). So the resolution lives there:

- **Plan node knob `execution_default`: `whole` (default, frozen) | `steps` |
  `follow`** — the planner decides per plan version under `follow` (opt-in). The
  resolution is published with every plan version in **plan-meta** (`execution`
  field + a one-line rationale when `follow` decided — `PlanMetaParser` output and
  artifact meta, versioned like every other plan-meta field). The plan panel shows
  the resolution at approve: "will execute: step-by-step (7 steps)". Refining the
  plan re-decides it — which is exactly right, since refinement is also what
  changes the checklist size. The published value follows one precedence:
  **plan-node knob (`whole`/`steps`) > planner's plan-meta value (under `follow`)
  > `whole`**, and every resolution is written to `artifacts.meta` with the final
  merge, so the effective mode is auditable per plan version.
- Note the deliberate separation from the plan node's existing `decompose_default`
  knob: *branch decomposition* decides **what splits** (multiple MRs/branches);
  `execution_default` decides **how the checklist executes**. Independent knobs,
  different questions.
- **Contract consequence:** `from-plan` nodes publish the **aggregate shape
  unconditionally** — when the plan resolved `whole`, the fan-out node runs the
  whole path but wraps its native output as a single-entry aggregate
  (`steps: [{id: "whole", title: <ticket>, output: <native output>, status: "done"}]`).
  Downstream refs into a `from-plan` node are therefore **always**
  `{{nodes.X.output.steps.*}}` — statically checkable at template save and stable
  across plan revisions that change the checklist size. The native output schema
  survives only for explicit `mode: whole` (the frozen default). The whole/steps
  duality is confined inside the fan-out node; downstream templates never see it.
- Any explicit `whole`/`steps` on a fan-out node **overrides** the plan's published
  `execution` (an authoring-time statement beats a plan-time statement), and the
  override is recorded in the events.
- `auto_min_steps` is gone as a knob: under `follow` it survives only as a
  **planner hint** ("consider step execution above ~N steps" — prompt context), not
  a threshold bomb that fires downstream.

### Auto-wrap of a node as its own child template

When `child` is null *and* the node is not the built-in build:

1. Find-or-create a hidden **child template** named `{node label} · step`: one node
   instance of the same `node_templates` row, config copied exactly,
   `input_map` untouched, **trigger type: `approval` if the parent's is `approval`,
   `auto` otherwise** (an approval parent's gate *becomes* the per-step gates —
   the parent itself never gates in fan-out mode).
2. At runtime the child flow snapshots this template; the manager feeds its trigger
   payload `{plan, step, siblings}` and its input mapping reads
   `{{trigger.payload.step.title}}` / `.detail` / `.files` / `.id`, plus `{{ticket}}`
   / `{{repo}}` / flow context as usual.
3. **No new variable system.** Free-text config fields (declarative agent prompts,
   built-in prompt bodies) render the *existing* standard variables in step mode:
   `{{plan}}`, `{{step.id}}`, `{{step.title}}`, `{{step.detail}}`, `{{step.files}}`,
   `{{siblings}}` — PromptLibrary for built-ins, declarative `{{vars}}` rendering
   for custom nodes. Composition of current renderers; nothing fan-out-specific.

### Capabilities (`lib/engine/nodes/base/capabilities.ts`)

`NodeCapabilities` gains:

```ts
interface NodeCapabilities {
  // existing: panelTitle …
  mergeBack?: MergeBackHook;        // code children: branch lifecycle for fan-out
  fanoutOutput?: z.ZodTypeAny;      // overrides outputSchema when this node fans out
}
```

Only the `step_build` def implements `mergeBack` (§4). Every fan-out-capable def
publishes a `fanoutOutput` contract; a generic default exists:

```ts
{ steps: [{ id, title, status, branch?, artifact_id?, output? }] }
```

Persist-time validation (`parseOutput`) applies whenever the node publishes the
aggregate contract (`mode: steps`, or `from-plan`, where the aggregate is
unconditional — a wrapped whole-resolution result carries `step.id: "whole"`, so
downstream code can distinguish it), and `{{nodes.X.output.steps.0.output}}`
 resolves in downstream mappings
(types displayed in the configurator Contract tab, as contracts are today). The v1
variables-only rule (custom-flows-plan §5) still governs: aggregates carry
**summaries and artifact references**, never large content — step content stays in
artifacts and reaches prompts through prompt variables as always.

## 2. Data model

Idempotent migration in `lib/db/index.ts` (same `ALTER TABLE` + column-verify pattern
as every existing migration).

```sql
ALTER TABLE flows ADD COLUMN parent_flow_id TEXT REFERENCES flows(id);  -- set on child flows
ALTER TABLE flows ADD COLUMN kind TEXT NOT NULL DEFAULT 'sdlc';         -- sdlc | step
ALTER TABLE plan_steps ADD COLUMN sub_flow_id TEXT REFERENCES flows(id); -- step ⇄ sub-flow linkage
ALTER TABLE flow_templates ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;  -- auto-wrapped child templates (excluded from gallery/counting)

-- durable fan-out + merge-back record so restarts/reconcile can resume or flag stuck work
CREATE TABLE IF NOT EXISTS step_merges (
  id             TEXT PRIMARY KEY,
  flow_id        TEXT NOT NULL REFERENCES flows(id),   -- child flow
  parent_flow_id TEXT NOT NULL REFERENCES flows(id),
  parent_node    TEXT NOT NULL,                        -- the fan-out node key (e.g. 'build')
  branch         TEXT,                                 -- step branch (code children only)
  status         TEXT NOT NULL DEFAULT 'running',      -- merged | conflict | failed (NULL branch ⇒ non-code children don't create rows)
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

Semantic notes:

- **`plan_steps.status` is unchanged** (`pending | done`); it becomes `done` only
  when the child merges/succeeds (or the step is skipped). Live per-step state
  (building / awaiting-approval / conflict / failed) derives from the child flow row
  + its node, not new columns.
- Child flows are ordinary `flows` rows: `task_id`, `repo_id`, `execution_mode`,
  settings copied from the parent; `name = "{parent name} · step: {title}"`. This is
  what makes existing per-flow machinery (agent runners, chat, artifacts, retry/
  cancel, reconcile) work on children with **no changes**.
- Children are created through the **same template-start machinery as any flow**
  (`startFromTemplate` snapshot + trigger payload): when the chosen child template
  declares a start contract, the `{plan, step, siblings}` payload is validated
  against it exactly like a webhook delivery (unknown fields rejected, missing
  required fields fail loudly). Auto-wrapped templates declare no start node, so
  the payload flows straight into input mapping and prompt variables.
- Local-mode children get their own worktrees via the existing `ensureFlowWorktree`
  (keyed by the child flow id, one step branch each); the worktree lifecycle sweeps
  them when the child goes terminal — N steps ⇒ N transient worktrees, bounded by
  the existing sweep, never permanent.
- Home-page flow list and flow-counting queries filter `kind != 'step'`; children
  are reachable from the parent's panel.
- The parent node instance's effective config snapshot carries the fan-out knob
  (already how knob layering works), so runtime mode changes only affect new runs of
  new flows — running parents are snapshots, not live config.

### Built-in step template

A second built-in template seeded in `TemplateStore`, next to the existing
`SDLC_TEMPLATE_ID` loop and the Phase-5 starters: one node instance of the new
`step_build` def (approval trigger). `NODE_KEYS` gains `STEP_BUILD`; `node_templates`
gains the builtin row. One constraint from `TemplateStore`: a built-in node
instance's key must equal its node-template key, so the instance key is exactly
`step_build`.

## 3. StepFlowManager (`lib/engine/step-flows.ts`)

State authority for fan-out. Kept out of `flow.ts` (the engine stays template-
generic; the manager is a built-in internal consumed by run-time trigger paths).

**Where expansion hooks in:** today's node trigger path is
`FlowEngine.runNode → startNodeStage`; the manager is invoked from a *fan-out check*
in `startNodeStage` (before the def's own run): if the node's effective config has
`fanout.mode != whole` and pending checklist steps exist, the manager expands instead
of running `def.run`. Nothing else in the engine changes; built-ins and declarative
nodes hit the same path. (The build node's *whole-mode* `triggerRuns` branch
decomposition stays exactly as is — the fan-out check composes with it: each
decomposed branch's children are grouped by `plan_steps.branch`.)

- `expand(parentFlowId, nodeKey)` — child flows + `plan_steps.sub_flow_id` linkage
  + first schedule. Only *pending* steps without `sub_flow_id` spawn children;
  a plan refinement after expansion adds children for new steps only.
- `advance(parentFlowId, nodeKey)` — the scheduler: next unstarted children up to
  `parallel_max`. Eligibility: earlier *overlapping* steps (same decomposed branch
  for code children) resolved. Qualification: sibling `files` disjoint
  (empty `files` ⇒ overlap ⇒ sequential).
- `onChildTerminal(subFlowId)` — status rollup: code children with a mergeBack hook
  run it bounded per §4 first; non-code children aggregate their output.
  Releases locks, emits parent system events.
- `onChildFailed(subFlowId)` — child red, Retry/Stop as standard; **does not block
  non-overlapping siblings**. A failed code child does stall its overlapping
  neighbours (they'd build against a missing branch).
- `skipStep(parentFlowId, nodeKey, stepId)` — cancel the child, mark the step done
  with `completed_by: 'skipped'`, event, `advance()`.
- `onAllResolved(parentFlowId, nodeKey)` — publish the aggregate output
  (def's `fanoutOutput`), node → terminal per its trigger type (`approval` ⇒
  `awaiting_approval`; the SDLC build's final aggregate approval → existing
  `approveBuild` chain → MR creation unchanged), then the engine's normal edge
  evaluation continues downstream.

### Checklist-edit guards (mirror of `assertPlanEditable`)

- A step whose child is building or done cannot be deleted from the checklist.
- A pending child with no run can be removed by checklist edit (child cancelled).

## 4. The build specialization: merge-back (the one new engine op)

GitLab has no branch-merge API (only MRs), so code-children merge back in a **merge
arena**: the per-flow workspace clone (`workspaceForFlow(parentFlowId)` — gains an
`ensureWorkspace` lazy create). Local mode additionally uses the parent's existing
flow worktree; the hub checkout is still never touched.

Algorithm — durable `step_merges` rows make it resumable (`reconcile.ts` flags stuck
merges after restart):

1. **Serialize** — an in-memory lock per integration branch (approvals can arrive
   concurrently from qualified-parallel siblings; second approval queues).
2. In the arena: `fetch --prune` → checkout the integration branch →
   `pull --ff-only` → `merge --no-ff <step branch> -m "[sN] <step title>"` →
   push `-o ci.skip`.
3. Success → child done, step done, `push --delete` the step branch, `advance()`.
4. **Conflict** → `step_merges: conflict` → **merge-fix agent** (plan mode judgment +
   agent-mode edit pass in the arena, on the step branch): resolve conflicts
   respecting *both intents* (own step + sibling code), push, engine re-merges;
   bounded by `max_merge_fix_attempts` (default 2, commit-fix style
   classification: repairable code state vs. infra failure).
5. **Push rejection** (pre-receive hooks): today's commit-fix agent path, re-used
   verbatim inside the arena.
6. Divergence rule: a step branch stale relative to the integration branch is
   repaired via the merge-fix agent — never silently rebased; the panel shows a
   "stale base" badge while it diverges.

### StepBuildNode (`lib/engine/nodes/build/step-build-node.ts`)

Extends `BuildNode`; the only child def with `mergeBack`.

- Prompt = base build prompt + **step section** (the one step's title/detail/files,
  an explicit "implement exactly this step") + **context pack** (sibling titles/
  files/summaries; "do not modify files owned by other pending steps" advisory).
  The whole plan is included so the agent understands where its step sits.
- Local mode: the *first* child is a follow-up on the parent build's agent session
  lineage (repo-warm context carries over); later steps fresh from that lineage
  (one session replaying every step's tool calls would balloon cost). Cloud mode
  uses the context pack.
- Approve ≠ MR: approves the **step**, triggering `mergeBack`. Only the *parent's*
  final approval creates the MR, through the untouched existing chain.
- No `build-progress` block — steps turn green on merge, never on agent claim.

## 5. UI surface

| Surface | What |
|---|---|
| Fan-out node's panel (any def) | Step cards: state chip (pending / building / awaiting approval / merged / conflict / failed / skipped), branch name (code children), output summary (custom children), diff stat; buttons (Approve · Retry · Skip · Open sub-flow) |
| Step card → child flow screen | Regular flow screen: graph, run activity, chat, diff/output viewer, approval — all existing views on the child flow |
| WorkflowGraph | The fan-out node shows `steps 3/8 · building`; no graph change otherwise (children are off-graph rows) |
| Home flow list | Children hidden (`kind != 'step'`); parent shows a step-progress summary line |
| Node configurator / template editor | New `Fanout` section on the config tab (mode, child template picker, parallel_max); constructor lint errors surface as today. The **plan node's** config gains `execution_default`; the runtime plan panel shows the published resolution ("will execute: step-by-step (7 steps)") |
| Chat | Parent chat routes by selected node as today; a child flow's chat runs its own node agent (existing `sendChat` on the child flow) |

## 6. Phased implementation

### Phase 1 — Fan-out plumbing + step children for the built-in build (the core)

- **1A.** Migration (`flows.parent_flow_id/kind`, `plan_steps.sub_flow_id`,
  `step_merges`); seed the step template + `STEP_BUILD` builtin row.
- **1B.** Fan-out check in `startNodeStage` + `StepFlowManager` (expand / sequential
  advance / terminal rollup / aggregation + `fanoutOutput` default contract); the
  fan-out knob in the config layer (`whole | steps | from-plan`); the **plan node**
  publishes `execution` in plan-meta (`execution_default: whole | steps` —
  `follow` and the override chip land in Phase 3B).
- **1C.** `StepBuildNode` (step prompt + context pack; approve → merge-back in the
  arena, local + cloud modes) and the step template wiring.
- **1D.** Parent panel step cards; home list filtering; lint rules.
- **Acceptance:** (a) SDLC loop, 3-step plan, `fanout.mode steps` on build → three
  child flows build sequentially, each approved from its own screen, merge commits
  `[s1]..[s3]` on the integration branch, final approval → MR → gate → review as
  today; **(b) custom template `plan → docs-agent → notify`** with fan-out steps on
  `docs-agent` → three children each run the agent with their step context, notify's
  input mapping reads `{{nodes.docs_agent.output.steps...}}` — the same `fanout mode`
  UX for both. **Parity check (a + b) with `mode whole`: byte-for-byte prompt
  comparison against today's behavior.** The lint rejects the SDLC loop as a child
  template (granularity decision enforced, not just documented).

### Phase 2 — Failure paths + hygiene

- **2A.** Merge-fix agent (conflict + stale-base repair, bounded attempts); push
  rejection via existing commit-fix classification in the arena.
- **2B.** Reconcile integration: stuck `step_merges` resume/flag after restart; lock
  cleanup; orphan-child detection.
- **2C.** Skip-step; step-branch deletion on merge/skip/fail; child worktree sweep;
  `ci.skip` push options on every engine-driven push (documented caveat:
  agent-initiated pushes can't carry push options — repo-side CI rules for
  step-branch patterns are the mitigation).
- **Acceptance (manual):** two overlapping steps → conflict surfaced on the parent
  panel → merge-fix repairs → merge lands; kill the server mid-merge → restart →
  merge resumes or fails loudly; skipped step shows on checklist, child branch
  deleted; a failed non-code child (docs-agent) retries without touching siblings.

### Phase 3 — Parallelism + planner-decided execution + richer child templates

- **3A.** Parallel scheduler: qualification (disjoint files / per-branch
  independence), `parallel_max`, merge-lock queueing, sibling context-pack summaries.
- **3B.** `execution_default: follow` (planner decides per plan version, published in
  plan-meta with rationale) + plan-panel override chip at approve; checklist-edit
  guards. (Phase 1B laid the `execution` plan-meta field.)
- **3C.** Explicit `child` template picker (gallery, hidden templates excluded) for
  both built-in and custom parents — e.g. per-step *test* children or per-step
  *custom reviewer* children. The §1 lint rules apply at save for every pick.
- **Acceptance:** 4 independent steps + 2 sequential → independent ones build
  concurrently, merges serialize in step order; overlapping-file "independent" pair
  forced sequential by qualification; a non-build parent (docs-agent) running
  qualified-parallel children and aggregating their outputs correctly.

### Phase 4 — Monitoring polish

- Fan-out node card rollups (cost/duration per step), parent-graph badge states,
  README + docs updates, `seed:demo` variant mid-fan-out, cost-per-step in run
  summaries.

## 7. Verification (no automated tests, matching the standing decision)

- **Parity:** `mode: whole` unchanged — full walkthrough + prompt diff, per Phase 1.
- **Sequential step mode:** 3-step demo → each step's diff/output is inspectable and
  attributable; checkmarks only turn green on merge/success, never on agent claim.
- **Custom-node fan-out:** docs-agent over 3 steps → three children produce separate
  artifacts; aggregation + downstream mapping correct.
- **Contract stability:** downstream refs authored for the aggregate shape resolve
  across a `whole`-resolution run (single-entry aggregate) and a steps run of the
  same `from-plan` node — a plan refine that changes the checklist size never
  changes the shape downstream templates see.
- **Conflict drill:** overlapping steps → conflict → bounded repair → re-merge.
- **Restart drill:** kill mid-merge → reconcile resumes or flags.
- **Parallel drill:** independent steps concurrent, merge order preserved.
- **Hygiene:** branches deleted; no pipeline spawns from engine pushes;
  `git grep build-progress` in fan-out prompts → 0 hits.

## 8. Non-goals & open questions

**Non-goals:** per-step MRs/CI gates; stacked-MR chains; auto-merge without per-step
approval; rebases without user-visible repair runs; "template as a node" sub-flows
(custom-flows §12, untouched); fan-out on nodes *inside* an already-expanding child
(nesting — single cap level, enforced by lint rule 3); changing whole-mode behavior
in any way.

**Scope boundary, stated honestly:** v1 fans out **only from the plan checklist**
(`plan_steps`) — that source is per-flow shared state this plan links into
(`plan_steps.sub_flow_id`). Fan-out from arbitrary upstream contracts (an agent or
script node emitting an array of items) would be a further generalization with a
different linkage home; it is deliberately out of scope until a real template needs
it. Everything above that boundary — knob, manager, child templates, aggregation,
monitoring — is node-agnostic and stays so.

**Resolved during this revision:**

- The runtime contract coin flip under the old `mode: auto` is gone (rev 3) — the
  plan node owns the mode resolution (published in plan-meta, reviewed at approve)
  and `from-plan` nodes publish the aggregate shape unconditionally, so lint rule 4
  is fully static (`steps` and `from-plan` both check against the aggregate).
  Rejected alternative: a union contract (`summary? | steps?`) — it moves
  correctness from the checker into every consumer's JSONata, failing exactly in
  the month a plan's checklist crosses the old threshold.

**Open questions (forwarded to implementation):**
- Should *whole-mode* builds also adopt commit-per-step on their single branch
  (cheap traceability without fan-out), or leave that to step mode only?
- Cost cap: a hard "max concurrent agent runs" setting (global, not per-flow)?
- Child-flow retention: keep children forever (audit) vs. prune on parent close
  (clutter) — suggestion: keep, hidden from lists.
- Merge-fix agent model: today's plan+agent two-pass split mirrors commit-fix —
  confirm or simplify to a single agent-mode pass.
- Non-plan step sources (array-contract fan-out — script/agent emitting N items):
  revisit only if a real template demands it; plan-checklist-only until then.
