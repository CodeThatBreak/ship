# NodeDefinition Refactor Plan — Uncoupling the Base Class and Killing the Built-in Key Residue

**Scope:** `lib/engine/nodes/**`, `lib/engine/flow.ts`, `lib/engine/step-flows.ts`, `lib/engine/nodes/sdlc/chain.ts`
**Motivation:** the declarative (custom) node kinds (`agent` / `decision` / `http` / `script`) ride the
`NodeDefinition` base class cleanly, but three problems remain:

1. the orchestrator still special-cases built-in node keys by literal string,
2. the base class's "service injection" is cosmetic (singleton field defaults, `db` reached around the seam),
3. the base class keeps accreting optional overridables and is drifting toward a god-class.

This doc proposes the target architecture, an inheritance tree for every node, and a phased
migration that never breaks a running flow.

---

## 1. Findings (evidence, not vibes)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Engine dispatch routes built-in keys by literal string | `flow.ts:619,639,707,1134` (`firstKeyOfType(flowId,"plan")`), `:748` (`"pipeline"`), `:1234` (`"resolve"`) |
| F2 | Generic `approveNode` names built-ins | `flow.ts:1331` — `if (defKey === "plan" \|\| defKey === "build") throw` |
| F3 | Raw SQL matches artifact kinds by literal | `flow.ts:655` — `a.kind='plan'` |
| F4 | Old chain reaches into engine internals | `sdlc/chain.ts:58,161,186` (`build`/`resolve`/`review` keys), via `flowNodeConfig`/`nodeConfigFor` marked *"not a public API"* (`flow.ts:603-614`) |
| F5 | Step child wiring keyed off parent literal | `step-flows.ts:421` — `parentDefKey === "build"` → `STEP_BUILD_TEMPLATE_ID` |
| F6 | Pseudo-DI: singleton field defaults, not injection | `node-definition.ts:158-162` — `protected readonly support: NodeSupport = nodeSupport` etc. Violates AGENTS.md §3.1. Tests must subclass-shadow fields. |
| F7 | The seam leaks: nodes reach around it | 10 of 11 node files `import { db }` directly; `db.emitEvent` is called **inside the base** (`node-definition.ts:344`) |
| F8 | Two persistence paths for "run finished", already drifted | `AgentTemplateNode.recover()` (`agent-node.ts:236-251`) hand-rolls the `execute()` tail instead of calling the exposed `applyOutcome()`; it splices `(${note})` into the event while `execute()` carries `eventData` |
| F9 | Base class accretes optional overridables | chat (`chat`, `converse`), preview (`previewPrompt`, `previewRules`, `previewBody`), contracts (`outputContract`, `choices`), graph (`triggerRuns`, `isEntry`, `inheritsParentInput`) all live on one 365-line abstract class |
| F10 | Registry erases the generics | `registry.ts:22` — `Map<string, NodeDefinition<any, any>>` (two `any`s in a strict-TS repo, AGENTS.md §2.9 violation) |
| F11 | Status strings duplicated raw per node | `RunOutcome.status` is a hardcoded union of `"awaiting_approval" \| "done" \| "failed"`, repeated in every def (AGENTS.md §2.7 violation — no `FLOW_STATUS` constant object) |
| F12 | Only subclass-of-subclass couples two nodes | `StepBuildNode extends BuildNode` (`step-build-node.ts:46`) — the fan-out child inherits the parent's run/refine machinery and must override/unwind pieces of it |

What is already **right** and must not be broken: metadata-driven dispatch (`isEntry`,
`inheritsParentInput`, `triggerRuns`), registry as single source of truth, and the merged-instance-config
pass into `outputContract(def)` / `choices(def)` — the mechanism that lets custom nodes extend
built-in contracts without subclassing.

---

## 2. Current inheritance tree (as of today)

