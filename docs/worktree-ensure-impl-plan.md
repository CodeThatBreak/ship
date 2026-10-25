# Implementation plan: worktree ensure at the agent runner (Option B)

*Implements `docs/worktree-ensure-runner.md`. Status: plan — not yet implemented.*

**Summary of the change:** unpinned mutating agent runs (`mode: "agent"`, local
execution, no explicit `cwd`) are ensured into the flow's worktree by
`AgentRunner.startAgent` — the one chokepoint every agent run (built-in or
declarative) passes through. Per-node `ensureFlowWorktree` calls in
build/resolve become *pins*, not the mechanism. No schema changes, no
migrations; the existing `worktree_mode = "disabled"` setting remains the
kill switch and rollback.

Total size: ~70 LOC in `lib/engine/worktree-lifecycle.ts`, ~20 in
`lib/engine/nodes/base/agent-runner.ts`, ~15 in
`lib/engine/nodes/script/script-node.ts`, ~100 in
`scripts/check-worktrees.ts`, small doc edits. Five phases, each independently
shippable and verifiable.

---

## Phase 1 — `WorktreeManager`: runner-facing ensure + branch policy

File: `lib/engine/worktree-lifecycle.ts` (plus one export in
`lib/git/worktrees.ts`). No behavior change yet — the runner isn't wired.

### 1a. Pure layer: expose the worktree's head branch

`Worktrees.shortHeadBranch` (`lib/git/worktrees.ts:471`) is private. Make it
public as `headBranch(dir: string): Promise<string | null>` (or wrap it).
Purity rules apply: plain git call, no db/engine imports — the existing
purity guard in `scripts/check-worktrees.ts:44-48` enforces this.

### 1b. Manager: `ensureForRun` — the whole Option B rule set in one method

```ts
/**
 * Runner-facing ensure (Option B): resolve the run cwd for an agent run.
 * Rules: an explicit pin always wins (returned untouched, no manager
 * involvement); read-only runs (mode=plan) get no worktree; an unpinned
 * mutating run is ensured into the flow's worktree with the tree's CURRENT
 * branch when one exists (never an implicit switch), else the flow's
 * canonical mr_branch, else the caller's default branch (the build naming
 * convention). setupNote is the once-per-flow deps-setup failure line — the
 * caller appends it to the run prompt so the agent can self-repair.
 */
async ensureForRun(
  ctx: FlowCtx,
  opts: {
    mode?: "agent" | "plan";
    cwd?: string;                // the node's pin, when it passed one
    nodeId?: string | null;
    defaultBranch: string;       // ctxHelper.buildBranch(ctx) from the runner
  }
): Promise<{ cwd: string | undefined; setupNote: string | null }> {
  if (opts.cwd) return { cwd: opts.cwd, setupNote: null };
  if (opts.mode !== "agent") return { cwd: undefined, setupNote: null };
  const existing = await this.currentWorktreeBranch(ctx);   // null when no tree
  const branch = existing ?? ctx.flow.mr_branch ?? opts.defaultBranch;
  const binding = await this.ensureFlowWorktree(ctx, branch, { nodeId: opts.nodeId ?? null });
  return { cwd: binding.dir ?? undefined, setupNote: binding.setupNote };
}
```

`ensureFlowWorktree` itself is **unchanged** — it already owns reuse,
base resolution (`repo.default_branch`), canonical-path persistence to
`flows.worktree_dir`, lifecycle events, and once-per-flow deps setup.

### 1c. Manager: `currentWorktreeBranch`

```ts
/** The head branch of the flow's existing worktree, or null when the flow
 *  has none on disk. Listing failure → null (the ensure itself re-lists
 *  strictly and fails non-fatally). */
private async currentWorktreeBranch(ctx: FlowCtx): Promise<string | null> {
  const dir = ctx.flow.worktree_dir;
  if (!dir) return null;
  try {
    if (!fs.existsSync(path.join(dir, ".git"))) return null;
    return await worktrees.headBranch(dir);
  } catch { return null; }
}
```

Note the ordering consequence: an unpinned run against an existing tree
stays on the tree's current branch (`switchWorktreeBranch` sees `cur ===
branch` and no-ops). Only pinned runs (build/resolve) may switch branches —
preserving today's multi-branch sequential-build semantics.

### 1d. In-flight coalescing (the Orca `holdInFlightWorktreeCreate` analog)

Two runs can ensure the same flow concurrently (chat refine while a node
run is in flight). Coalesce per flow+branch exactly like the pure layer's
listing map (`lib/git/worktrees.ts:239`):

```ts
private ensureInFlight = new Map<string, Promise<WorktreeBinding>>();

