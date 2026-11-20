# Task 05 — Fan-out stores → ORM

**Files (sole owner):** `lib/engine/runtime/fanout/mergeArena.ts`, `mergeBackCoordinator.ts`, `stepChildStore.ts`, `stepFlowExpander.ts`, `stepRollup.ts`, `stepFlowManager/stepFlowManager.ts`
**Raw sites:** ~12
**Effort:** M · **Depends on:** —

## Goal

Plan-fan-out persistence (`step_merges`, `plan_steps.sub_flow_id`, `flows.mr_branch`, branch upserts) through Prisma.

## What converts

| File / shape | Prisma replacement |
| --- | --- |
| `stepFlowExpander.ts:215` — `UPDATE plan_steps SET sub_flow_id=…, updated_at=… WHERE id=… AND flow_id=…` | `tx.planStep.updateMany({ where: { id, flowId }, data: { subFlowId, updatedAt } })` (updateMany because the guard is composite; assert `count === 1` if the caller relies on it) |
| `stepRollup.ts:160` — `UPDATE flows SET mr_branch=… WHERE id=… AND (mr_branch IS NULL OR mr_branch='')` | conditional set-if-empty: read-then-conditionally-update inside the tx via `tx.flow.updateMany({ where: { id, OR: [{ mrBranch: null }, { mrBranch: '' }] }, data: { mrBranch } })` |
| `stepFlowManager.ts:213` — `UPDATE step_merges SET status='failed', error=…, updated_at=… WHERE flow_id=… AND status IN ('running','conflict','rejected')` | `tx.stepMerge.updateMany({ where: { flowId, status: { in: [...] } }, data: { status: 'failed', error, updatedAt } })` — status literals from `STEP_MERGE_STATUSES`/constants (AGENTS §2.7) |
| `mergeArena.ts:149` — `INSERT INTO step_merges (…) ON CONFLICT DO NOTHING` | `prisma.stepMerge.createMany({ data, skipDuplicates: true })` (needs a unique constraint to dedup against — verify in schema; if dedup is by id only, keep `createMany`) |
| `mergeBackCoordinator.ts`, `stepChildStore.ts` reads | `prisma.stepMerge.findMany/findFirst`, `prisma.flow.findMany({ where: { parentFlowId } })` |

## Stays raw

Nothing here needs raw SQL once the conditional `mr_branch` update uses `updateMany` with an `OR` guard.

## Notes

- These statements run inside the step-06 completion transactions (`db.transaction(fn, tx)`) — keep them on the `tx` client and keep the batch atomic (Invariant 7: plan-step check-offs + branch upserts + `mr_branch` + artifacts in ONE tx).
- `StepMergeRow` zod schema stays for the JSONB-free row only if a trust boundary needs it; scalars are Prisma-typed — shrink or drop validators accordingly.
- `step_merges` status vocabulary: use the existing `STEP_MERGE_STATUSES` from `lib/db/rows.ts` (or a moved constant) — no new literals.

## DoD

- [x] `grep -rn 'executeRaw\|queryRaw' lib/engine/runtime/fanout/` returns nothing.
- [x] `npm run check` + `npm run build` green; fan-out tests (`stepChildStore.test.ts`, `stepFlowManager.test.ts`, `mergeBackCoordinator.test.ts`) pass with Prisma mocks.
- [x] Demo flow still works: `node scripts/seed-demo-fanout.mjs --reset` (demo DB only — check `DATABASE_URL`, AGENTS §1).