```
NodeDefinition<I, O>                                   abstract (lib/engine/nodes/base/node-definition.ts)
│  deps: support/runner/ctxHelper = singleton field defaults (F6)
│  owns: graph metadata · run contract · config layering · chat · preview · persistence helpers
│
├─ StartNode<StartPayload, StartPayload>               nodes/start/start-node.ts          (isEntry = true)
├─ PlanNode<PlanInput, PlanOutput>                     nodes/plan/plan-node.ts            (chat/refine/preview heavyweight)
├─ BuildNode<BuildInput, BuildOutput>                  nodes/build/build-node.ts          (multi-branch triggerRuns)
│   └─ StepBuildNode                                   nodes/build/step-build-node.ts     (mergeBack capability, F12)
├─ PipelineNode                                        nodes/pipeline/pipeline-node.ts
├─ ReviewNode<ReviewInput, ReviewOutput>               nodes/review/review-node.ts
├─ ResolveNode<ResolveInput, ResolveOutput>            nodes/resolve/resolve-node.ts
│
└─ (declarative — one instance per node_templates row, nodes/declarative.ts)
    ├─ AgentTemplateNode                               nodes/agent/agent-node.ts
    ├─ DecisionTemplateNode                            nodes/decision/decision-node.ts
    ├─ HttpTemplateNode                                nodes/http/http-node.ts
    └─ ScriptTemplateNode                              nodes/script/script-node.ts

Sidecar services (composition boundaries that already exist):
  NodeSupport · AgentRunner · FlowContextHelper · NodeRegistry · StepBuildNode→mergeArena

Singletons the base reaches around: db (base + every node file), nodeSupport, agentRunner, flowCtxHelper
```

The tree itself is healthy — shallow, one abstract root, one deliberate sub-subclass (F12).
The pathology is not the tree shape; it is what the root class owns (F9) and what the
orchestrator still names by literal (F1–F5).

---

## 3. Target architecture

### T1 — Real constructor injection (fixes F6, F7)

The base takes its services in the constructor, singletons become defaults, and the event
emitter moves behind `NodeSupport` (the last raw `db` call in the base disappears):

```ts
// base/node-definition.ts
export abstract class NodeDefinition<I = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    protected readonly support: NodeSupport = nodeSupport,     // now also emits lifecycle events
    protected readonly runner: AgentRunner = agentRunner,
    protected readonly ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {}
  // execute() tail: this.support.emitLifecycle(ctx.flow.id, node.id, outcome.event, outcome.eventData)
}
```

Then, file by file, delete `import { db }` from node implementations (F7): every read/write a
node performs against `nodes`/`artifacts`/`runs` gets a named method on `NodeSupport` instead of
raw SQL. Rule after this change is mechanical: **no node file imports `db`** (enforceable with
`import/no-restricted-paths` per AGENTS.md §5).

> ADR note: nodes are instantiated inside `registerBuiltins()` / `instantiateDeclarative()` with
> zero args today; defaulted constructor params keep both call sites untouched.

### T2 — One persistence path (fixes F8)

`recover()` must not hand-roll the `execute()` tail. `takeOver` the helper:

```ts
// base/node-definition.ts
protected applyOutcome(ctx: FlowCtx, outcome: RunOutcome, opts?: { note?: string }): RunOutcome {
  // ... unchanged, but the event becomes outcome.event + optional "(note)" suffix
  // and this is the ONLY place that parses outputSchema, saves artifacts,
  // sets final status and emits the lifecycle event.
}

// base/node-definition.ts excerpt (execute() tail shrinks to):
const outcome = await opts.finalize(result);
return this.applyOutcome(ctx, outcome);            // execute() itself goes through the same door
```

`AgentTemplateNode.recover()` collapses to:

```ts
async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
  if (result.status !== "finished") return false;
  const outcome = this.applyOutput(ctx, result.result ?? "", this.runConfig(this.nodeConfig(ctx)));
  this.applyOutcome(ctx, { ...outcome, event: `${outcome.event} (${note})` });
  return true;
}
```

Test: restart-recovery of an agent node must persist byte-identical node/artifact/event rows as a
normal finish `expect(onRecoverApplied).toEqual(onExecuteApplied)`.

### T3 — Def metadata replaces literal keys (fixes F1–F5)

Add opt-in declarative metadata to `NodeDefinition`; then make the call sites consume metadata.
Nothing changes for custom kinds — the defaults preserve today's behavior.

```ts
// base/node-definition.ts
interface NodeFlags {
  /** this def's approval is NOT a generic approveNode action (plan refine, build approve own it) */
  builtinApproval: boolean;                     // default false — plan/build set true  (→ F2)
  /** catalog keys a def's *kind* occupies in the SDLC chain; empty for all others */
  chainRole?: "plan" | "build" | "review" | "resolve";  // (→ F4)
  /** artifact kinds this def publishes that are first-class engine resources */
  resourceArtifacts: readonly string[];         // plan → ["plan"] mean flow.ts stops SQL-matching (→ F3)
  /** to- artifacts this def's edges wait on */
  waitForKind?: string;                         // pipeline (→ F1)
}
```

Call-site conversions, smallest blast radius first:

