# Repository Detail Page (Proposal)

Date: 2026-10-23 · Status: **Proposal — no code changes yet**

Today a "repo" is five fields in a horizontal registry row on the Settings page
(`name`, `cloud_url`, `local_path`, `default_branch`). Everything else — agent
mode, model, prompts, timeouts — is *global*. As DevFlow accumulates per-repo
behavior (worktrees, run commands, prompt overrides), a repo needs its own
page: one URL per repo, sections per concern, and a **layered config** that
keeps global settings meaningful.

Design principles carried over from `docs/worktree-support.md`:

- **Settings are data; UI is dumb.** Sections render form fields bound to a
  zod-validated config object; no logic in components.
- **Layered, not forked.** Effective config = global default → repo override →
  (per-flow/ticket overrides where they exist). A repo that overrides nothing
  behaves exactly as today — zero regression, no per-repo required fields.
- **One resolver.** `lib/config/repo-config.ts` (pure) computes the effective
  `RepoConfig` from globals + repo override rows; engine and UI both consume it.
  Extending a section = extending the schema + one field in a form component.

## Route & IA

```
/settings                     — existing page; Repositories section becomes a
                                clickable list (search, health dot per repo)
/settings/repos/[id]          — the detail page (server component + client tabs)

Tabs: Overview · Worktree & Local · Build & Run · Prompts · Agents · CI & MR ·
      Danger Zone
```

## Tabs

### 1. Overview

Identity + a health dashboard, not a form.

- **Identity** — `name`, `cloud_url`, `default_branch` (existing fields,
  editable), which GitLab instance (domain match) serves it, with that
  instance's **Test** action surfaced here.
