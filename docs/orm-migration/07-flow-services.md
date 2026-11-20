# Task 07 — Flow services → ORM

**Files (sole owner):** `lib/engine/flow/flowApprovalService.ts`, `flowManualRunService.ts`, `flowPlanStepService.ts`, `flowRetryService.ts`, `lib/engine/flowEngine/flowEngine.ts` (raw parts only), `lib/engine/harness/utils/markEstimated.ts`
**Raw sites:** ~10
**Effort:** M · **Depends on:** —

## Goal

Flow-level service reads/writes (approvals, manual runs, plan-step status, retries) through Prisma.

## What converts

- `rows.get/all(...)` flow / node / plan-step lookups → `prisma.flow.findUnique`, `prisma.node.findFirst`, `prisma.planStep.*`.
- `db.run('UPDATE plan_steps SET status=…')` → `prisma.planStep.update` / `updateMany` with the composite guard in `where`.
- `db.run('UPDATE flows SET …')` → `prisma.flow.update({ where: { id }, data })`.
- `markEstimated.ts` usage/estimate write → `prisma.run.updateMany` or the owning model's update.

## Stays raw

- Anything that stamps `lease_until = now() + make_interval(...)` — coordinate with Task 03 so the isolated lease-stamp helper lives in exactly one place (node support) and these services call it rather than duplicating SQL.

## Notes

- Several of these call into the transition authority for `nodes.status` changes — that path is Task 10's; this task only converts the non-status CRUD (flow fields, plan steps, run bookkeeping). Do not add any raw `nodes.status` write (enforced by `noRawNodeStatusWrite.test.ts`).
- `flowEngine.ts` is large and partly migrated — convert only the raw call sites; no drive-by refactors (AGENTS §3.5).
- Keep the class-based service shape and constructor injection; the Prisma client arrives via the existing `Database` facade (`this.db.prisma`) — no new singletons (AGENTS §3.3).

## DoD

- [x] No SQL strings remain in the listed files.
- [x] `npm run check` + `npm run build` green; the flow service tests (`flowApprovalService.test.ts`, `flowRetryService.test.ts`, `flowEngine*.test.ts`) pass with Prisma mocks.
