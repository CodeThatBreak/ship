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

## Issue 2 — plan node: "left running without an active run" → retry dead-end ✅ Root cause found

The chain, verified in code:

1. **Server restart mid plan-chat turn** (the window between `claimNode` in `sendChat` and `persistRun` in `executeRun` — agent startup can take seconds) leaves the plan node `running` with **no run row**.
2. On opening the flow, the reconciler fails it:

   `271:      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, "node was left running without an active run");` — `lib/engine/runtime/flowReconciler.ts:271`

   which emits _"...— retry the node to continue"_ (`lib/engine/nodes/shared/nodeSupport.ts:207`).

3. **But retry is a dead end for the plan node** — it's chat-first, `run()` is deliberately a stub (`140:    throw new Error('The plan node only accepts input via POST /api/flows/:id/chat');` — `planNode.ts:140`):
   - UI plan panel's Retry button (`PlanStatusPanel.tsx:29` → action `retry`) → `flowEngine.retryNode` → `def.run()` throws inside `bg` → node re-failed, error event in the activity feed.
   - `runNodeManual` explicitly rejects plan (`flowEngine.ts:854-856`).
4. Recovery _is_ possible by typing in the plan chat (`sendChat` claims from `['pending','awaiting_approval','failed']`), but the UI steers you to a Retry button that can never work.

Key enabler: the plan node **already records everything needed for a real retry** — `PlanInput` has `turnUserMessage`, `planThread`, `model`, `previousStatus` (`lib/engine/nodes/kinds/plan/schema.ts:270-283`).

## Other SDLC hazards found in the sweep

| #   | Finding                                                                                                                                                                                                                    | Impact on demo                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 3   | `_not-found.html` also bakes the build-time token                                                                                                                                                                          | Covered by fix F1a below                               |
| 4   | Restart during agent `start()` window fails any node (90s grace, then reconciler)                                                                                                                                          | Other nodes retry fine; plan becomes dead-end (fix F2) |
| 5   | Running dev + prod servers simultaneously against the same DB: the other process's reconciler doesn't see in-process agent handles (`hasActiveRun` is per-process) and will fail/interfere with its in-flight runs         | Keep exactly one server running                        |
| 6   | `.env`: `GITLAB_WEBHOOK_SECRET` empty → webhooks rejected (poller compensates); `CURSOR_API_KEY=DO_NOT_USE` → cloud-mode agent runs would fail auth (local-mode SDK runs are fine)                                         | Confirm demo flows use local execution mode            |
| 7   | Wait-timer re-arm on restart is already fixed (`flowPoller.ts:46` → `reArmWaitingTimers`), plan artifact "latest" ordering is already fixed (`ORDER BY a.version DESC`) — the old review-backlog hotfixes are not blockers | No action                                              |

---

## The Plan

**F1 — Fix the 401 (production build)** _(blocks integrations setup — do first)_

1. `loaders/localApiShell.tsx`: make `LocalApiShell` async and call `await connection()` (from `next/server`) before reading the token — the root-cause fix that makes it impossible to bake the per-process token into any static output (fixes integrations page, `_not-found`, and any future page).
2. `app/(workspace)/settings/integrations/page.tsx`: add `export const dynamic = "force-dynamic"` for consistency with every sibling page.
3. Rebuild (`npm run build` — fix only exists in prod builds).
4. Verify: `.next/server/app/settings/integrations.html` no longer exists; start server; add an integration end-to-end; re-run the curl probe (no-token → 401, runtime token → passes).

**F2 — Fix the plan node retry dead-end** _(blocks the plan demo story)_

1. `flowEngine.retryNode`: add a chat-first branch — when the def is the plan node (`capabilities.chatMode === 'plan'`), instead of `def.run()`:
   - If the recorded `PlanInput` has a `turnUserMessage`: claim from `['failed']` and replay the recorded turn via the existing `nodeRoles.chatRefinerOf(def).turn(ctx, recorded.turnUserMessage, { model, thread: recorded.planThread })` — a _real_ retry; success lands the node in `awaiting_approval` like any plan turn.
   - If no turn was recorded (failed during start): revert to `previousStatus` (or `awaiting_approval` if a plan version exists, else `pending`) with a lifecycle event "plan chat is ready — send a message to continue" instead of leaving it failed.
2. `runNodeManual`: route plan through the same replay (or keep the explicit 400 — the plan panel never sends `run_node`; I'd keep it and just fix `retryNode`).
3. Small copy fix: `FailureAlert.tsx` — "Plan generation failed" is wrong when the turn was interrupted; adjust to "The plan turn was interrupted" (Retry now actually works).
4. Tests: extend `flowEngineChatAndManual.test.ts` (retry → replays turn via chat path) + a planNode test for the no-recorded-turn revert. Definition of Done per AGENTS.md (`typecheck`, `lint`, `test`, `build`).

**F3 — Dry-run checklist for the demo** _(no code)_

- Re-seed the demo DB with the seed scripts (never with `--reset` against a non-demo DB), keep `DATABASE_PATH=./data/devflow-clean-demo.db`.
- Ensure only **one** server (prod build via `npm run start`) is running during the dry run; don't restart mid-agent-run.
- Verify local execution mode for flows (cloud mode with `DO_NOT_USE` key will fail).
- Walk the full SDLC path: start → plan chat → approve → build → pipeline → review → resolve, confirming loading/error/empty states on each panel.
