# Task 09 — Jobs + reconcile: isolate the raw claims

**Files (sole owner):** `lib/engine/runtime/jobs/jobQueue.ts`, `cancelHandler.ts`, `lib/engine/runtime/reconcile/recoveryDriver.ts`, `approvedHandler.ts`, `runningHandler.ts`
**Raw sites:** ~12
**Effort:** M · **Depends on:** —

## Goal

The job queue is the one place raw SQL is **correct by design** — the atomic claim is a correctness primitive (`FOR UPDATE SKIP LOCKED` + lease stamp in one statement). This task does not convert the claims to ORM; it **contains** them: every raw statement moves behind a named method, everything else in these files converts to Prisma, and the boundary is documented.

## Contain (stays raw, isolated)

| Method | Why raw |
| --- | --- |
| `JobQueue.claimNext` / `claimById` / `reclaimExpired` | `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) … RETURNING` — atomic under concurrent claimers. No Prisma equivalent. |
| `JobQueue.fail` backoff requeue | `run_at = now() + make_interval(secs => $n)` interval arithmetic. |
| `runningHandler` staleness probe | `updated_at > now() - make_interval(secs => $n)`. |

For each: a single private method owns the SQL, named for the operation, with a comment citing target-architecture §jobs / the invariant. The `RETURNING` row decodes through the existing job row shape.

## Convert to Prisma

| Current shape | Prisma replacement |
| --- | --- |
| `clearDedupKey` — `UPDATE jobs SET dedup_key=NULL WHERE id=…` | `(tx ?? prisma).job.update({ where: { id }, data: { dedupKey: null } })` |
| `complete` — `UPDATE jobs SET status=done … WHERE id=… AND status=claimed` | `(tx ?? prisma).job.updateMany({ where: { id, status: CLAIMED }, data: { status: DONE, leaseUntil: null } })` |
| `fail` read — `SELECT attempts, kind, flow_id FROM jobs WHERE id=…` | `prisma.job.findUnique({ where: { id }, select: { attempts: true, kind: true, flowId: true } })` |
| `cancelHandler.ts`, `recoveryDriver.ts`, `approvedHandler.ts` non-interval reads/writes | `prisma.job.*`, `prisma.flow.*`, `prisma.node.*` |
| `jobQueue` dedup insert (`createMany` path, already ORM) | unchanged |

## Notes

- Status literals from `JOB_STATUS` / `JOB_LIMITS` constants (already exist) — no new literals (AGENTS §2.7).
- `complete`/`clearDedupKey` join caller transactions (`tx` param) — keep the `(tx ?? this.database.prisma)` client pick, swap the raw call.
- The claim SQL embeds `${JOB_STATUS.QUEUED}` and dynamic `kind IN (…)` placeholders — if kept raw, parameterization stays exactly as-is; this is not an injection vector (constants + positional params). Add a comment noting the file is on the raw-SQL containment list so the Task 12 lint rule allowlists it.

## DoD

- [x] Raw SQL exists only in the three named claim methods + two interval helpers; everything else in these files is Prisma.
- [x] `npm run check` + `npm run build` green; `jobQueue.test.ts`, `scheduleFireHandler.test.ts` pass.
- [x] Concurrency behavior unchanged (claim-under-contention test still passes).
