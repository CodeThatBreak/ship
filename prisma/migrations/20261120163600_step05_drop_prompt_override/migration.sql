-- DropColumn — step 05 (prompt-layer hardening): `nodes.prompt_override` was
-- dead code (nothing read or wrote it; the prompt modal's live resolution +
-- last-run overlay replaced the per-run override veto). Hand-authored like
-- the step-03 migration — the dev DB user cannot create Prisma's shadow DB.
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "prompt_override";