// in ensureForRun, around the ensureFlowWorktree call:
const key = `${ctx.flow.id}:${branch}`;
const inflight = this.ensureInFlight.get(key);
if (inflight) return { cwd: (await inflight).dir ?? undefined, setupNote: null };
const p = this.ensureFlowWorktree(ctx, branch, { nodeId: opts.nodeId ?? null })
  .finally(() => this.ensureInFlight.delete(key));
this.ensureInFlight.set(key, p);
```

Waiters get `setupNote: null` — the first caller appends the note to its own
prompt; a concurrent second prompt missing one advisory line is acceptable
(and both runs share the same fixed tree).

### 1e. Branch fallback naming — reuse the build convention

`opts.defaultBranch` comes from the runner as `this.ctxHelper.buildBranch(ctx)`
(`flow-context.ts:90`) — `bugfix/<task-key>-<flowid6>` (feature/ for story
tasks), the exact name a later default-pattern build would resolve. If a
build runs later, `createWorktree`'s existing `refs/heads/<branch>` path
(`worktrees.ts:291-293`) checks the branch out with any crashed-run commits
intact — no new naming scheme, no pre-receive-pattern risk (the comment at
`flow-context.ts:86-88` documents why this shape was chosen).

---

## Phase 2 — wire the runner

File: `lib/engine/nodes/base/agent-runner.ts`.

### 2a. `AgentStartInput` gains an optional nodeId (event attribution only)

```ts
nodeId?: string | null; // lifecycle-event attribution for engine-side ensures
```

`NodeDefinition.execute` (`node-definition.ts:254-255`) populates it; the
pinning nodes (build/resolve/refine) don't need it — their ensure calls
already pass their own `nodeId`.

### 2b. The `startAgent` edit

```ts
if (port.execMode === "local") {
  spec.workspace = this.ctxHelper.requireRunCwd(ctx);
  // Option B: an unpinned MUTATING run is ensured into the flow worktree —
  // the node pin (input.cwd) always wins; plan runs stay on the hub.
  const ensured = await worktreeManager.ensureForRun(ctx, {
    mode: input.mode,
    cwd: input.cwd,
    nodeId: input.nodeId ?? null,
    defaultBranch: this.ctxHelper.buildBranch(ctx),
  });
  spec.cwd = input.cwd ?? ensured.cwd;
  if (!input.cwd && ensured.setupNote) {
    // same contract as build/resolve: one advisory line, agent self-repairs
    spec.prompt += `\n${ensured.setupNote} If the changes need dependencies, run the repo's dependency setup yourself before building/testing.`;
  }
}
```

Notes:
- `spec.prompt` mutation happens after the node rendered/persisted its
  override — the persisted `prompt_override` (audit/retry fidelity) is
  unaffected, exactly as build/resolve do it today.
- The appended note duplicates build/resolve's inline copies only for
  unpinned callers; build/resolve keep their own (their setupNote comes from
  the pin path). A follow-up can unify all three onto `ensureForRun`'s note.
- No other file changes: `NodeDefinition.execute` and every built-in node's
  `runner.startAgent` call inherit the behavior automatically.

---

## Phase 3 — script node: `cwd: "workspace"` without an agent step first

File: `lib/engine/nodes/script/script-node.ts` (`workingDir`, lines 221-236).
Today a workspace-less `cwd: "workspace"` script throws. Route through the
ensure instead:

```ts
if (cfg.cwd === "workspace") {
  const ws = workspaceForFlow(ctx.flow.id);
  if (!ws) {
    // explicitly asked for the flow workspace — create it (same rule as the
    // runner's unpinned mutating runs); disabled mode keeps the old error
    if (!this.worktreesEnabled()) return legacyWorkspaceError();
    const branch = ctx.flow.mr_branch ?? flowCtxHelper.buildBranch(ctx);
    const binding = await worktreeManager.ensureFlowWorktree(ctx, branch);
    if (!binding.dir) return legacyWorkspaceError();  // creation failed non-fatally
    return binding.dir;
  }
  return ws;
}
```

(`legacyWorkspaceError` is today's thrown message, kept for the disabled and
failure cases.) Script-only flows become first-class: `ensureFlowWorktree`
runs deps setup once, persists the binding, and the sweep owns cleanup —
identical lifecycle to agent-created trees.

---

## Phase 4 — tests (`scripts/check-worktrees.ts`)

Extend the existing harness (temp db + git fixture, `lifecycleSmoke` style —
seed `repos/tasks/flows` rows, call the manager, assert on fs + db + events).
New section `runnerEnsureSmoke()` after `lifecycleSmoke()`:

| # | Scenario | Assertion |
|---|---|---|
| 1 | Standalone flow (no build), `ensureForRun({mode:"agent"})` | worktree at `workspaces/<flowId>`, branch = `buildBranch(ctx)` shape (`bugfix/dev-1-<id6>`), persisted to `flows.worktree_dir`, "worktree created" + "setting up worktree deps" events emitted, `setupNote === null` |
| 2 | Same call again | same dir returned, `reused`, deps setup NOT re-run (no second setup event) |
| 3 | `ensureForRun({mode:"plan"})` | `{ cwd: undefined, setupNote: null }`, no worktree, no events |
| 4 | `ensureForRun({cwd: "/explicit", mode:"agent"})` | pin returned verbatim; no ensure side effects (no new events/dir) |
| 5 | Tree exists on branch X; `ensureForRun({mode:"agent"})` with `mr_branch` set to Y | stays on X (no implicit switch) |
| 6 | `worktree_mode = "disabled"` | `{ cwd: undefined }` — hub fallback |
| 7 | `execution_mode: "cloud"` flow | `{ cwd: undefined }` |
| 8 | Two concurrent `ensureForRun` (same flow+branch, `Promise.all`) | single "worktree created" event (coalescing); both calls return the same dir |
| 9 | Crash-recovery interplay (existing coverage) | sweep adoption/removal assertions keep passing unchanged |

Plus one **source-level regression guard**, same style as the purity guard
(`check-worktrees.ts:44-48`): assert `agent-runner.ts` contains the
`ensureForRun` call and that the guard is inside the `execMode === "local"`
branch — a cheap tripwire against the chokepoint being unwired later.

Optional (only if cheap): a `startAgent`-level test with a fake
`AgentPort` registered in `agentPortRegistry` that records `spec` — verifies
`spec.cwd`/`spec.prompt` assembly end-to-end. If registry stubbing turns out
to be invasive, skip: the manager-level table + source guard cover the
contract.

---

## Phase 5 — docs

1. `docs/worktree-ensure-runner.md` — flip the status header to implemented;
   note the two deviations that landed: (a) branch fallback reuses
   `buildBranch` instead of a new `devflow/` scheme; (b) coalesced waiters
   drop `setupNote`.
2. `docs/worktree-support.md` — engine-manager section: state that the
   ensure lives in `AgentRunner.startAgent` and per-node calls are pins.
3. `README.md` line ~227 (workspaces bullet) — one clause: "ensured at the
   runner for every unpinned mutating run".

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Concurrent ensures race two `git worktree add` into one dir | in-flight coalescing (1d) + `createWorktree`'s existing-tree check/`prepareDir` orphan handling |
| First unpinned run in a flow pays deps-setup latency | accepted (once per flow, amortized); warm-deps background setup stays on file in the design doc §6 |
| Derived branch rejected by repo pre-receive patterns | fallback uses `buildBranch` — the same convention cloud/local builds already push successfully |
| Detached-HEAD worktree (branch `null`) | falls through to `mr_branch` / default branch; `switchWorktreeBranch` is best-effort and the agent prompt covers branch creation (existing defense, `worktrees.ts:450-452`) |
| New lifecycle events from node kinds that never emitted them | flow cards already render lifecycle events; the ensure's `nodeId` attribution (2a) keeps them attached to the right node |
| Behavior change surprises existing users | rollback = `worktree_mode: "disabled"` (one setting, no migration); SDLC flows' observable behavior is unchanged (§4.1 of the design doc) |

## Rollout / verification order

1. **Phase 1** (manager + pure-layer export) → `npx tsx scripts/check-worktrees.ts` green; no runtime behavior change.
2. **Phase 2** (runner wiring) → same check + manual: run a custom template with a standalone agent node in local mode → chat feed shows `worktree created at workspaces/<flowId>`, hub untouched (`git status` clean in the registered checkout).
3. **Phase 3** (script hardening) → manual: script-only template with `cwd: "workspace"` runs instead of erroring.
4. **Phase 4** (tests) — actually developed alongside 1–3; the table above is the acceptance list.
5. **Phase 5** (docs) — last.
