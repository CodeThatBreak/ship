# Task 11 — Choke-point cleanup: delete `db.get/all/run`, shrink `RowGateway`

**Files:** `lib/db/database.ts`, `lib/db/rows.ts`, `lib/db/rowGatewayAccess.ts`, `lib/db/dbAccess.ts`, remaining importers
**Effort:** M · **Depends on:** 01–10 (all consumers migrated)

## Goal

Remove the raw-SQL choke points now that consumers are gone. The `Database` facade exposes only the typed Prisma client and the domain stores; `RowGateway` shrinks to JSONB-payload validation helpers or is deleted.

## Steps

1. **Delete `Database.get/all/run`** (`lib/db/database.ts:112-124`) and the `rowsFor(executor)` raw-view factory (`:72-80`). The class header comment (":29-35", which describes the raw helpers as a migration bridge) is rewritten to state the final position: ORM-first, raw only in the contained invariant sites.
2. **Shrink `RowGateway`** (`lib/db/rows.ts:481-518`): with no raw SQL to validate, the `get/all(schema, sql)` methods are dead. Keep only what the JSONB boundary still needs — the zod payload schemas (`NodeRow`'s `input`/`output`, `ArtifactRow`'s `meta`, template `config`/`trigger`/`inputMap`, event `data`) — as plain exported schemas/mappers, not a SQL gateway. Delete the `rows` proxy (`:520-527`) and `getRowGateway`/`bindRowGateway` (`rowGatewayAccess.ts`).
3. **Delete `executorFor`** if Task 10 left it as a shim — the `(tx ?? prisma)` pick is inlined at call sites.
4. **Keep the contained raw sites working**: `Database` still exposes `prisma` (the typed client) and `transaction(fn)`; the contained raw statements (jobs claims, lease stamps, transition CAS, advisory locks) call `tx.$executeRaw*`/`$queryRaw*` directly inside their named methods.
5. Update `lib/db/index.test.ts` / `rows.test.ts` — delete raw-gateway tests, keep payload-schema tests.

## Notes

- This is the point of no return: after this PR, introducing a new raw SQL string outside the containment list requires touching `database.ts`/`rows.ts` and is caught by the Task 12 lint rule.
- `Database.transaction(fn)` and `db.prisma` stay — they are the ORM surface, not raw helpers.
- Status vocabularies (`FLOW_STATUSES`, `NODE_STATUSES`, …) in `lib/db/rows.ts` are still the domain constants — move them to a `lib/db/constants/` named file if `rows.ts` shrinks away (AGENTS §2.7), and update importers to the concrete module (no barrels).

## DoD

- [x] `grep -rn 'queryRawUnsafe\|executeRawUnsafe' lib/` matches **only** inside the contained methods (jobs, lease stamps, transition CAS, advisory locks) — each allowlisted.
- [x] `grep -rn '\.get(\`\|\.all(\`\|\.run(\`\|rows\.\(get\|all\)(' lib/ app/` returns nothing.
- [x] `npm run check` + `npm run build` green.
