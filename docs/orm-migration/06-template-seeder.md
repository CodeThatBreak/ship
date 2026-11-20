# Task 06 — Template seeder → createMany/upsert

**Files (sole owner):** `lib/db/templateSeeder.ts`
**Raw sites:** ~15 (`INSERT … ON CONFLICT DO NOTHING` with deterministic ids + existence probes)
**Effort:** M · **Depends on:** —

## Goal

Built-in template seeding through `prisma.<model>.upsert` / `createMany({ skipDuplicates: true })`. The seeder stays idempotent (deterministic ids) and keeps its "never overwrite user edits" semantics.

## What converts

| Current shape | Prisma replacement |
| --- | --- |
| `INSERT INTO … VALUES (…) ON CONFLICT (id) DO NOTHING` | `prisma.<model>.upsert({ where: { id }, create: data, update: {} })` — empty `update` preserves the do-nothing-on-conflict semantics |
| `INSERT INTO … ON CONFLICT DO NOTHING` (no target) | `prisma.<model>.createMany({ data: [...], skipDuplicates: true })` (requires the unique constraint the conflict would hit — verify per table) |
| `SELECT 1 … WHERE key=…` existence probes (`{ "?column?": number }`) | `prisma.<model>.findFirst({ where: { key }, select: { id: true } })` |
| update-if-builtin statements (`UPDATE … SET … WHERE id=… AND is_builtin`) | `prisma.<model>.updateMany({ where: { id, isBuiltin: true }, data })` |

## Stays raw

Nothing — seeding is plain upserts. (`ON CONFLICT` maps cleanly to `upsert`/`skipDuplicates`.)

## Notes

- The seeder runs at startup against the configured DB — it must remain safe to run repeatedly. `upsert` with `update: {}` keeps rows the user edited untouched; do **not** switch to `update: data` anywhere (that would clobber user edits on every boot).
- JSONB seed payloads (`config`, `trigger`, `inputMap`) pass as objects; no `::jsonb` casts.
- If any `ON CONFLICT DO NOTHING` relies on a constraint other than the PK, confirm the constraint exists in `prisma/schema.prisma`; `skipDuplicates` without a matching unique index silently does nothing useful — list any such case in the PR.
- This is a seed script dependency of `npm run dev` boot — test with the demo DB only (AGENTS §1: check `DATABASE_URL`/`NODE_ENV`; never `--reset` a non-demo DB).

## DoD

- [x] No `$executeRaw`/`$queryRaw` in `templateSeeder.ts`.
- [x] Boot seeding is idempotent: run the seeder twice against the demo DB; row counts and user-edited rows are unchanged.
- [x] `npm run check` + `npm run build` green.
