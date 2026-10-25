# Worktree ensure at the agent runner (Option B)

*Status: implemented (2026-10-25) — `WorktreeManager.ensureForRun` is wired at
`AgentRunner.startAgent` (local mode only), `NodeDefinition.execute` passes
`nodeId`, and `scripts/check-worktrees.ts` has a `runnerEnsureSmoke()` section
plus source-level guards. Verified green end-to-end.*

> **What landed vs. the sketches below:** (a) the branch fallback reuses the
> existing `buildBranch` convention (`bugfix/<task-key>-<flowid6>`) instead of
> the `devflow/` scheme sketched in §3 rule 3 / §5 — the exact name a later
> default-pattern build would resolve; (b) in-flight coalescing means
> concurrent waiters on the same flow+branch get `setupNote: null` — only the
> first caller's prompt gets the advisory line. The script-node follow-up of
> §4.4 also shipped (`ScriptNode.workingDir` ensures instead of throwing).

## 1. Problem

Worktree creation is currently **opt-in per node**. Only `build` and `resolve`
call `worktreeManager.ensureFlowWorktree()` and pin `cwd` before their agent
run. Every other node kind falls through to `AgentRunner.startAgent`
(`lib/engine/nodes/base/agent-runner.ts:67-78`), which resolves the run
directory from `flows.worktree_dir` — and, when that column is unset, from the
**hub** (the developer's registered checkout):

| Node kind | Mutates files? | Directory today |
|---|---|---|
| `build` (built-in) | yes | worktree — explicit ensure + pinned cwd |
| `resolve` (built-in) | yes | worktree — explicit ensure + pinned cwd |
| `agent` (declarative, `mode: "agent"`) | **yes** | `flows.worktree_dir` if a build ran before in the flow, else **the hub** |
| `review` (built-in, `mode: "agent"`) | potentially | same implicit fallback as agent |
| `script` (declarative, `cwd: "workspace"`) | yes | `workspaces/<flowId>` (same dir as the worktree) — **throws** when the workspace doesn't exist yet |
| `script` (declarative, `cwd: "repo"`) | depends | hub by declared opt-in |
| `plan` (built-in + declarative, `mode: "plan"`) | no (read-only) | hub — fine |

Consequences:

1. **Silent hub mutation.** A custom template whose flow is just an `agent`
   node (no preceding build) runs a mutating agent in the developer's
   checkout. Same for `review` in a flow without a prior build. Nothing warns;
   nothing routes the run into a worktree.
2. **Order dependence.** Whether a mutating run is isolated depends on whether
   a *different* node happened to run earlier in the same flow. Flow behavior
   should not depend on node ordering accidents.
3. **Script `cwd: "workspace"` is order-fragile** — it errors unless an agent
   step created the workspace first.
4. **Plan drift** (adjacent, not fixed here): the plan reads the hub at plan
   time; the worktree branches off `default_branch` at build time. No
   staleness check exists between the two snapshots (§7).

## 2. Decision

Move the ensure into the **single chokepoint every agent run already passes
through**: `AgentRunner.startAgent`. A mutating run in local mode gets a flow
worktree unless the node pinned a directory itself.

Why here and not the alternatives:

- **Not per-node** — every new node kind must remember to call
  `ensureFlowWorktree`; declarative templates make that impossible to
  guarantee. This is the bug being fixed.
- **Not flow start** — branch is unknown at flow creation (template-resolved
  at build time), and eager creation pays the deps-setup cost for flows that
  never mutate (§6).
- **`startAgent`, not `NodeDefinition.execute`** — scripts don't go through
  `execute`, and scripts share the same `workspaces/<flowId>` directory, so
  the runner is the only layer that covers both families with one rule.

## 3. Rules

```
startAgent(ctx, input):
  port = agentPortRegistry.forMode(mode)
  if port.execMode === "local":
    if input.mode === "agent" && !input.cwd:            # mutating, unpinned
      branch = input.startingRef
            ?? ctx.flow.mr_branch
            ?? worktreeManager.currentWorktreeBranch(ctx.flow.id)
            ?? worktreeManager.defaultBranchForFlow(ctx)  # devflow/<task-key>-<id6>
      binding = await worktreeManager.ensureFlowWorktree(ctx, branch)
      spec.cwd = binding.dir ?? undefined                # null → hub fallback
    spec.workspace = ctxHelper.requireRunCwd(ctx)
    spec.cwd = input.cwd ?? spec.cwd
```

1. **Mutating runs only.** `mode: "plan"` runs are read-only and stay exempt —
   no worktree churn for judgment runs.
2. **Explicit pins always win.** `build`/`resolve`/`refine` keep passing
   `input.cwd` because they know the exact branch *before* the flow row would
   reflect it (the existing comment at `agent-runner.ts:68-70`). The base
   ensure only fires when no pin was passed, and it is **idempotent** —
   `createWorktree` returns `reused: true` for an existing tree, so
   double-ensuring is harmless.
3. **Branch resolution, in order:** the node's pinned `startingRef` → the
   flow's canonical `mr_branch` → the existing worktree's current head branch
   (never switch branches implicitly) → a manager-derived default
   (`devflow/<task-key>-<flowId-short>`) for flows that never built.
4. **Non-fatal, unchanged.** Creation failure returns `{ dir: null }` and the
   run proceeds in the hub — today's fallback semantics, now surfaced as an
   explicit `error` lifecycle event ("worktree setup failed — running in the
   registered checkout instead").
5. **Fallbacks.** No registered `local_path` or `execution_mode = "cloud"` →
   `{ dir: null }` immediately. (Worktrees are always on — the
   `worktree_mode = "disabled"` kill switch was removed.)

## 4. How each flow looks after this

### 4.1 Default SDLC template (no behavior change)

| Stage | Directory | Notes |
|---|---|---|
| Flow created | — | no worktree (nothing mutates yet) |
| Plan agent | hub | read-only; sees the dev's checkout incl. uncommitted state |
| Approval gate | — | — |
| Build | worktree `workspaces/<flowId>` off `default_branch` | deps setup runs once (fresh tree); event `worktree created at …` |
| Review agent | worktree | was already reaching the worktree via the `flows.worktree_dir` fallback; now guaranteed *and* re-ensured if the tree was swept out-of-band |
| Resolve (comment fixes) | worktree | unchanged — ensure is a no-op reuse |
| Flow finished / failed | worktree removed by the sweep (`flow is finished`), branch deleted if merged | unchanged |

### 4.2 Custom template: start → agent (the fixed hole)

Before: agent ran in the hub, untracked changes landed in the developer's
checkout, branch state of the hub could be clobbered.
After: the run gets `workspaces/<flowId>` checked out on
`devflow/<task-key>-<flowId-short>` (fresh off `default_branch`), deps setup
runs once, the binding is persisted to `flows.worktree_dir`, and follow-up
runs (chat refine, retry) reuse the same tree.

### 4.3 Custom template: plan → decision → agent

Plan and decision run in the hub (read-only). The agent — the first mutating
run — creates the worktree at that moment. Worktree base is the *freshest*
default branch at first mutation, not at flow creation: strictly better than
a flow-start tree that would have aged through the plan/decision stages.

### 4.4 Script nodes in custom templates

- `cwd: "repo"` → hub, documented and deliberate. Unchanged.
- `cwd: "workspace"` → `workspaces/<flowId>`. Two improvements:
  - after any agent run in the flow, the dir now exists (the runner ensured
    it), so the old "run/re-run an agent step first" workaround becomes
    unnecessary in the common case;
  - follow-up (optional, §8): when `cwd: "workspace"` and no workspace exists
    yet, `ScriptNode.workingDir` calls `ensureFlowWorktree` with the flow's
    branch policy instead of throwing — script-only flows become first-class.

### 4.5 Multi-branch plans

Branches build **sequentially** (topologically sorted by `dependsOn`,
`build-node.ts:93`). One worktree per flow; sequential builds switch the
checked-out branch in place via `switchWorktreeBranch` (best-effort — a failed
switch leaves the previous branch checked out and the agent prompt +
`localAgent.ensureBranch` cover branch creation). Option B does not change
this: the runner-level ensure only applies when no pin was passed, and
build/resolve always pin.

### 4.6 Edge cases

| Case | Outcome |
|---|---|
| Crash between `worktree add` and the `flows.worktree_dir` write | startup sweep adopts the orphaned worktree (existing behavior, `worktree-lifecycle.ts:295-298`) |
| Worktree deleted out-of-band | next ensure re-creates it (`prepareDir` clears orphaned leftovers; `createWorktree` takes the fresh path) |
| Worktree exists but on an older branch, unpinned run | branch resolution keeps the tree's current head — never an implicit switch |
| Two flows on the same repo | distinct `workspaces/<flowId>` dirs; worktree registration is per-path |
| Concurrent agent runs in one flow | nodes run sequentially through the pipeline; multi-branch builds are sequential — no concurrent branch switching on one tree |
| Retry of a failed agent node | ensure is idempotent (`reused`), deps setup skipped |
| (kill switch removed — worktrees are always on) | the historical `worktree_mode = "disabled"` fallback is gone |
| Cloud mode / no `local_path` | `{ dir: null }` — unchanged |

## 5. Implementation notes

- `AgentRunner.startAgent` gains the ensure block (§3); `input.cwd` pinning
  stays first-wins.
- `WorktreeManager` gains:
  - `currentWorktreeBranch(flowId)` — read the head branch of an existing
    worktree (pure layer already exposes `worktreeBranchName` +
    `listWorktrees`);
  - `defaultBranchForFlow(ctx)` — deterministic slug
    (`devflow/<task-key>-<flowId.slice(-6)>`), matching the style of
    `branchName()` templates in `build-node.ts:120-123`.
- `ensureFlowWorktree` itself is unchanged (it already handles reuse, base
  resolution, persistence, events, deps setup).
- Tests: extend `scripts/check-worktrees.ts` with a standalone-agent-node
  scenario (ensure fires without a build) and a review-node scenario. (The
  historical `worktree_mode = "disabled"` fallback assertion was removed with
  the kill switch.) The existing reuse/adoption
  scenarios keep passing unchanged.
- Docs: update `docs/worktree-support.md` §"engine manager" to state that the
  ensure lives in the runner and per-node calls are pins, not the mechanism.

## 6. Should the worktree be created at flow start? — No (as default)

Considered and rejected, for four reasons:

1. **The branch doesn't exist yet.** Branch names are template-resolved at
   build time (`{slug}`, `{ticket}`, `{id}`, multi-branch names). A flow-start
   tree would need a placeholder branch and an immediate switch at build —
   two churn points instead of one, and `switchWorktreeBranch` is best-effort,
   so a failed placeholder switch would strand the tree on the wrong branch.
2. **Deps setup is per fresh tree.** The policy (install commands, lockfile-
   hash-gated copies, pnpm virtual store) runs once per *fresh* worktree. A
   flow that ends up plan-only, decision-only, or http-only pays the install
   cost and holds the disk for nothing — exactly the flows that never mutate.
3. **Waiting flows hold worktrees.** Webhook- and schedule-triggered flows are
   created and immediately `active` (`flow.ts:113`), then can sit waiting on a
   delivery indefinitely. The sweep only removes worktrees of *non-active*
   flows, so flow-start creation would pin a fully-installed tree per waiting
   flow, unboundedly.
4. **Nothing is gained.** The ensure fires at the first mutating run, which in
   every real flow is minutes-to-seconds after flow start; the deps setup is
   amortized across the whole flow either way. Flow-start creation only moves
   the latency earlier — it doesn't remove it — at the cost of eager garbage.

**Middle grounds worth keeping on file (not in this change):**

- *Warm deps*: after the first ensure, kick off deps setup in the background
  so the *next* node's ensure doesn't pay it. Only worth it if profiling shows
  the setup noticeably blocks the first run.
- *Prefetch on approval*: pre-resolve the branch at plan-approval time and
  create the tree then (still not flow start). Narrow win; adds a second
  creation path to test. Rejected for now.

## 7. Orca comparison (what the reference implementation does)

Orca's worktree layer (`src/main/runtime/workspaces/workspace-creation.ts`,
`src/main/git/worktree-add.ts` and siblings) informs this design in three
directions:

**Validated by Orca:**

- *Creation is per explicit act, never at session start.* Orca's agent
  startup only builds launch plans/terminals and never mints a worktree;
  every create funnels through one chokepoint (`createManagedWorktree`)
  triggered by user click, CLI, orchestrator dispatch, or automation fire.
  The devflow equivalent of "explicit act" is the first mutating run — §6's
  rejection of flow-start creation mirrors Orca exactly.
- *Setup once-per-create* via a generated runner in the worktree gitdir, with
  an optional wait-for-agent policy. Devflow's once-per-flow deps setup
  matches; Orca's wait policy is the alternative to our non-fatal
  `setupNote` (block the run vs. let the agent self-repair — we chose
  self-repair; revisit if setup flakiness shows up in practice).
- *Provenance + removal journaling.* `branch.<branch>.base` (written at
  create, unset on write failure, read by cleanup) and crash-safe removal
  records are already ported verbatim (`lib/git/worktrees.ts:299,482`).

**Adopted from Orca for this design:**

- *Provenance stamping at ensure time.* Orca stamps every created worktree
  with its creator (automation/CLI/orchestrator). The ensure block should
  pass the triggering node key into `ensureFlowWorktree`'s lifecycle event
  (it already takes `nodeId`) so the event log answers "which node created /
  reused this tree" — cheap, and the sweep's adoption path benefits.
- *Prefetch → intent signal.* Orca's prepared-checkout pool warms at
  composer-open (user intent), not session start. Devflow's analogous intent
  moment is plan approval — which is precisely §6's rejected-for-now
  prefetch middle ground. If build latency matters later, prefetch at
  approval is the Orca-proven shape (prepare `worktree add --no-checkout` at
  approval, consume at first ensure).

**Deliberately not ported:**

- *Always-create + retired-name registry.* Orca never reuses a removed
  workspace's name because agent history may live on disk; it also always
  creates rather than attaching. Devflow's worktrees are engine-internal
  (deterministic `workspaces/<flowId>`, keyed to the flow row, swept by
  status) — ensure-if-missing is correct here; a retirement registry would
  be dead weight.
- *Read-only worktrees.* Orca has none — "which workspace?" is answered by
  intent (`workspaceMode`, dispatch topology). Devflow's `mode === "agent"`
  heuristic is the pipeline-native equivalent of that intent signal.

## 8. Follow-up (same layer): plan-drift gate

`ensureFlowWorktree` is also the natural owner of the plan-staleness check:
it knows the base ref each worktree branched from, and the plan node can
record a snapshot SHA on the flow at plan time. At ensure time, compare:
if the worktree base and the plan snapshot diverge, emit a `lifecycle` event
("plan is N commits behind the worktree base") — warn-only first; a
scoped-replan action can come later. Because the gate lives in the manager,
**every** mutating entry point benefits, not just build.
