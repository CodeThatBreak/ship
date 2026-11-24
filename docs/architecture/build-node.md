---
node_key: build
kind: builtin
status: current
owner: engine+flows
last_reviewed: 2026-11-01
---

# Build node

## Summary

The build node turns the approved plan into code: it runs a coding agent against the plan, pushes a feature branch (in a local git worktree or a cloud checkout), publishes a `diff` artifact, and gates on developer approval. Approval is a built-in chain action (`approve_build`) that creates the merge request — with a bounded commit-fix agent on push rejection — and hands off to the pipeline gate. Multi-branch plans build as sequential per-branch runs tracked in the `branches` table.

## Capabilities contract

| Field | Value | UI / engine effect |
|-------|--------|-------------------|
| `refinable` | `true` | Chat rail is shown; a message reruns the build with the text as `feedback` (the `build_refine` prompt). |
| `chatMode` | — | Generic `NodeChat` rail (refine / converse toggle). |
| `promptNode` | — | Prompt preview reads `previewPrompt` via `GET /prompt?node=build` directly. |
| `panelTitle` | `Code changes` | Panel header title. |

Engine-only (not serialized to UI):

- `builtinApproval: true` — approval uses `approve_build` (the MR-creation chain), never generic `approve_node`.
- `chainRole: build` — the SDLC chain resolves the build role by key.
- `edges: [[pipeline, "next"]]`, `order: 20` — graph position between plan and pipeline.

## User-visible phases

### Phase 1 — Build running

- **Entry:** Plan approved (`approve_plan` advances into build); the approved plan artifact is the run input.
- **Surface:** Panel running state (`Agent is implementing the plan…`) plus the event feed; the plan checklist turns green as the agent reports progress.
- **Action:** None required; chat can steer (Phase 3).
- **Outcome:** Branch pushed, `diff` artifact saved, node `awaiting_approval`. A multi-branch plan produces sequential per-branch runs (topo-sorted by `dependsOn`); each branch row moves `pending` → `building` → `awaiting_approval`.

### Phase 2 — Diff review and approval

- **Entry:** Node (or a branch row) `awaiting_approval`.
- **Surface:** `BuildView` — latest `diff` artifact, per-branch cards with status chips and MR links.
- **Action:** `Accept & create MR` (single branch, per-branch, or `Accept all & create MRs`) → `approve_build` with optional `branch`.
- **Outcome:** Node `approved`; the chain creates MRs (bounded commit-fix agent on hook rejection, `max_commit_fix_attempts`, default 2). Failure emits `mr_failed` and reverts to `awaiting_approval` — the button becomes a retry. Success advances to the pipeline gate.

### Phase 3 — Chat refine

- **Entry:** Any time after a build agent exists (or none — see guards).
- **Surface:** Chat rail.
- **Action:** Send a message → rerun with `feedback` (refine mode) or a read-only question (converse mode).
- **Outcome:** Follow-up run on the same branch, new `diff` artifact (meta carries `feedback`), node back to `awaiting_approval`.

## UI architecture

### Workspace routing

`components/flows/panels/panelFactory.tsx`:

- Panel: `node.type === 'build'` → `BuildView`.
- Chat: `capabilities.refinable` (no `chatMode`) → generic `NodeChat`.

### Panel (`BuildView`)

- Reads `node.artifacts` (kind `diff`), `flow.branches`, `flow.planSteps` from the panel context; no own fetching beyond `ArtifactLoader`.
- Single-branch: latest diff, footer approve button, `mr_failed` error alert derived from the event stream (`mrErrorFor`).
- Multi-branch: per-branch cards (status chip, MR link, per-branch approve), `Accept all & create MRs` when every branch awaits.
- Busy state: `approved` without `mr_url` renders a "Creating the merge request" spinner until the MR exists.

### Chat rail

Generic `NodeChat`: refine sends rerun the node with the message as `feedback`; converse questions hit the existing agent without state changes. Sends go to `POST /api/flows/:id/chat` with `nodeKey`.

### Async states

- Running: `PanelShell` `runningLabel`; MR creation: inline spinner alert.
- Diff loading: `ArtifactLoader`; empty: `EmptyHint` ("No changes yet.").
- Worktree badges (flows list): `useWorktreeStatus` polls `GET /api/flows/worktree-status` every 5 s with `keepPreviousData` (dirty / ahead / behind per local flow).

### Key files

- `components/flows/panels/views/components/BuildView.tsx`
- `components/flows/panels/components/node/NodeChat.tsx`, `components/flows/panels/panelFactory.tsx`
- `components/flows/hooks/useWorktreeStatus.ts`

## Backend architecture

### Node class

`BuildNode` (`lib/engine/nodes/kinds/build/buildNode.ts`) extends `AgentRunNode<BuildInput, BuildOutput>`; key `build`.

### Collaborators

- `BuildRunSupport` — branch naming, worktree binding, result-branch detection, `diff` artifact writes.
- `BranchStore` (`branchStore`) — `branches` table rows: status/MR updates, run tagging for per-branch cost.
- `planSteps` — checklist reads (`markdown`) and `build-progress` application (`markDone`).
- `prompts` (PromptLibrary), `branchNamer`, `worktreeManager`, `mcpSourcesOf` — prompt assembly, naming, local checkouts, ambient MCP config.

### Run lifecycle (`run`)

