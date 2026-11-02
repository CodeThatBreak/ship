---
node_key: git
kind: subsystem
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Git subsystem

## Summary

The git subsystem runs every git subprocess in DevFlow: per-flow clones for cloud diffs, and linked worktrees (with dependency setup) for local-mode agent runs. It is split into a **pure layer** (`lib/git/` — no db/engine imports: bounded exec, worktree mechanics, setup policies, credential hygiene) and an **engine layer** (`lib/engine/runtime/worktreeLifecycle.ts` and `worktreeStatusService.ts` — flow ↔ worktree binding, crash-safe cleanup, status reads). Safety is the design center: bounded exec everywhere, strict worktree listings, ordered removal gates, and credentials that never persist in remotes, logs, or errors.

## Architecture

```mermaid
flowchart TD
  subgraph engine [Engine layer]
    AR["agentRunner (harness)"] -->|"ensureForRun"| WM["WorktreeManager — worktreeLifecycle.ts"]
    FP["flowPoller"] -->|"startup sweepWorktrees"| WM
    WSS["WorktreeStatusService"] --> WT
  end
  subgraph pure [Pure layer — lib/git (no db/engine imports)]
    WM --> WT["Worktrees — worktrees.ts"]
    WM --> WS["WorktreeSetup — worktreeSetup.ts"]
    WS --> DP["depPolicies — depPolicy.ts"]
    WT --> GR["GitRunner — gitRunner.ts / boundedExec.ts"]
    LG["LocalGit — local.ts"] --> GR
  end
  HOST["git-host registry (GitLabHostService)"] -->|"cloneUrl + auth env + redact values"| LG
  GR --> GIT[("git subprocess (execFile)")]
```

- **Pure layer** takes plain inputs (repo path, branch, dir) and returns plain results; it never imports `lib/db` or `lib/engine`.
- **Engine layer** joins the pure layer to db/config state: `flows.worktree_dir`, repo rows, lifecycle events.
- Long-lived instances (`gitRunner`, `worktrees`, `worktreeSetup`, `localGit`, `worktreeManager`) are `processSingleton`s so `next dev` module-graph splits keep one instance per process.

## Bounded exec (`GitRunner`)

All git subprocess I/O goes through `GitRunner` (`lib/git/gitRunner.ts`): `execFile` (no shell), per-call `env` merged over `process.env`, and typed errors. `boundedExec.ts` re-exports the thin `runGit` wrapper plus the timeout constants.

| Constant | Value | Applies to |
|----------|-------|-----------|
| `GIT_COMMAND_TIMEOUT_MS` | 20 s | default git command |
| `GIT_FETCH_TIMEOUT_MS` | 15 s | fetch/push network ops |
| `GIT_WORKTREE_ADD_TIMEOUT_MS` | 120 s | `git worktree add` (per-repo override: `repos.worktree_timeout_ms`) |
| `MAX_GIT_BUFFER` | 50 MiB | stdout/stderr cap |

Failures throw `GitCommandError` (see error taxonomy). A timed-out `worktree add` is rethrown with a hint to raise the repo's worktree timeout in Settings.

## Auth env and credential hygiene

