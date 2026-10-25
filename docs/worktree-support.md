# Worktree Support for Local Mode (Proposal)

Date: 2026-10-23 · Reviewed against Orca reference implementation: 2026-10-25 · Status: **Phases 1–3 (core lifecycle + setup policy + UI) implemented**

Companion to `docs/refinement-plan.md` (Phase 3C). Worktrees are the isolation
layer local mode needs: today every local agent run happens in the repo's
registered `local_path`, which can clobber the developer's checkout and makes
two concurrent flows on the same repo impossible.

## Problem

- **Shared checkout.** `FlowContextHelper.requireLocalPath()` hands every local
  run the developer's real working directory. `localAgent.ensureBranch()`
  (`lib/integrations/localAgent.ts`) literally `git checkout`s branches in it —
  an uncommitted user change can be disturbed and the user's checked-out branch
  gets stolen by agent runs.
- **One flow at a time.** Two flows hitting the same repo share one `HEAD`, one
  index, one working tree. Concurrent local runs fight over the branch.
- **Blocked Phase 3C.** Parallel multi-branch builds need each branch to own a
  checkout; the single shared path can't provide that.

## Prior art already in the codebase

The scaffolding is half-built and unused:

- `localGit.addWorktree()` / `removeWorktree()` in `lib/git/local.ts:198`
  ("Phase 3C" helpers) — no callers.
- `AgentStartInput.cwd`, `LocalAgentInput.cwd` and `resumeOpts.local = { cwd }`
  in `lib/integrations/cursorSdk.ts:162` — threaded through `agent-runner` →
  `localAgent` → `cursorSdk`, but nothing ever sets `cwd`.

So the work is mostly wiring, not new machinery.

## Design principles

1. **Ecosystem-agnostic core.** The worktree layer knows nothing about Node,
   npm, or any language/toolchain. It deals in git operations, directories, and
   a *dependency-setup policy* that is data resolved per repo — not hardcoded
   PM branching inside engine code. DevFlow does not assume its registered
   repos are JS; worktree support must work for a Go, Rust, or Python repo with
   zero special cases (their default policy: no-op deps, dotfile sync).
2. **Layer boundary: `lib/git/*` stays pure.** Worktree mechanics
   (create/locate/remove/sweep) accept plain inputs (repo path, branch, dir
   spec) and return plain results — no `db`, engine, or framework imports.
   Engine nodes and UI consume it via thin adapters. The module should be
   liftable into any TS codebase verbatim.
3. **Strategy table, not if-chains.** Dependency setup is decided by a
   declarative spec (below); adding an ecosystem means adding a table row, not
   editing node logic. The per-repo override fields are part of that spec, so
   odd repos (monorepos, non-JS, vendored deps) are configured, not special-cased.
4. **Settings are data; UI is dumb.** New repo fields are forms on the
   Repositories page only — no logic lives in components.

## Design

### Layout: hub + external worktrees

The registered `local_path` stays exactly what it is today: the developer's real
checkout, serving as the **hub** (the `.git` home that owns origin refs, config,
and shared hooks). It is never checked out or mutated by agent flows again.

Each flow's worktree lives **outside** the repo tree, under the central DevFlow
workspace dir:

```
workspaces/
└── <flowId>/            ← git worktree, branch = flow's build branch
    ├── (checked-out files)
    └── (deps + caches   ← materialized per the repo's dependency-setup policy)
```

