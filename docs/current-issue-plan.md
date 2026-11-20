## Issue 1 — 401 adding integrations in production build ✅ Root cause found (reproduced live)

**How the auth works:** mutating `/api/*` calls must carry a per-process token (`x-devflow-local-token`). The client gets it hydrated from the server via the root layout: `LocalApiShell` → `LocalApiProvider` (`loaders/localApiShell.tsx`).

**Root cause:** `app/(workspace)/settings/integrations/page.tsx` is the **only page missing `export const dynamic = "force-dynamic"`** — every other page has it. So in `next build` it was **statically prerendered**, and the build-time token got baked into its HTML.

Evidence from your current build (server started 20:43 via `npm run start`):

- Baked into static HTML (`.next/server/app/settings/integrations.html` + `.rsc`): token `792548a7…`
- Runtime token served by dynamic pages (e.g. `/flows`): `e0883e5b…`
- Live probe against your running server:
  - POST with baked build-time token → **`401 {"error":"Unauthorized"}`** (middleware)
  - POST with runtime token → passes middleware (400 zod, as expected)
  - GET requests aren't gated → page renders fine, which is why only _mutations_ (adding an integration) fail.

`_not-found.html` has the same baked token, and any future page without `force-dynamic` would too. In dev nothing is prerendered, which is why it only shows up in the production build.

(The plan-retry dead-end that used to be Issue 2 here is closed — see `docs/engine-overhaul/steps/05-progress-notes.md`.)

## Other SDLC hazards found in the sweep

| #   | Finding                                                                                                                                                                                                                    | Impact on demo                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 3   | `_not-found.html` also bakes the build-time token                                                                                                                                                                          | Covered by fix F1a below                               |
| 4   | Restart during agent `start()` window fails any node (90s grace, then reconciler)                                                                                                                                          | Other nodes retry fine; the plan dead-end itself is closed (step 05) |
| 5   | Running dev + prod servers simultaneously against the same DB: the other process's reconciler doesn't see in-process agent handles (`hasActiveRun` is per-process) and will fail/interfere with its in-flight runs         | Keep exactly one server running                        |
| 6   | `.env`: `GITLAB_WEBHOOK_SECRET` empty → webhooks rejected (poller compensates); `CURSOR_API_KEY=DO_NOT_USE` → cloud-mode agent runs would fail auth (local-mode SDK runs are fine)                                         | Confirm demo flows use local execution mode            |
| 7   | Wait-timer re-arm on restart and plan-artifact "latest" ordering are already fixed (durable `wait_until` waits + explicit `ORDER BY a.version DESC`) — the old review-backlog hotfixes are not blockers | No action                                              |

---

## The Plan

**F1 — Fix the 401 (production build)** _(blocks integrations setup — do first)_

1. `loaders/localApiShell.tsx`: make `LocalApiShell` async and call `await connection()` (from `next/server`) before reading the token — the root-cause fix that makes it impossible to bake the per-process token into any static output (fixes integrations page, `_not-found`, and any future page).
2. `app/(workspace)/settings/integrations/page.tsx`: add `export const dynamic = "force-dynamic"` for consistency with every sibling page.
3. Rebuild (`npm run build` — fix only exists in prod builds).
4. Verify: `.next/server/app/settings/integrations.html` no longer exists; start server; add an integration end-to-end; re-run the curl probe (no-token → 401, runtime token → passes).

**F2 — Dry-run checklist for the demo** _(no code)_

- Re-seed the demo DB with the seed scripts (never with `--reset` against a non-demo DB; seeds target the Postgres demo database via `config.db.demoUrl()`, AGENTS §1).
- Ensure only **one** server (prod build via `npm run start`) is running during the dry run; don't restart mid-agent-run.
- Verify local execution mode for flows (cloud mode with `DO_NOT_USE` key will fail).
- Walk the full SDLC path: start → plan chat → approve → build → pipeline → review → resolve, confirming loading/error/empty states on each panel.