| Literal | Becomes | File |
|---|---|---|
| `defKey === "plan" \|\| defKey === "build"` in `approveNode` | `def.builtinApproval` | `flow.ts:1331` |
| `firstKeyOfType(flowId, "plan")` ×4 | look up by `nodeRegistry.find((d) => d.chainRole === "plan")` | `flow.ts:619,639,707,1134` |
| `a.kind='plan'` | scope it through the plan def's `resourceArtifacts` | `flow.ts:655` |
| `firstKeyOfType(flowId, "resolve"/"pipeline"/"review"/"build")` in `sdlc/chain.ts` | def-provided `chainRole` + a narrow `ChainHost` port (`flowNodeConfig`/`nodeConfigFor` stop being *"not a public API"*) | `chain.ts:58,161,186` |
| `parentDefKey === "build"` → `STEP_BUILD_TEMPLATE_ID` | `BuildNode.canFanOutChild` / `childTemplateId` def method | `step-flows.ts:421` |

Done-criterion: `grep -rn '"plan"\|"build"\|"review"\|"resolve"\|"pipeline"' lib/engine/flow.ts lib/engine/step-flows.ts lib/engine/nodes/sdlc/` returns only the def classes themselves and `NODE_KEYS` imports, not logic branches.

### T4 — Capability-gated roles instead of base-class accretion (fixes F9, partially F12)

The base stops growing. Chat and prompt preview become strategies selected by the *existing*
`capabilities` metadata — the same mechanism `mergeBack` already uses:

```ts
// base/node-roles.ts (new)
/** A def that can refine its output from chat/feedback messages. */
export interface ChatRefiner {
  chat(ctx: FlowCtx, content: string, model?: string): Promise<string>;
}
/** A def that publishes a live prompt preview for the prompt modal. */
export interface PromptPreviewer {
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null;
}
```

Dispatch lives in one place (the chat route / prompt-preview service), keyed off
`capabilities.refinable / chatOnlyMode / promptNode` — data the server already serializes to the
UI:

```ts
const refiner = def satisfies Partial<ChatRefiner> ? (def as ChatRefiner) : null;
if (!refiner) return "This node doesn't accept chat input.";   // today's default behavior, now in the router
```

Removed from the abstract base: `chat()`, `converse()`, `previewPrompt()`, `previewRules()`,
`previewBody()`. Kept: everything every node genuinely shares — graph metadata, run contract,
config layering (used by all), persistence helpers. Net effect:
- custom kinds implement only the roles their config enables (`AgentTemplateNode` opts into both),
- no subclass inherits 20 nearly-inert methods,
- the next feature (e.g. scheduled nodes) ships as a new role file, not as a sixth concern on the base.

`converse()` ("just chat") stays on the base for the first phase — it is one implementation, truly
shared — or moves to a `Converser` role if the router cleanly separates the two chat modes
(`refine` vs `followup`, already encoded in `NodeCapabilities.chatOnlyMode`).

### T4b — The `AgentRunNode` tier: agent machinery leaves the root

The root violates ISP today: `AgentRunner` and `converse()` live on `NodeDefinition`, but
`StartNode`, `HttpTemplateNode` and `ScriptTemplateNode` never touch either. Eight of eleven
classes consume the runner through the base's `execute()`; three never do.

Usage matrix (measured):

| Node | `this.runner` direct | via base `execute()` | Runs an agent? |
|---|---|---|---|
| StartNode | — | — | no |
| HttpTemplateNode | — | — | no (`applyOutcome` only) |
| ScriptTemplateNode | — | — | no (`applyOutcome` only) |
| DecisionTemplateNode | — | `decision-node.ts:232` (LLM-expression mode) | **partially** |
| PlanNode | `plan-node.ts:853` (bypasses base) | — | yes |
| PipelineNode | `pipeline-node.ts:605` (bypasses base) | — | yes |
| BuildNode | — | `:217`, `:311` | yes |
| ReviewNode | — | `:124` | yes |
| ResolveNode | — | `:148` | yes |
| AgentTemplateNode | — | `:200`, `:219` | yes |

**Rejected topology (inherited-from-`AgentTemplateNode`).** Attractive at first glance — it
would make Plan/Build/Pipeline/Review/Resolve "agent nodes" — but `AgentTemplateNode` is the
*most derived* class in the tree, row-bound by construction: its constructor takes a
`node_templates` row, `key`/`label`/`defaultConfig` derive from that row, and it hardcodes
declarative semantics (loose `inheritsParentInput` schemas, fanout config fields, row-id
resolution, `holdsForApproval`). `PlanNode` has no row and a strict input contract. Inheriting
built-ins from it would force each subclass to null out instance plumbing they must ignore — the
F12 `StepBuildNode` disease replicated at the root. Instances cannot be bases.

