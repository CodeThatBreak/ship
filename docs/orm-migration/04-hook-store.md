# Task 04 — Hook store → ORM

**Files (sole owner):** `lib/engine/runtime/hookStore/hookStore.ts`, `lib/engine/runtime/hookStore/utils/firstHookRow.ts`
**Raw sites:** ~10
**Effort:** S · **Depends on:** —

## Goal

All `hooks` table access through `prisma.hook`. This is the smallest, cleanest conversion — a good first PR to validate the pattern.

## What converts

| Current shape | Prisma replacement |
| --- | --- |
| `${HOOK_SELECT} WHERE id=$1` | `prisma.hook.findUnique({ where: { id } })` |
| `… WHERE template_id=$1 AND flow_id IS NULL` | `prisma.hook.findFirst({ where: { templateId, flowId: null } })` |
| `… WHERE flow_id=$1 AND node_key=$2` | `prisma.hook.findFirst({ where: { flowId, nodeKey } })` |
| `INSERT INTO hooks (id,template_id,…)` | `(tx ?? prisma).hook.create({ data: { id: db.uid("hk_"), templateId, secret: newSecret(), filter, … } })` |
| `UPDATE hooks SET filter=$1 WHERE id=$2` | `(tx ?? prisma).hook.update({ where: { id }, data: { filter } })` |
| `DELETE FROM hooks WHERE template_id=$1 AND flow_id IS NULL` | `(tx ?? prisma).hook.deleteMany({ where: { templateId, flowId: null } })` |
| `… WHERE flow_id=$1 AND node_key IS NOT NULL ORDER BY created_at` | `prisma.hook.findMany({ where: { flowId, nodeKey: { not: null } }, orderBy: { createdAt: 'asc' } })` |
| `SELECT trigger, hidden FROM flow_templates WHERE id=$1` (in `syncTemplate`) | `prisma.flowTemplate.findUnique({ where: { id }, select: { trigger: true, hidden: true } })` |

## Notes

- `firstHookRow.ts` (the tx variant) becomes unnecessary once the reads take an optional `tx` and call `(tx ?? prisma).hook.findFirst` directly — delete the helper and inline the client pick (AGENTS §4.6: delete shims, don't keep them).
- `HOOK_SELECT` constant is deleted once aliases are gone.
- `HookRow` zod schema: `secret`/`filter` are scalars (Prisma-typed); no JSONB payload — the zod layer can shrink to nothing here. Keep the exported `HookRow` type by deriving it from Prisma (`Prisma.HookGetPayload<{}>`) or keep a minimal type alias; do not keep a validator with no boundary job.
- Tx-joining convention is already `(tx ?? db.prisma)` — keep it, swap the raw call for the Prisma call on the same client.

## DoD

- [x] `firstHookRow.ts` and `constants/hookSelect.ts` deleted; no `$executeRawUnsafe`/`rows.get` remains in the hook store.
- [x] `npm run check` + `npm run build` green; `hookStore.test.ts` passes with Prisma-call mocks.