- **Health checks** (each a button + last-run status + error text):
  - *Local checkout* — path exists, is a git repo, `origin` resolves to
    `cloud_url` (warn on mismatch — that's the hub contract from the worktree doc).
  - *GitLab auth* — instance token works against this project (visibility check).
  - *Agent runtime* — local SDK availability (Node 22.13+/CURSOR_API_KEY).
  - *Worktree dry-run* — resolve the repo's `DepPolicy` and report what setup
    *would* do (no side effects), e.g. "pnpm detected → store-install, ~2s".
- **Recent activity** — flows for this repo (existing flows list filtered by
  `repo_id`), cost rollup from the runs table (Phase 1 attribution reused).

### 2. Worktree & Local

Fields from the worktree proposal; all optional, global default shown inline:

| Field | Type | Default (global) |
|---|---|---|
| `worktree_mode` | `inherit · always · never` | `always` |
| `install_command` | string (shell, run in worktree root) | *(auto)* |
| `skip_install` | bool | false |
| `sync_paths` | glob list (untracked config synced hub→worktree) | `.env*`, `*.rc` |
| `install_timeout_ms` | number | 600000 |
| `rebase_before_mr` | bool | false |
| `cache_copy` | bool (copy common cache dirs from hub) | true |

Plus a **"Validate setup"** button: creates a throwaway worktree on a temp
branch, runs the resolved policy, reports duration/output, removes it. This is
the dry-run made real — the fastest way to pass on the first flow.

### 3. Build & Run ("how to run this repo")

The repo declaratively describes how tooling drives it. Commands are data;
nothing here executes except behind listed gates.

| Field | Used where |
|---|---|
| `build_command` | local gate before MR creation (optional) |
| `typecheck_command` | local gate: runs after build before "Approve → MR"; failure blocks approval with output shown in the diff panel |
| `lint_command` | same gate, non-blocking by default (`lint_blocking` toggle) |
| `test_command` | same gate + fed to fix agents on failure (never blocking unless toggled — flaky tests) |
| `dev_command` (freeform) | informational only — shown in Overview for humans |
| `fix_hints` (textarea) | extra context block injected into pipeline-fix / pre-push-fix / resolve prompts ("tests run with ``, mock server on port …") |

Gate semantics: local gates run via the existing bounded-exec pattern, emit
lifecycle events, and produce an output artifact shown under the diff. Runs are
opt-in per repo (`gates_enabled` global default), because a repo that runs
checks server-side in CI shouldn't pay the double cost.

### 4. Prompts (repo-specific)

Prompt resolution becomes **three layers**: hardcoded defaults → global
custom (`prompt_templates` in settings, the existing UI) → **repo overrides**
(new). Effective template = last non-empty layer wins; internal suffixes
(output contracts) always re-appended and never editable, unchanged.

- Per-template editor for the same five top-level keys
  (`plan`, `build`, `pipeline_fix`, `review`, `resolve`) + refine variants,
  with **"Override" / "Inherited from global"** state badges and a
  **diff view** against the inherited template before saving.
- **`repo_context` textarea** — a repo conventions block appended to the
  ticket context in every prompt ("monorepo: packages/*, use pnpm, follow
  CONTRIBUTORS.md for MR titles, …"). Cheapest high-value override.
- The preview endpoint (`GET /api/flows/[id]/prompt` pattern) gains a repo
  today; rendered preview with live variables + variable chips like the
  existing PromptModal.
- Reset button per template (drop the override, inherit again).

### 5. Agents

Per-repo defaults that beats global when the flow doesn't override:

| Field | Default |
|---|---|
| `execution_mode` | `inherit · cloud · local` |
| `default_model` | `inherit` (+ ModelSelector reusing `listModels`) |
| `auto_approve_tools` / `sandbox` (local only, mirrors existing settings) | inherit |
| `run_timeout_ms` | inherit (30 min) |
| `subagents` (name+instructions pairs) | none — passed `customSubagents` in cloud, prompt-level in local |

### 6. CI & MR

| Field | Notes |
|---|---|
| `pipeline_strategy` | `auto · merged_results · branch` — mirrors the existing trigger fallback as explicit choice |
| `manual_job_play` | bounded play of manual jobs (exists; global now) |
| `resolve_quiet_minutes` | existing quiet period, per repo |
| `review_gate` | `require_green · allow_yellow` (timeout escape for flaky CI) |
| `branch_naming` | prefix/`{ticket}/{flow}` template override (pre-receive-hook repos) |
| `mr_title`, `mr_description` templates | GitLab-style `{{...}}` vars (ticket key, summary, branch, plan-checklist summary) |
| `mr_labels`, `target_branch`, `squash_merge` | passed to MR creation |

### 7. Danger Zone

Unlink `local_path` (worktree prunes + hub-health re-run), **Test/Repair**
(worktree sweep for this repo), purge finished flows + runs + artifacts for the
repo (with count preview), delete repo (blocked while non-terminal flows exist).

## Data model

Explicit columns stay minimal; extensibility is a validated JSON blob —
mirroring the "strategy table, not if-chains" stance:

```sql
ALTER TABLE repos ADD COLUMN config_json TEXT;       -- zod RepoOverrides
ALTER TABLE repos ADD COLUMN prompt_overrides_json TEXT; -- keyed like prompt_templates
```

- `RepoOverrides` (zod, all-optional) in `lib/db/repo-config.ts` — the same
  schema walks the forms, the API, so adding a field never needs a migration.
- Resolver `resolveRepoConfig(repo, globalSettings): RepoConfig` computes
  effective values with hierarchy `global → repo`; each UI field shows its
  source badge (Global / This repo).
- Prompt overrides reuse the existing `PromptTemplate` shape per key;
  `getTemplate(nodeKey)` gains an optional repo param doing the third-layer
  overlay.

## API

- `GET /api/repos/[id]` — repo + resolved config + per-field sources.
- `PATCH /api/repos/[id]` — partial override update (zod-validated; strips
  keys sent back at their inherited value to keep rows small).
- `POST /api/repos/[id]/health` — runs health checks (or one selected).
- `POST /api/repos/[id]/worktree-validate` — throwaway worktree round-trip.
- Prompt template preview: extend the existing prompt-preview endpoint with
  `?repo=` and layered sources in the response.

## Consumption sites (engine side)

| Consumer | Change |
|---|---|
| `flowContextHelper` | worktree/branch/MR fields via resolved config |
| `localAgent.defaults()` | per-repo overrides when flow's repo is resolvable |
| `prompts.getTemplate/render` | third-layer overlay + `repo_context` block |
| build/fix/resolve prompts | `fix_hints` context block |
| merge-request-service | `branch_naming`, `mr_*`, `squash_merge`, `target_branch` |
| pipeline node | `pipeline_strategy`, `manual_job_play`, `resolve_quiet_minutes` |
| build finalize | local gates (`typecheck/lint/test`) between agent finish and approval |

## Risk / scope notes

- **Incremental by construction.** Every section is optional-in; tabs can ship
  in any order. Recommended sequence: Overview+Agents (nurture existing
  behaviors) → Worktree & Local (needs `DepPolicy` anyway) → Prompts → Build &
  Run gates → CI & MR.
- **Not a second settings system.** The global Settings page remains the
  fallback layer everywhere; repo page only stores deltas. Copy on the page
  should say so ("leave empty to follow global").
- **Shell-command fields are trust boundaries** (`install_command`,
  run commands run with your machine's credentials) — same surface as today's
  Settings, but worth a one-line confirmation on first edit per repo.
- Prompt-layer interactions with per-run "Edit prompt & run" (flow-level)
  remain the top layer: global → repo → per-run dialog.
