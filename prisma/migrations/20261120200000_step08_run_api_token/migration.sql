-- Step 08 (agent self-repair tools): the per-attempt capability token the
-- node's running agent presents on the agent-tools endpoint. Minted by the
-- transition authority's claim (paired with the attempt id), persisted on the
-- startup run row by registerStartupRun, cleared when the run closes. Nullable:
-- non-agent nodes claim attempts without ever creating a run row.
-- Hand-authored like step-05's migration (the dev DB user cannot create
-- Prisma's shadow DB for `migrate dev` to diff against).
ALTER TABLE "runs" ADD COLUMN "api_token" TEXT;
