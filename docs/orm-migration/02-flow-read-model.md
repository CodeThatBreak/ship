# Task 02 — Flow read model → ORM

**Files (sole owner):** `lib/engine/runtime/flowReadModel.ts`
**Raw sites:** ~16 (the read side of the flow detail/snapshot views)
**Effort:** M · **Depends on:** —

## Goal

The flow read model (flow + task + nodes + runs + branches + plan steps + artifacts + child flows) reads through Prisma. The long `SELECT … AS "camelCase"` lists disappear.

## What converts

| Current shape | Prisma replacement |
| --- | --- |
| `SELECT … FROM flows WHERE id=$1` | `prisma.flow.findUnique({ where: { id } })` |
| `SELECT … FROM tasks WHERE id=$1` | `prisma.task.findUnique({ where: { id } })` |
| `SELECT … FROM nodes WHERE flow_id=$1 [AND node_key=$2]` | `prisma.node.findMany({ where: { flowId } })` / `findFirst({ where: { flowId, nodeKey } })` |
| `SELECT … FROM runs WHERE flow_id=$1 ORDER BY …` | `prisma.run.findMany({ where: { flowId }, orderBy })` |
| `SELECT … FROM branches WHERE flow_id=$1 ORDER BY "order", created_at` | `prisma.branch.findMany({ where: { flowId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })` |
| `SELECT … FROM plan_steps WHERE flow_id=$1 ORDER BY position, created_at` | `prisma.planStep.findMany({ where: { flowId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })` |
| child-flow / per-node-run fan-out reads | `prisma.flow.findMany({ where: { parentFlowId } })`, `prisma.run.findMany({ where: { nodeId } })` |

## Notes

- This file composes a **snapshot** from many tables. Keep the existing "several typed queries then assemble in code" shape — do **not** refactor into one `include` mega-query unless the relations already exist in the schema and it simplifies the assembly. Readability is the goal.
- JSONB payloads (`nodes.input/output`, `artifacts.meta`, `flows.triggerPayload`, `templateGraph`) still narrow through the zod schemas — the snapshot's job is boundary validation; Prisma only types the column as `JsonValue`.
- The two near-duplicate read paths (instance on `db` vs. module-level `rows`) should converge on the same Prisma reads — pick one accessor pattern and use it for both.
- Timestamps: Prisma returns `Date`; the read model's `isoTs` transform already handles `Date → ISO string` — keep it at the assembly boundary so the snapshot shape is unchanged.

## DoD

- [x] `grep -n 'rows\.\(get\|all\)(\|SELECT ' lib/engine/runtime/flowReadModel.ts` returns nothing.
- [x] Snapshot output shape is byte-identical (existing `flowReadModel.test.ts` passes unchanged except mock seam).
- [x] `npm run check` + `npm run build` green.
