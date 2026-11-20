# Task 08 — Misc read services → ORM

**Files (sole owner):** `lib/engine/graph/graphService/graphService.ts`, `lib/engine/tasks/taskService/taskService.ts`, `lib/engine/prompts/promptPreview/promptPreview.ts`, `lib/engine/nodes/kinds/resolve/utils/planResolveEffects.ts`, `lib/engine/runtime/worktreeLifecycle/worktreeActivity.ts`, `lib/engine/runtime/flowFactory.ts`
**Raw sites:** ~14
**Effort:** M · **Depends on:** —

## Goal

The remaining read-heavy services convert: graph snapshot assembly, task lookups, prompt-preview data gathering, resolve-effect reads, worktree activity, and flow-factory cleanup deletes.

## What converts

| File / shape | Prisma replacement |
| --- | --- |
| `graphService.ts` — flow + nodes + edges reads for the graph view | `prisma.flow.findUnique`, `prisma.node.findMany({ where: { flowId } })` |
| `taskService.ts` — task by id/key, task list reads | `prisma.task.findFirst({ where: { key } })`, `findMany` |
| `promptPreview.ts` (~7 reads) — template/node/flow data for prompt assembly | `prisma.nodeTemplate.*`, `prisma.node.*`, `prisma.flow.*` |
| `planResolveEffects.ts` — node/artifact reads feeding resolve | `prisma.node.findFirst`, `prisma.artifact.findMany` |
| `worktreeActivity.ts:51` — activity timestamp write | `prisma.flow.update({ where: { id }, data: { updatedAt } })` or the owning model |
| `flowFactory.ts:63,66` — `DELETE FROM <table> WHERE flow_id=…`, `DELETE FROM flows WHERE id IN (…)` | `prisma.<model>.deleteMany({ where: { flowId } })` per table, `prisma.flow.deleteMany({ where: { id: { in: ids } } })` |

## Stays raw

Nothing — all are plain reads or keyed deletes.

## Notes

- `flowFactory` delete order matters (children before parents, FK-safe). `deleteMany` per table inside one `db.transaction(fn)` preserves the ordering; the dynamic `${table}` loop becomes an explicit ordered list of `deleteMany` calls — clearer and type-safe.
- `promptPreview` assembles data from several tables — keep separate typed queries; do not build one mega-join.
- JSONB payloads (`config`, `input`, `output`) still narrow through the zod schemas where they cross into the domain.
- Tests re-mock from `db.get/all/run` to `prisma.<model>.*`; fixture shapes stay.

## DoD

- [x] No SQL strings remain in the listed files.
- [x] `npm run check` + `npm run build` green; affected tests pass.
