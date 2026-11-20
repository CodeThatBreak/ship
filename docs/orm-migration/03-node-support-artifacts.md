# Task 03 — Node support + artifacts → ORM

**Files (sole owner):** `lib/engine/nodes/shared/nodeSupport.ts`, `lib/artifacts/artifactService.ts`
**Raw sites:** ~15
**Effort:** M · **Depends on:** —

## Goal

Node lookups, artifact save/supersede, and run bookkeeping go through Prisma. Lease-stamp interval arithmetic stays raw but is isolated.

## What converts

| Current shape | Prisma replacement |
| --- | --- |
| `${NODE_SELECT} WHERE flow_id=$1 AND node_key=$2` (×3) | `prisma.node.findFirst({ where: { flowId, nodeKey } })` |
| `${NODE_SELECT} WHERE flow_id=$1 AND type=$2` | `prisma.node.findFirst({ where: { flowId, type } })` |
| `UPDATE artifacts SET status=… WHERE node_id=… AND kind=… AND status=…` (supersede drafts) | `prisma.artifact.updateMany({ where: { nodeId, kind, status: DRAFT }, data: { status: SUPERSEDED } })` |
| `INSERT INTO artifacts (…)` | `prisma.artifact.create({ data })` |
| `UPDATE runs SET status=…, lease_until=NULL, updated_at=… WHERE node_id=… AND status=…` | `prisma.run.updateMany({ where: { nodeId, status }, data })` |
| `UPDATE runs SET agent_ref=… WHERE run_ref=…` | `prisma.run.updateMany({ where: { runRef }, data: { agentRef } })` |
| `UPDATE flows SET mr_branch=… WHERE id=…` | `prisma.flow.update({ where: { id }, data: { mrBranch } })` |
| `rows.all(...)` node/artifact list reads (lines ~331–386) | `prisma.node.findMany` / `prisma.artifact.findMany` |
| `artifactService.ts` reads/writes | `prisma.artifact.*` |

## Stays raw (isolate behind named private methods)

- `lease_until = now() + make_interval(secs => $n)` on `nodes` and `runs` (lines ~109–112, ~215, ~230, ~266): interval arithmetic — keep one private method per table (`stampNodeLease`, `stampRunLease`) holding the SQL, with a comment citing the lease invariant.
- `INSERT INTO runs (…, now() + make_interval(secs => $8), …)` claim insert: same — the `leaseUntil` value is computed in SQL. Alternative: compute the timestamp in JS (`new Date(Date.now() + secs*1000)`) and use `prisma.run.create` — **prefer the JS computation** if the clock-skew concern is acceptable (single-writer lock makes it so); otherwise keep raw. Decide in the PR and note why.

## Notes

- `noRawNodeStatusWrite.test.ts` forbids raw `nodes.status` writes outside the transition authority — this file must not gain any; the lease stamps above touch `lease_until` only, which is allowed.
- Status string constants (`ARTIFACT_STATUS`, `RUN_STATUS`) already exist — reuse them; do not introduce new literals (AGENTS §2.7).

## DoD

- [x] Only the isolated lease-stamp SQL remains; `grep -n 'rows\.\(get\|all\)\|INSERT INTO artifacts\|UPDATE runs\|UPDATE flows' lib/engine/nodes/shared/nodeSupport.ts` shows only the contained methods.
- [x] `artifactService.ts` has no SQL.
- [x] `npm run check` + `npm run build` green; `nodeSupport.test.ts`, `artifactService.test.ts` pass.