- Auth travels **out of band**, never in persisted URLs. A git-host adapter resolves a `GitRemoteContext` (`{ cloneUrl, env, redactSecrets }`) per repo; `GitLabHostService` (`lib/integrations/gitlab/gitHost.ts`) builds `env` via `gitLabOAuthBasicHeaderEnv` (`lib/git/gitAuthEnv.ts`), which injects an `http.extraHeader` Basic header (`oauth2:<PAT>`) through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0`.
- `stripCredentialsFromRemoteUrl` (`lib/git/stripRemoteCredentials.ts`) removes embedded `user:pass@` from HTTPS remotes; `LocalGit.sanitizeOriginRemote` rewrites a clone's `origin` on reuse.
- `redactGitSecrets` (`lib/git/redactGitSecrets.ts`) masks `//user:pass@` as `//***@` and replaces known secret values (the adapter's `redactSecrets`) with `••••`; `GitCommandError.fromExecError` redacts the command line, stderr tail, and message before they reach logs or the DB.
- Resolver failures throw `AuthedUrlResolutionError`; adapters return empty env/redact lists when no instance matches (push falls back to the user's own git credentials first — see `LocalGit.pushBranch`).

## Workspace layout

`WorkspacePaths` (`lib/git/workspacePaths.ts`) roots everything under `config.workspace.dir()` (`WORKSPACE_DIR`, default `./workspaces`):

| Path | Use |
|------|-----|
| `workspaces/clones/<flowId>` | Full clone for cloud-mode diffs (`.git` **directory**) |
| `workspaces/worktrees/<flowId>` | Linked worktree for local-mode runs (`.git` **file**) |
| `workspaces/arenas/<parentFlowId>` | Merge-back checkout for plan fan-out |

Clones and worktrees never share a directory — the sweep distinguishes them by the `.git` file-vs-directory test, and `WorktreeSetup` refuses nested or overlapping hub/worktree trees.

## Worktree mechanics (`Worktrees`)

`Worktrees` (`lib/git/worktrees.ts`) is a pure, stateless-per-call class with two concurrency guards: one in-flight listing per repo (concurrent callers share the scan) and a per-directory promise chain serializing create/switch/remove.

- **Listing is strict.** `listWorktrees` parses `git worktree list --porcelain -z` and **throws on failure** — a failed scan must never surface as an empty list, or sweepers would prune live worktrees.
- **Create** (`createWorktree`): validates the branch name, reuses an existing registered dir (switching branch when clean), clears only empty/orphaned leftover dirs, then `worktree add --no-track -b <branch> <dir> <base>` (or attaches the existing branch). It records provenance in `branch.<branch>.base`, enables `push.autoSetupRemote` (respecting existing config), and **verifies** the create with a fresh re-list plus a direct probe (HEAD, checked-out branch, shared `--git-common-dir`) — a zero exit code alone is not proof.
- **Removal** is an ordered gate: `preflightRemoval` re-lists fresh and refuses unregistered paths, dangerous paths (`isDangerousWorktreeRemovalPath`: empty, the repo itself, filesystem root, a path containing the repo, the user's home), the main worktree, and dirs containing a nested registered worktree; only then does it report dirtiness. `removeWorktree` runs `git worktree remove --force` with an fs fallback (+ `worktree prune` for the ghost registration), then optionally deletes the branch **merged-only** — ancestry proven against `branch.<branch>.base`, then `HEAD`; unmerged commits are the work product and survive unless `forceBranchDelete`.
- `isWorktreeDirty` (`status --porcelain -z --untracked-files=all`) counts an unverifiable status as dirty — never force silently. `sanitizeWorktreeName` slugs free-text names (unicode-folded, 48-char cap) for flow-derived dirs/branches.

## Worktree setup and dependency policy

`WorktreeSetup` (`lib/git/worktreeSetup.ts`) prepares a fresh worktree for an agent run as an ordered, time-bounded pipeline; every step failure is non-fatal (`{ ok: false, error }` — the engine surfaces it on the agent's prompt for self-repair):

1. **Shared dirs** — per-repo `shared_dirs` symlinked hub → worktree (relative links, never shadowing existing paths; `node_modules` and `.git` segments and `..` traversal are rejected by `normalizeSharedDirSpec`).
2. **Config sync** — untracked config **copied, never symlinked** (default globs `.env*`, `*.rc` from `DEFAULT_SYNC_GLOBS`), never clobbering tracked files.
3. **Warm caches** — best-effort CoW copy of `COMMON_CACHE_DIRS` (`.turbo`, `.nx`, `.next`, `target`, `__pycache__`).
4. **Dependency strategy** — the resolved `DepPolicy` executes through a strategy table (`none` / `command` / `install` / `store-install` / `clone`); `clone` copies dep dirs only after proving hub dirs exist and hub/worktree lockfile hashes match, else falls back to the policy's recorded frozen install.
5. **Setup command** — the per-repo `setup_command` escape valve, always last.

`depPolicies.resolve` (`lib/git/depPolicy.ts`) picks the policy: per-repo overrides first (`skip_install` → `none`, `install_command` → `command`), then ecosystem rules (Node lockfiles — pnpm/npm/yarn/bun — each with a frozen-install fallback), else `none`. Overrides live on the `repos` row. Shell steps run with a 10-minute default timeout (`DEFAULT_SETUP_TIMEOUT_MS`), process-group kill, and `AbortSignal` support. `WorktreeSetup.probe` runs the full pipeline in a throwaway worktree (`devflow/setup-probe-*` branch, force-removed after) to power the repo form's "Test setup" button.

## Engine-side lifecycle (`WorktreeManager`)

`WorktreeManager` (`lib/engine/runtime/worktreeLifecycle.ts`) owns the flow ↔ worktree binding:

- **`ensureFlowWorktree`** — local mode only (`execution_mode !== "local"` returns a null dir). Requires the repo's `local_path`; creates or reuses `workspaces/worktrees/<flowId>`, persists the canonical realpath on `flows.worktree_dir`, and emits lifecycle events. Dependency setup runs **once per flow** on create (reuse skips it). Create failure **throws** — agent runs never fall back to the developer's checkout, which must not be mutated.
- **`ensureForRun`** (called by `lib/engine/harness/agentRunner.ts`) resolves a run's cwd: an explicit pin wins; read-only (`plan`) runs get none; otherwise the worktree's **current** branch is kept (never an implicit switch), falling back to `flows.mr_branch`, then the caller's default. One in-flight ensure per flow.
- **Removal** (`removeFlowWorktree` / internal `removeWorktreeDir`) refuses paths outside the workspace root, persists a `worktree_removals` row **before** git runs, and clears the flow pointer + record on success; when the hub is gone the worktree is plain-deleted.
- **Startup sweep** (`sweepWorktrees`, kicked from `flowPoller.start`): resumes recorded removals, then per repo prunes and strictly reconciles registered worktrees against flows (flow gone, terminal, or repointed → remove with branch delete; a lost column write → adopt), and finally removes unregistered `.git`-file leftovers not owned by an active flow. A listing failure skips that repo entirely.

## Base refs and branch naming

- `resolveWorktreeBaseRef` (`lib/git/baseRef.ts`) walks `origin/<base>` → `<base>` → `origin/master` → `master` and throws `BaseRefNotFoundError` when none exists — it never falls back to the hub's checked-out HEAD. `localBranchBaseCandidates` provides the same chain for diff/base picks that must not throw.
- `assertValidBranchName` (`lib/git/branchName.ts`) rejects empty names, leading `-`, and NUL bytes synchronously, then runs `git check-ref-format --branch`; violations throw `InvalidBranchNameError`. Every branch argument that reaches git argv passes it.

## Error taxonomy

| Error | Raised when |
|-------|-------------|
| `GitCommandError` | Any git exec failure; carries `args`, `killed` (timeout), and the redacted stderr tail (last 500 chars) |
| `BaseRefNotFoundError` | No candidate base ref resolves (lists `configuredBranch` and `tried`) |
| `AuthedUrlResolutionError` | The git-host resolver cannot produce a remote context for a repo URL |
| `InvalidBranchNameError` | Branch name fails the shape guard or `check-ref-format` |

## API surface

### HTTP

| Route | Caller | Purpose |
|-------|--------|---------|
| `GET /api/flows/worktree-status` | `useWorktreeStatus` (`components/flows/hooks/useWorktreeStatus.ts`, key `queryKeys.flows.worktreeStatus`) | Per-flow worktree git state for the flows list |

The route (`app/api/flows/worktree-status/route.ts`) is a thin Node-runtime, `force-dynamic` handler over `WorktreeStatusService.statusesForActiveFlows` (`lib/engine/runtime/worktreeStatusService.ts`): flows with a `worktree_dir` are grouped by repo (one strict listing per repo, concurrency-pooled at 8), and each flow reports `{ path, registered, reason?, branch?, dirty?, ahead?, behind?, pushed?, stat?, mrBranch? }` — `ahead`/`behind`/`pushed` from `LocalGit.localBranchState`, `dirty` from the same `isWorktreeDirty` check removal preflight uses. Repos without a local checkout report `registered: false` with a reason.

### Module surface

| Export | Location | Purpose |
|--------|----------|---------|
| `gitRunner` / `runGit` | `lib/git/gitRunner.ts`, `lib/git/boundedExec.ts` | Bounded git exec |
| `worktrees` | `lib/git/worktrees.ts` | Worktree create/list/preflight/remove |
| `worktreeSetup` | `lib/git/worktreeSetup.ts` | Setup pipeline + probe |
| `depPolicies` | `lib/git/depPolicy.ts` | Dependency-policy resolution |
| `localGit` | `lib/git/local.ts` | Clones, branch diffs, `localBranchState`, `pushBranch` |
| `worktreeManager` | `lib/engine/runtime/worktreeLifecycle.ts` | Flow binding, crash-safe removal, sweep |

## Data model

- `flows.worktree_dir` — canonical path of the flow's bound worktree (NULL = none/cloud).
- `repos` worktree-policy columns — `local_path`, `default_branch`, `install_command`, `skip_install`, `sync_paths`, `shared_dirs`, `setup_command`, `worktree_timeout_ms`.
- `worktree_removals` — crash-safe removal records, written before git removal and deleted on success; survivors resume at the startup sweep (see [`database.md`](./database.md)).

## Out of scope

- Git-host REST/GraphQL operations (MRs, comments, pipelines) — `lib/integrations/**` behind the `gitHostRegistry` port.
- Merge-arena execution and `step_merges` fan-out merge-back records.
- Webhook ingestion and cloud-agent sandboxes (no local git involved).

## Related code index

| Concern | Location |
|---------|----------|
| Bounded exec + timeouts | `lib/git/gitRunner.ts`, `lib/git/boundedExec.ts` |
| Worktree mechanics | `lib/git/worktrees.ts` |
| Setup pipeline | `lib/git/worktreeSetup.ts`, `lib/git/depPolicy.ts` |
| Clones / diffs / push | `lib/git/local.ts` |
| Workspace layout | `lib/git/workspacePaths.ts`, `lib/config.ts` (`WORKSPACE_DIR`) |
| Base refs / branch names | `lib/git/baseRef.ts`, `lib/git/branchName.ts` |
| Credential hygiene | `lib/git/gitAuthEnv.ts`, `lib/git/redactGitSecrets.ts`, `lib/git/stripRemoteCredentials.ts`, `lib/integrations/gitlab/gitHost.ts` |
| Error types | `lib/git/gitErrors.ts`, `lib/git/branchName.ts` (`InvalidBranchNameError`) |
| Flow ↔ worktree binding | `lib/engine/runtime/worktreeLifecycle.ts` |
| Run cwd resolution | `lib/engine/harness/agentRunner.ts` |
| Status reads | `lib/engine/runtime/worktreeStatusService.ts`, `app/api/flows/worktree-status/route.ts` |
| UI consumer | `components/flows/hooks/useWorktreeStatus.ts`, `components/flows/components/FlowsView.tsx` |