Created once at build start: `git worktree add <path> -b <buildBranch> origin/<default_branch>`.
Every worktree bases off `origin/main` (the repo's default branch) — all
worktrees start from the same snapshot and diverge only via their own branch.
The flow-id suffix already baked into `buildBranch()` (`bugfix/dev-123-a7f3c2`)
guarantees no two flows ever want the same branch, which git requires (a branch
can be checked out in exactly one worktree at a time — that exclusivity is the
mechanism that removes today's checkout-race class of bugs).

Rebase-before-MR can be added later; staleness behaves no worse than today's
(branch built from main at approve time).

### Dependencies in the worktree (ecosystem-agnostic)

A worktree starts as a tracked-files-only checkout — no dependency install, no
untracked config. Toolchains run in it must not resolve into the hub's
dependency state either (see resolution mechanics below). Setup therefore
resolves a **dependency-setup policy declaratively** (ordered; first hit wins)
and carries it out mechanically — the engine never knows which ecosystem a repo
belongs to:

```ts
// lib/git/dep-policy.ts — pure, no db/engine imports
export interface DepPolicy {
  strategy: "clone" | "store-install" | "install" | "command" | "none";
  command?: string; // for "command"
  timeoutMs?: number;
}
```

1. **Per-repo override (wins over everything)** — new optional fields on the
   Repositories page: `install_command` → `command` (workspace-aware commands
   for fussy monorepos), `skip_install` → `none` (non-JS repos, vendored deps,
   terraform, etc.). Odd repos are configuration, never code paths.
2. **Recognized ecosystem** — a small strategy table keyed by detectable
   manifest+lockfile pairs; Node package management is just one row, not the
   axis of design:
   - *Node* (`package.json` + lockfile): pnpm repos with the global virtual
     store prefer a real near-instant `pnpm install --frozen-lockfile` (see
     below); otherwise clone/copy the dep cache from the hub (APFS `cp -c`
     clonefile / Linux `cp --reflink=auto` — instant CoW; plain `cp -R`
     fallback) **only if hub and worktree lockfile hashes match**, else a real
     frozen install (`npm ci` / `yarn --immutable` / `bun install`). Never
     symlink dep trees into the hub — an agent `npm install <pkg>` inside the
     worktree would then write into the developer's real checkout.
   - *Other ecosystems* (`Cargo.toml`, `go.mod`, `pyproject.toml`, …): their
     standard fetch/sync command where applicable; where no cheap clone story
     exists, the row is simply always `install`. Adding an ecosystem = adding
     a table row, not editing node logic.
   - Detectable but non-Node logic (toolchains like cargo/go) lives in the
     same pure table module, so `lib/git/*` stays free of language knowledge.
3. **Nothing recognizable** → `none`.

Plus, for every strategy, an **untracked-config sync** — copy (never symlink)
config surfaces from the hub that the worktree needs but git doesn't carry:
default globs (`.env*`, `*.rc`) plus a per-repo `sync_paths` override in the
Repositories page. Copy, **never symlink** — agents must not be able to mutate
real hub files through a link.

Cross-cutting rules (all strategies):

- Setup emits a DevFlow lifecycle event ("setting up worktree…") like any other
  step, is time-bounded (`timeoutMs`), and **fails non-fatally**: the agent's
  run prompt gets one line ("worktree deps setup failed: <err>") and can
  self-repair by running its own setup.
- Cache dirs (`.turbo/`, `.nx/`, `.next/`, `target/`, `__pycache__/` — a shared
  "common cache dirs" list) may be copied from the hub when present for warm
  builds; misses are fine.
- **pnpm global virtual store** is deliberately framed as a Node-row
  implementation detail, not a design axis
  ([pnpm.io/git-worktrees](https://pnpm.io/git-worktrees)): with
  `virtualStoreType: global`, each worktree's deps are symlink-only trees into
  one global content-addressable store — subsequent worktree installs are
  near-instant, near-zero disk, and each worktree still owns its per-branch dep
  state. Enable via user-level config flag, **not** by editing the tracked
  `pnpm-workspace.yaml` in the worktree (that would leak into the MR diff). One
  shared store assumes a single trust boundary (single-user DevFlow today —
  fine; multi-tenant would need a per-boundary store).

Why bother at all: the worktree persists for the whole flow (build → fixes →
re-gates → resolve, including session resumes), so dependency-setup cost is
**per flow, not per run**.

### Resolution mechanics (why self-containment is mandatory)

Package resolution is a plain directory walk per import — nearest dependency
directory first, then parent directories, up to `/`. Git's worktree concept is
invisible to build tools. Consequences (illustrated with a Node case, but the
walk shape is the same shape everywhere — Go modules in GOPATH-mode, Python
`site-packages` on `PYTHONPATH`, etc.):

- Worktree **nested inside the repo** (as the current unused helper does:
  `<repo>/.worktrees/…`): tsc silently resolves types from the hub's
  `node_modules` — the flow's checks "pass" against a dependency tree that is
  never shipped, breaking exactly where DevFlow depends on them (pre-push
  type-check/lint gates).
- Worktree **outside the repo**: the walk finds nothing and fails loudly —
  which is the honest failure we then repair via setup.

This is the second (after checkout-race) reason the worktree must live outside
the repo tree.

### Monorepos

- Git level: worktrees operate at the repo root; the full workspace ships as
  tracked files, so a root worktree contains every package on the flow's
  branch. No special git handling.
- Install: same rules at the root, workspace-aware — pnpm/yarn/npm workspace
  installs work unchanged. The `install_command` override covers selective
  installs (`pnpm install --filter web`).
- `node_modules` copying works *better* for npm/yarn-workspace monorepos:
  `node_modules/web → ../../packages/web`-style links are relative, so a copy
  under the worktree root re-resolves to the worktree's own packages
  automatically. pnpm's links point into both its in-worktree `node_modules` and
  the global store (hardlinks) — copies preserve both. Watch for absolute paths
  left in `.bin` shims/tools caches; the non-fatal self-repair covers escapes.
- One branch per worktree (per flow) — not per package. Multi-package flows
  share one worktree; per-package isolation would need sparse-checkout
  worktrees, explicitly out of scope until Phase 3C actually wants it.

### Lifecycle & cleanup

- **Create:** on the build node start (and fix agents / resolve follow-ups
  reuse the same path). Plan node needs no worktree (runs against the hub —
  read-only exploration).
- **Persist:** through the whole flow, because agent session resumes pass
  `cwd` and expect the same tree (resume plumbing already exists).
- **Remove:** when the flow reaches a terminal state (merged/closed) or the
  flow is deleted — `git worktree remove --force` + fs fallback (helper
  exists), freeing the worktree's deps and caches.
- **Sweep:** at server start, `git worktree prune` + reconcile-like pass listing
  orphaned `workspaces/<flowId>/` dirs whose flows are terminal or whose
  worktree metadata points nowhere (crash-recovery path — mirrors how reconcile
  handles orphaned runs).
- Persist the worktree path on the flow row (e.g. `flows.worktree_dir`) so
  restarts can find and clean the right tree.

Mechanics reminder (for reviewers): all worktrees share the hub's object
database; objects/refs (incl. `origin/*`) are shared and updated by fetches from
any worktree; repo-level config and hooks are shared. Files, `HEAD`, index,
untracked files and stash are strictly per-worktree. A branch cannot be checked
out in two worktrees — that exclusivity is the core cross-flow safety property.
Shared-ref/config surface is identical in risk to today's single-checkout model.

### Wiring (files to touch)

| Concern | Where |
|---|---|
| Worktree create/locate/remove | `lib/git/local.ts` (helpers exist; add central-dir path + purity constraint: no db/engine imports) |
| Dependency-setup policy table + sync | new `lib/git/dep-policy.ts` (pure: repo tree in, `DepPolicy` out; ecosystems = rows) |
| Worktree setup executor | new `lib/git/worktree-setup.ts` (carries out a policy + untracked-config sync; plain inputs/outputs) |
| Path on flow | `flows.worktree_dir` (migration), set at build start |
| Run cwd | build/fix/resolve nodes pass `AgentStartInput.cwd = ctx.worktree ?? localPath` (plumbing exists, no callers yet) |
| Branch detection fix | `finalizeBuild`/refine currently read `currentBranch(requireLocalPath())` — must read the worktree (or rely on `flows.mr_branch`, which is already set) |
| Settings | per-repo `install_command` / `skip_install` / `sync_paths` / `shared_dirs` / `setup_command`; global "worktree mode" default-on; pnpm global-virtual-store toggle (all data, no logic in UI) |
| Cleanup | flow terminal/deletion hooks + startup sweep |

## Risks / open questions

- **First-run cost per repo** for repos whose policy is clone/install (Node
  without the pnpm store, cargo, …). Acceptable because it's once per flow;
  the pnpm-store row and `none` rows avoid it entirely.
- **Absolute-path leaks** in tool caches when copying — mitigated by non-fatal
  install self-repair; verify no agent step depends on a cache dir by absolute path.
- **Repo ownership**: if the user deletes or moves their `local_path`, worktrees
  still work until they lose the object store; startup sweep should surface
  "hub missing" as a repo-health warning (Settings already validates local paths).
- **Disk growth** on clone-heavy heavy monorepos — pnpm-first strategy + cleanup
  rules keep this bounded; per-repo override (`skip_install`) is the escape valve.
- **Same-trust-boundary requirement** for a shared pnpm global store (single-user
  assumption documented above).
- **Genericity guardrail for implementation order:** ship v0 with only the
  `none`/`command`/Node rows of the policy table; every other ecosystem
  defaults to `none` until its row is added. The core (worktree lifecycle +
  policy executor) must be testable with zero ecosystem rows — that's the
  proof the layer stayed generic.

---

## Orca reference implementation review (2026-10-25)

Orca (`~/orca`, Electron) ships the same idea at production
scale: every workspace in its UI *is* a git worktree. Studying its
implementation validates this proposal's core decisions and adds concrete
hardening patterns we should adopt. Orca's core lives in `src/main/`
(`repo-worktrees.ts`, `ipc/worktree-remote.ts`, `ipc/worktree-logic.ts`,
`git/worktree-add.ts`, `git/worktree-create-preparation.ts`,
`worktree-removal-safety.ts`, `worktree-background-removal.ts`).

### What matches (validation, no change needed)

- **Worktrees outside the repo tree.** Orca puts every worktree in a central
  workspace dir (`<workspaceRoot>/<repoName>/<slug>`), never inside the repo,
  for exactly the dependency-resolution reason in "Resolution mechanics" above.
- **The developer's checkout is a hub, never mutated.** Orca calls it the main
  worktree and agent flows never touch it.
- **Declarative, ecosystem-agnostic setup.** Orca never installs dependencies
  itself. Repos declare `scripts.setup` in `orca.yaml`; Orca additionally
  symlinks user-declared shared dirs and *copies* `.worktreeinclude` paths
  (copy, never symlink — same anti-mutation rule as our `sync_paths`). This is
  the same shape as our `dep-policy` table; it confirms the strategy-table
  approach is the production-proven one.
- **One branch per worktree.** Orca leans on git's branch-exclusivity
  guarantee exactly as our design does.

### What we should adopt (refinements to this plan)

1. **Verify every create with a strict re-list.** After `git worktree add`,
   Orca re-runs `git worktree list --porcelain` and, if the row is missing,
   probes the created path directly (`rev-parse --verify HEAD`, checked-out
   ref) so a create never abandons a checkout git already wrote. Our plan
   treated a successful `worktree add` exit code as proof — it isn't always
   (timing, maintenance locks). Adopt: list-after-create with a probe fallback.
2. **Removal preflight is a separate, ordered gate.** Orca's removal does, in
   order: fresh strict re-list → refuse dangerous paths (empty path, the repo
   itself, filesystem root, anything inside the repo, the user's home) →
   refuse removing a worktree that contains a *nested registered worktree* →
   dirty check via `git status --porcelain --untracked-files=all` → only then
   `git worktree remove`. Our plan said "remove at terminal state"; the
   preflight list is the missing detail. Adopt verbatim.
3. **Branch cleanup is separate from worktree removal and merged-only by
   default.** Orca deletes the branch only if fully merged into its base
   (unmerged commits survive — they're the work product); force-delete is an
   explicit, user-visible action. Our plan implied branch deletion came with
   the worktree. Adopt: `deleteBranchAfterWorktreeRemoval` semantics —
   merged-only default, explicit force elsewhere.
4. **Crash-safe removal records.** Git drops a worktree's registration even
   when the directory delete fails, so a naive flow loses the leftover
   forever. Orca persists a removal record to disk *before* running git, and
   on startup resumes interrupted removals. This mirrors how `reconcile.ts`
   already handles orphaned agent runs. Adopt: persisted removal record +
   startup sweep resume (folds naturally into the sweep in "Lifecycle &
   cleanup").
5. **Post-create config side effects.** Orca sets, after every create:
   - `git config --local branch.<branch>.base <effectiveBase>` — cheap,
     durable provenance of what the branch was built from (better than
     re-deriving base for later diffs/rebase).
   - `git config --local push.autoSetupRemote true` — makes a first
     `git push` from a fresh worktree branch just work.
   Adopt both; each is one line in the create flow.
6. **Listing via porcelain, parsed once, coalesced.** `git worktree list
   --porcelain -z` parsed by a dedicated parser; one in-flight scan per repo
   (coalesced); scan failure is *strict* — a failed listing must never be
   published as an authoritative empty list (it would prune live worktrees).
   For DevFlow's single server process, full mutation-generation fencing is
   overkill, but in-flight coalescing + the strict-failure rule are cheap and
   prevent real bugs.
7. **Name hygiene.** Slug sanitization (unicode-safe, collapse `..`) with a
   suffix collision loop (`name`, `name-2`, …) checking branch conflicts and
   disk collisions before create; branch prefix strategy (`<user>/<slug>`).
   Our flow-id-based paths already guarantee uniqueness, but adopted naming
   rules matter for the branch name and for any user-visible slug.

### What we deliberately skip (Electron/remote-host machinery)

These solve problems DevFlow doesn't have; each is listed with why:

- **Preparation pool / prefetch** (`.orca-preparing/` detached locked
  checkouts, `worktree move` finalize): a UX optimization for interactive
  create-composer bursts. Our creates happen server-side at build start; 1–2 s
  of checkout latency is acceptable.
- **WSL / SSH / remote execution hosts**: DevFlow runs where its server runs.
- **Multi-host metadata ownership** (`hostId`-qualified rows, identity alias
  tables): only needed when the same `repoId::path` can exist on several
  hosts. DevFlow's unit of attachment is the flow, stored in SQLite.
- **Worktree lineage (parent/child) + per-path `instanceId` rotation**: for
  nested agent orchestration trees. Not needed for v1; the `instanceId`
  pattern is worth remembering if flows ever spawn child flows on the same
  path.
- **PTY teardown / per-worktree `HISTFILE` / watcher removal gates**:
  terminal-process concerns of the desktop app.
- **Retired-name registries / generated-name tiers**: Orca auto-generates
  names; ours are flow-derived, so no reuse hazard.
- **Catalog versioning fan-out**: multi-window Electron clients need
  stale-projection guards; one server process doesn't.

### Path layout decision

Orca nests per repo: `workspaces/<repoName>/<slug>`. Our proposal uses
`workspaces/<flowId>` (continuity with the existing per-flow clone dir and
seed scripts). Keep `workspaces/<flowId>`: the flow id is already unique,
sweep/backfill can join against `flows.worktree_dir`, and renaming dirs would
churn existing seed data. If a per-repo view is ever wanted in UI, derive it
from the flow's repo column — no filesystem change needed.

## Implementation plan (phased, post-review)

### Phase 1 — core lifecycle (no settings, no deps policy)

> **Shipped 2026-10-25.** `lib/git/worktrees.ts` — the pure `Worktrees` class
> (create/list/preflight/remove, exported as the `worktrees` singleton like
> `localGit`) + `lib/engine/worktree-lifecycle.ts` — the `WorktreeManager`
> engine service (`processSingleton`, like the other engine services) owning
> the flow binding, removal records, and sweep; `flows.worktree_dir`
> migration; build/refine/resolve pass the worktree as run cwd (branch
> detection reads it too); startup sweep runs from `FlowPoller.start()`.
> Kill switch: `worktree_mode` setting = `"disabled"` falls back to today's
> hub behavior. Verified by `scripts/check-worktrees.ts`
> (`npx tsx scripts/check-worktrees.ts`) — porcelain parser, name hygiene,
> real-git create/remove/branch-cleanup lifecycle, and an engine-adapter
> smoke test against an isolated temp DB. Terminal-state/deletion hooks don't
> exist yet (nothing sets `flows.status` to done/failed and no flow deletion
> exists) — the sweep covers terminal + missing flows, and
> `worktreeManager.removeFlowWorktree(flowId)` is ready for those hooks when
> they land.

1. New `lib/git/worktrees.ts` — **pure** (no db/engine imports), absorbing
   and replacing the `localGit.addWorktree/removeWorktree` helpers:
   - `parseWorktreeList(raw)` — porcelain `-z` parser (shared, unit-tested).
   - `listWorktrees(repoPath)` — coalesced, strict (throws on git failure;
     callers decide how to soften).
   - `createWorktree({repoPath, dir, branch, base})` — base resolution
     (requested → `origin/<default>` fallback chain as in
     `localBranchState`), `worktree add --no-track -b`, post-config side
     effects (refinement 5), strict re-list verification (refinement 1).
   - `preflightRemoval({repoPath, wtPath, hubPath, home})` — dangerous-path
     + dirty + nested-worktree checks (refinement 2).
   - `removeWorktree({repoPath, wtPath, deleteBranch})` — preflight → remove
     → merged-only branch delete (refinement 3) → fs fallback.
   - `sanitizeWorktreeName(input)` — port of Orca's slug rules.
2. Migration: `flows.worktree_dir TEXT` on the flows table.
3. Build-start wiring: the build node (and fix/resolve follow-ups) ensures a
   worktree exists (`flows.worktree_dir` set if missing) and passes
   `AgentStartInput.cwd = worktreeDir ?? localPath` — plumbing already exists,
   no callers yet. Branch detection in `finalizeBuild`/refine reads the
   worktree (or `flows.mr_branch`) instead of the hub.
4. Lifecycle hooks: remove on flow terminal state + flow deletion; record
   persisted before git runs (refinement 4).
5. Startup sweep: `git worktree prune` + resume recorded removals + remove
   `workspaces/<flowId>` dirs whose flows are terminal or gone.

### Phase 2 — setup policy

> **Shipped 2026-10-25.** `lib/git/dep-policy.ts` — the `DepPolicyResolver`
> class with ecosystem rules as polymorphic objects (`NodeRule` covers pnpm/
> npm/yarn/bun; per the genericity guardrail every other ecosystem still
> defaults to `none` until its rule is added) — overrides first, rules second,
> `none` last; exported as the `depPolicies` singleton, pure (no db/engine
> imports). `lib/git/worktree-setup.ts` — the `WorktreeSetup` executor as an
> ordered step pipeline of `SetupStep` classes (symlink `shared_dirs` → copy
> config globs → warm caches → dep strategy → `setup_command`), with the dep
> strategy itself dispatched through a strategy table of `DepStrategyRunner`
> classes (`NoneStrategy` / `CommandStrategy` / `CloneStrategy` — the clone
> gate proves hub dep dirs + hub/worktree lockfile hashes at execution time
> and falls back to the recorded frozen install). Everything time-bounded;
> every failure is a non-fatal `{ ok:false, error }` result, never thrown past
> the engine.
>
> Per-repo columns: `install_command`, `skip_install`, `sync_paths`,
> `shared_dirs`, `setup_command` (migration + schema + API; forms are Phase 3).
> The copy-vs-symlink tension between the design section and the Orca bullets
> was resolved as: `sync_paths`/default globs are **always copied** (never
> symlinked — agents must not mutate hub files through a link), while
> `shared_dirs` is the one sanctioned symlink surface (relative links, created
> before setup, never over an existing worktree path, `node_modules`/`.git`
> denied). The engine manager (`ensureFlowWorktree`) now returns a
> `{ dir, setupNote }` binding: setup runs once per flow on a fresh worktree
> (reuse skips it), emits "setting up worktree deps…" like any other step, and
> a failure puts one line — "worktree deps setup failed: <err>" — on the
> build/refine/resolve run prompts for agent self-repair. Settings API exposes
> `worktree_mode` and `pnpm_virtual_store`. Since the runner-ensure follow-up
> (`docs/worktree-ensure-runner.md`, shipped 2026-10-25) the ensure lives in the
> runner: `AgentRunner.startAgent` calls `WorktreeManager.ensureForRun` for
> every unpinned mutating local run — the per-node `ensureFlowWorktree` calls
> in build/resolve are *pins*, not the mechanism. Verified by the extended
> `scripts/check-worktrees.ts` (policy table incl. overrides/pnpm-store rows,
> glob expansion, clone gate + fallback, shared-dir rules, executor
> non-fatalism, and engine-adapter setup lifecycle against an isolated DB).

- `lib/git/dep-policy.ts` (pure strategy table) and `lib/git/worktree-setup.ts`
  (executor) exactly as in "Dependencies in the worktree" above, plus the
  Orca-confirmed extras: symlink user-declared shared dirs *before* setup,
  copy untracked config globs, non-fatal failure surfaced to the agent prompt.
- Per-repo settings fields: `install_command`, `skip_install`, `sync_paths`,
  `setup_command` (Orca's `scripts.setup` analog — an explicit escape valve
  alongside the auto-detected policy).

### Phase 3 — UI

> **Shipped 2026-10-25.** Repositories page: the per-repo setup-policy fields
> (`install_command`, `skip_install`, `sync_paths`, `shared_dirs`,
> `setup_command`) as plain forms prefilled from the repo row, plus global
> `worktree_mode` / `pnpm_virtual_store` toggles in the Agent-execution
> section — all data, no logic in components. Flow cards: a worktree badge
> (branch, dirty dot, ↑ahead / ↓behind, hover = full path + pushed state) fed
> by the new batch endpoint `GET /api/flows/worktree-status` (listWorktrees +
> `localBranchState`, now reporting `commitsBehind` too), refreshed every 5s
> while a local flow is active — the polling equivalent of "refreshed on flow
> events" for the index page, which has no event stream. Unregistered/gone
> worktrees render as an amber "wt?" badge with the reason instead of hiding.
> Verified by the extended `scripts/check-worktrees.ts` (endpoint against the
> isolated temp DB: registered/dirty/ahead/pushed fields, stale-pointer
> reporting).

- Repositories page: the three new fields (forms only, no logic).
- Flow cards: worktree status (dirty, ahead/behind, path) via
  `listWorktrees` + `localBranchState`, refreshed on flow events.