**Adopted topology — extract an intermediate tier:**

```
NodeDefinition          root: graph metadata · I/O contract · config layering · persistence roots
│                       REMOVE from root: runner, converse()
├─ AgentRunNode         NEW abstract tier — "a run here goes through the agent runner"
│  │  owns (injected): runner · execute() · converse() · recover()'s "finished?" guard
│  │  default chat = re-ask this node's run with feedback (the recipe build/review/resolve
│  │                  already share — build-node.ts:348)
│  ├─ PlanNode / PipelineNode / BuildNode═StepBuildNode / ReviewNode / ResolveNode
│  ├─ AgentTemplateNode        ← demoted to sibling; keeps ONLY row-binding, fanout,
│  │                             output-contract — what is uniquely declarative
│  └─ DecisionTemplateNode     ← LLM-expression mode makes it a family member
└─ StartNode · HttpTemplateNode · ScriptTemplateNode   (runner-free leaves)
```

Membership test, not a name list: **"does `run()` ever go through the runner?"** — the rule picks
Decision in and Http/Script out, so future kinds classify themselves instead of being added to a
hardcoded family (§2.7 spirit, applied to class topology). Done-criterion: `AgentRunner` appears
in `node-definition.ts` imports only via `AgentRunNode`; `converse()` moves.

**Scope discipline — what hoists, what stays out.** `execute()`, `converse()`, the recover guard
and the rerun-with-feedback chat recipe are genuinely invariant across the family and move.
Refine machinery, prompt preview, fanout, approval holds and branch-recovery specifics stay
per-def (via T4 roles and existing overrides) — hoisting those would recreate the F9 god-class
one level down. Where built-ins differ, they differ for *domain* reasons (build recovers
branches, review/resolve refuse recovery); the tier must not promise shared code that then gets
overridden everywhere.

Replaces part of T4's original framing: the tier owns the *invariant* agent lifecycle by real
inheritance; roles own only per-node affordances.

### T5 — Types and constants (fixes F10, F11)

```ts
// constants/flow.ts (frontend-style constant object, backend can import — lib/ is server-only anyway)
export const FLOW_STATUS = { AWAITING_APPROVAL: "awaiting_approval", DONE: "done", FAILED: "failed" } as const;
export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];

// RunOutcome narrows to the constant:
status: FlowStatus;
```

Registry typing: erase `any` honestly instead of lying silently —

```ts
// nodes/registry.ts
type AnyNodeDef = NodeDefinition<unknown, Record<string, unknown>>;
private readonly registry = new Map<string, AnyNodeDef>();
```

`run(ctx, input: unknown, config)` implementations already treat input loosely across registry
boundaries (defs call `this.parseInput()` internally), so the change is a mechanical cast at each
`register()` call site. If that churn is unacceptable in one PR, keep `any` but add an inline
`eslint-disable` with a written justification — the point is to make the soundness hole explicit
and findable, not invisible.

### T6 — Break the `StepBuildNode extends BuildNode` lineage (fixes F12)

The fan-out child currently inherits the parent's `run()`/`triggerRuns()`/refine machinery and
then overrides most of it — a subclass that must override its parent's core methods is
inheritance chosen for reuse, not for polymorphism. Extract the genuinely shared part into a
composition helper (`BuildRunSupport`: branch assignment, worktree lifecycle, commit-fix
postamble) and make both `BuildNode` and `StepBuildNode` own their own `run()` end-to-end over
that helper. `capabilities.mergeBack` already isolates the child's distinct behavior, so nothing
else moves. **Defer this until T1–T2 land** — without the single persistence path, the extraction
would reproduce F8 twice.

---

## 4. Proposed inheritance tree (after all phases)

