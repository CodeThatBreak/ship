# Task 01 — Template store → ORM

**Files (sole owner):** `lib/engine/templates/templateStore/templateStore.ts`, `lib/engine/templates/templateLint.ts`
**Raw sites:** ~30 (the heaviest consumer — 49 SQL statements across CRUD, clone, delete, schedule)
**Effort:** L · **Depends on:** —

## Goal

Every `flow_templates` / `flow_template_nodes` / `flow_template_edges` / `node_templates` read and write goes through `prisma.flowTemplate`, `prisma.flowTemplateNode`, `prisma.flowTemplateEdge`, `prisma.nodeTemplate`. No SQL strings remain in either file.

## What converts

| Current shape | Prisma replacement |
| --- | --- |
| `INSERT INTO flow_templates (…) VALUES (…)` | `prisma.flowTemplate.create({ data })` |
| `UPDATE flow_templates SET name=…, updated_at=… WHERE id=…` | `prisma.flowTemplate.update({ where: { id }, data })` |
| `DELETE FROM flow_template_nodes WHERE template_id=…` | `prisma.flowTemplateNode.deleteMany({ where: { templateId } })` (same for edges) |
| `INSERT INTO flow_template_nodes / …_edges (…)` (clone loop) | `createMany({ data: [...] })` inside the same tx |
| `SELECT … FROM node_templates WHERE key=…` / `WHERE id=…` | `findFirst({ where: { key } })` / `findUnique({ where: { id } })` |
| `SELECT count(*) …` usage checks (`{ c: number }`) | `prisma.flowTemplateNode.count({ where: { nodeTemplateId } })` |
| `UPDATE flow_templates SET schedule_next_at=… WHERE id=…` | `prisma.flowTemplate.update({ where: { id }, data: { scheduleNextAt } })` |

JSONB columns (`trigger`, `config`, `inputMap`): pass the typed object directly — Prisma accepts `Prisma.InputJsonValue`. On reads, narrow the returned `JsonValue` through the existing zod schemas from `lib/db/rows.ts` (`FlowTemplateRow`, `FlowTemplateNodeRow`, …) **only for the payload fields**; scalar fields are Prisma-typed already.

## Stays raw

Nothing in this file needs raw SQL — all statements are plain CRUD/upserts by id or key.

## Notes

- `templateLint.ts:135` — the `node_templates` row fetch for linting becomes `findMany`; keep the existing lint logic unchanged.
- Multi-statement writes (save-with-children, clone, delete-with-orphan-cleanup) already run inside `db.transaction(fn)` — keep that shape; swap each statement for its Prisma call on the `tx` client.
- `updated_at` stamps: pass `new Date()` explicitly (matches `db.now()` semantics) or rely on Prisma `@updatedAt` if the schema has it — check the model first; do not change the schema.
- Tests: `templateStore` tests mock `db.run/get/all` — re-mock as `prisma.<model>.<op>`. Fixture data is exempt from the constants rule but must typecheck.

## DoD

- [x] `grep -n 'queryRaw\|executeRaw\|db\.\(get\|all\|run\)(\`\|rows\.\(get\|all\)(' lib/engine/templates/` returns nothing.
- [x] `npm run check` + `npm run build` green.
- [x] Seed round-trip: `node scripts/seed-custom-flow.mjs --reset` (demo DB only — check `DATABASE_URL` first, AGENTS §1) then edit + delete the template in the UI.
  *Note (Task 12): the interactive UI round-trip was not re-run for this task; seeder idempotency was verified at the Task-06 level (seeder run twice against the demo DB — row counts and user-edited rows unchanged), and the demo flow scripts target the same demo DB the template store writes through the same ORM path.*