1. `triggerRuns(ctx)`: the latest `plan` artifact is required ("no plan to build — approve the plan first"). Multi-branch plan metas topo-sort into one run per branch with `before`/`after` hooks maintaining branch rows.
2. `run(ctx, input, config)`: `feedback` present → `refine`. Otherwise compose the prompt (instructions + scoped plan + checklist block with the `build-progress` contract; the `prompt_body` knob folds in), bind the worktree, and `execute` the agent on the computed branch.
3. `finalizeBuild`: apply `build-progress` to the checklist, resolve the pushed branch (worktree HEAD locally, agent-reported in cloud), set `flows.mr_branch`, upsert the branch row (`gitBranch`, `tagRun`), save the `diff` artifact, return `awaiting_approval`.
4. Orphaned runs (restart mid-build) recover via `recover` / `recoverBranch`: rebuild the `diff` artifact from the branch and re-gate.

### Chat lifecycle (`chat` / `converse`)

No override: the default `AgentRunNode.chat` reruns the node with the message mapped into `feedback` (`build_refine` prompt, `followUpOn` the recorded agent). With no prior agent, the refine degenerates into a full build of the latest plan plus a "Developer note".

### Approval and advance

`approve_build` → `flowEngine.approveBuild` → `SdlcChain.approveBuild` — mark `approved`, create MRs via `mergeRequests.createWithFixes` (bounded commit-fix), then `advanceFrom(build)` onto the build → pipeline edge.

### Branch naming

Built-in `{prefix}/{slug}-{flowIdSuffix}` (`feature`/`bugfix` prefix from the ticket type); the `branch_pattern` knob accepts the tokens `{prefix} {slug} {ticket} {id} {suffix}`.

### Key files

- `lib/engine/nodes/kinds/build/buildNode.ts`, `buildRunSupport.ts`, `branchStore.ts`, `schema.ts`
- `lib/engine/nodes/chains/sdlcChain.ts` (`approveBuild`)

## API surface

### HTTP

| Route | Caller | Purpose |
|-------|--------|---------|
| `POST /api/flows/:id/action` | `BuildView` | All actions below. |
| `POST /api/flows/:id/chat` | `NodeChat` | Refine / converse turns → `BuildNode.chat`. |
| `GET /api/flows/:id/prompt?node=build` | Prompt preview (`useFlowPrompt`) | `previewPrompt` assembly (same path as `run`). |
| `GET /api/flows/worktree-status` | `useWorktreeStatus` (flows list) | Per-flow worktree `dirty` / `ahead` / `behind` for local flows. |
| `GET /api/flows/:id` | Flow snapshot | `branches` and `planSteps` checklist state. |

### Flow actions

| Action | When | Engine |
|--------|------|--------|
| `approve_build` (optional `branch`) | Diff approved | MR-creation chain. |
| `retry` / `cancel` | Failed / stuck run | Standard node lifecycle. |

### Actions not used

- `approve_node` — build approval is always `approve_build` (`builtinApproval: true`).
- `approve_plan`, `update_plan_steps`, `set_plan_step` — plan-node actions.

## Data model

### Input

`BuildInput`: `plan` (nullable; required unless `feedback`), `prompt`, `branchInfo` (`{name, title?, scope?}`), `feedback`, `model`. Multi-branch runs carry a `branchInfo` per branch.

### Output / artifacts

`BuildOutput`: `{branch, latestArtifact, branchName?}`. Artifacts: kind `diff`, meta `{branch, stat, branchName?, feedback?, recovered?}`.

### Side effects

- `branches` rows per plan branch (status, `git_branch`, `mr_url`/`mr_iid`); `runs.branch_id` tagging.
- `plan_steps`: checklist rows synced from the published plan, updated by hand edits and by `build-progress`.
- `flows.mr_branch` set to the result branch; local worktrees under the flow's workspace.

## Agent contracts

### Prompt keys

`build` (run), `build_refine` (chat refine).

### Response shapes

Whole build: free-form reply plus a terminal ` ```json build-progress ` block `{"completed": ["s1", …]}` — parsed into checklist `done` marks.

### Retries and guards

- Missing plan throws before any run; refine without an agent falls back to a full build with the feedback as a developer note.
- Branch names validated (`rejectInvalidBranchNameShape`, `assertValidBranchName`).
- Bounded fix loop: `max_commit_fix_attempts` (MR creation) — exhaustion fails visibly, never loops silently.

## Out of scope

- Plan authoring and branch decomposition — see `plan-node.md`.
- MR creation internals (`mergeRequests` service, commit-fix), the pipeline gate, review/resolve — separate docs.
- Worktree lifecycle internals (`worktreeManager`) and webhook/poller machinery.

## Related code index

| Concern | Location |
|---------|----------|
| Build def (run / refine / recover) | `lib/engine/nodes/kinds/build/buildNode.ts` |
| Shared branch/worktree/diff machinery | `lib/engine/nodes/kinds/build/buildRunSupport.ts` |
| Input/output + trigger payload schemas | `lib/engine/nodes/kinds/build/schema.ts` |
| Branch rows | `lib/engine/nodes/kinds/build/branchStore.ts` |
| MR-creation chain on approval | `lib/engine/nodes/chains/sdlcChain.ts` |
| Panel / chat rail | `components/flows/panels/views/components/BuildView.tsx`, `panels/components/node/NodeChat.tsx` |
| Worktree status route + hook | `app/api/flows/worktree-status/route.ts`, `components/flows/hooks/useWorktreeStatus.ts` |