```
NodeDefinition<I, O>                        abstract — slim root: graph metadata · run contract · config layering · persistence roots
│  deps: support, ctxHelper — CONSTRUCTOR-injected, singleton defaults
│  (runner and converse() have MOVED DOWN to AgentRunNode — see T4b)
│
├─ AgentRunNode                             abstract tier — "a run here goes through the agent runner"
│  │  own deps: runner (constructor-injected) · execute() · converse()
│  │  default chat: re-ask the node's run with feedback
│  │
│  ├─ PlanNode                              flag: builtinApproval, chainRole: "plan", artifact: "plan"
│  │     ↳ ChatRefiner / PromptPreviewer    roles (runner orchestration stays bespoke)
│  ├─ PipelineNode                          waitForKind: "pipeline" waits resolved through metadata
│  ├─ BuildNode                             flag: builtinApproval, chainRole: "build", childTemplateId: STEP_BUILD
│  │     ↳ ChatRefiner                      role
│  ├─ ReviewNode                            chainRole: "review"
│  │     ↳ ChatRefiner                      role
│  ├─ ResolveNode                           chainRole: "resolve"
│  ├─ AgentTemplateNode inheritsParentInput ← sibling, not root: row-binding + fanout + output contract only
│  ├─ DecisionTemplateNode inheritsParentInput ↳ choices() on the def; LLM-mode rides the tier's lifecycle
│
└─ (runner-free leaves — direct children of the root)
    ├─ StartNode                            isEntry — declarative payload contract
    ├─ HttpTemplateNode inheritsParentInput (no role — fire-and-forget HTTP call)
    └─ ScriptTemplateNode inheritsParentInput (no role — local execution)

StepBuildNode                               separate BuildNode sibling (NOT a subclass) —
                                            composes BuildRunSupport + owns mergeBack capabilities
```

Roles (base/node-roles.ts):
  ChatRefiner      — routed by capabilities.refinable / chatOnlyMode
  PromptPreviewer  — routed by capabilities.promptNode
  PromptConverser  — plain chat, if T4's router split justifies the file

Removed permanently from the root: `chat()`, `previewPrompt()`, `previewRules()`, `previewBody()`
— and `runner` + `converse()` moved down to `AgentRunNode` (T4b), not deleted · `any` gone from
the registry map · `import { db }` gone from every node file · literal built-in keys gone from
flow.ts / step-flows.ts / sdlc/chain.ts.

Not changed on purpose: declarative.ts cache (it has a documented invalidator and is
per-(row,instance)-keyed — revisit only under §3 of AGENTS.md, i.e. when converting to the
lib/singleton.ts pattern), NodeRegistry, RunOutcome's shape (only its status type narrows).
```

---

## 5. Phased execution (each phase passes `npm run build` independently)

| Phase | What | Fixes | Touches | Risk |
|---|---|---|---|---|
| 1 | T2 — `applyOutcome(ctx, outcome, {note})` absorbs the `execute()` tail; `recover()` impls route through it | F8 | node-definition.ts, agent-node.ts (+1-test) | low |
| 2 | T1 — constructor-injected services; `emitEvent` → `NodeSupport.emitLifecycle`; delete `db` imports per node file | F6, F7 | base + all node files | low-med |
| 3 | T5 — `FLOW_STATUS` constant, registry typing | F10, F11 | constants + registry | low |
| 4 | T3 — `NodeFlags` metadata; convert call sites bottom-up (approveNode → chain.ts → plan/pipeline lookups) | F1–F5 | flow.ts, step-flows.ts, chain.ts, defs | med — engine-paths, add recovery-restart test before touching chains |
| 5 | T4 — role interfaces + router; strip `chat`/`previewPrompt` etc. from the root · **T4b — extract `AgentRunNode` tier; move `runner`/`converse()` down; rerun-with-feedback default chat** | F9 | base, chat/preview routes, agent/plan/review nodes | med |
| 6 | T6 — `StepBuildNode` composition split | F12 | build/* | med — largest def, do behind restart + fan-out tests |

**Definition of Done (AGENTS.md §0):** build green per phase · unit tests for the shared
persistence path and the new role router · flow-restart (reconcile) and step fan-out tests for
phases 4 and 6 · every flag default reproduces today's behavior for both built-in and
declarative kinds · the grep settled under "done-criterion" in T3 returns hard-coded keys only
from def classes.

---

## 6. Why this order

1. **T2 first** — it is the smallest, and it makes phases 5–6 safe (deleting code that duplicates
   behavior requires knowing that behavior has exactly one home).
2. **T1 second** — refactors inside the base class stay impossible until services are injectable;
   this phase simulates no behavior beyond identity, so it compiles without flow changes.
3. **T3 fourth, not first** — it changes the orchestrator, the riskiest surface. Arriving there
   with the base already simplified means diffs touch one concern at a time.
4. **T6 last** — extracting a run-machinery helper is only worth it once statuses, persistence and
   layout for the final `BuildNode` vs `StepBuildNode` split are stable.

If scope must be cut to a single sprint, cut **phase 6 (T6)** and leave `StepBuildNode` as a
subclass; if there are only two, do **phases 1 and 2** even so — they alone remove the duplicated
persistence path and give every node a real seam. The T4b tier sits inside phase 5 but is
orderable against T1 only after it: the tier's constructor injects `runner`, so it needs real
injection to exist.
