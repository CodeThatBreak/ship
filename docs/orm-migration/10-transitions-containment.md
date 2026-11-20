# Task 10 — Waits + transitions executor containment

**Files (sole owner):** `lib/engine/runtime/waits/waitStore.ts`, `lib/engine/runtime/transitions/nodeTransitions.ts`, `lib/engine/runtime/transitions/utils/executor.ts`
**Raw sites:** ~12
**Effort:** M · **Depends on:** —

## Goal

The transition authority is the single writer of `nodes.status`/`attempt_id` (target-architecture §02; `noRawNodeStatusWrite.test.ts`). Its conditional updates are attempt-fenced CAS statements that must stay raw. This task: keep the CAS raw and contained, convert the non-CAS reads, and simplify `executorFor` so it no longer hands a general `run/get/all` to callers.

## Contain (stays raw, isolated in `nodeTransitions.ts`)

- The conditional `UPDATE nodes SET status=…, attempt_id=… WHERE flow_id=… AND node_key=… AND status IN (from-set) [AND NOT EXISTS (…)]` (lines ~97, ~139, ~186, ~225, ~265, ~305, ~381): attempt-fenced, Invariants 7/11. These stay raw — one method per transition kind, SQL inline, comment citing the invariant.
- `UPDATE runs SET api_token=NULL …` (line ~407): plain update — **convert** to `prisma.run.updateMany`.

## Convert to Prisma

- `SELECT status, attempt_id FROM nodes WHERE flow_id=… AND node_key=…` (line ~149) → `(tx ?? prisma).node.findFirst({ where: { flowId, nodeKey }, select: { status: true, attemptId: true } })`.
- `waitStore.ts` reads/writes (`waits` table) → `prisma.*` for the wait rows. (Check the model name in `prisma/schema.prisma`; waits may live on `nodes.wait_until` or a dedicated table — convert whatever CRUD is not interval arithmetic.)

## Simplify `executorFor`

- Once `nodeTransitions` holds its own raw CAS statements and everything else uses Prisma on `(tx ?? prisma)`, the general `run/get/all` shim loses its purpose. Reduce `executorFor` to a typed `(tx ?? prisma)` client pick, or delete it and pass `Prisma.TransactionClient | PrismaClient` directly (preferred — AGENTS §4.6: delete shims).
- Callers that needed `exec.run(sql)` for the CAS now call the named method on the authority instead.

## Notes

- The authority's statements run inside the caller's completion transaction (`executorFor` exists for exactly this) — the contained methods must still accept the `tx` and run their raw CAS on it. This is the sanctioned exception to "no raw SQL"; Task 12's lint rule allowlists this file.
- Do not change any transition semantics, fencing, or event emission — this is a containment refactor, not a behavior change. `nodeTransitions.test.ts` / `transitionEvents.test.ts` must pass unchanged except mock seams.

## DoD

- [x] `nodes.status` CAS statements remain raw but are each behind a named authority method with an invariant citation.
- [x] `executorFor` is a typed client pick or deleted; no general `run/get/all` shim.
- [x] `waitStore.ts` has no SQL except documented interval arithmetic.
- [x] `npm run check` + `npm run build` green; transition tests pass.
