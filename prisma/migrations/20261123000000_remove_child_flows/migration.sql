-- Remove the child-flow features (plan fan-out, split, subflow).
--
-- Data cleanup first: legacy `step`/`split` flows and their owned rows must be
-- gone before the `flow_kind` enum can be narrowed to `sdlc` (Postgres cannot
-- cast rows that still hold the removed values). Flow-owned tables are deleted
-- in FK-safe order, mirroring FLOW_CHILD_TABLES in lib/engine/constants.

DELETE FROM step_merges;

UPDATE plan_steps SET sub_flow_id = NULL WHERE sub_flow_id IS NOT NULL;
UPDATE flows SET parent_flow_id = NULL WHERE parent_flow_id IS NOT NULL;

DELETE FROM hook_deliveries
WHERE hook_id IN (
  SELECT h.id FROM hooks h
  WHERE h.flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc')
);
DELETE FROM plan_steps WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM events WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM messages WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM runs WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM artifacts WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM comments WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM branches WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM hooks WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM nodes WHERE flow_id IN (SELECT id FROM flows WHERE kind <> 'sdlc');
DELETE FROM flows WHERE kind <> 'sdlc';

-- Schema changes.

-- AlterEnum
BEGIN;
CREATE TYPE "flow_kind_new" AS ENUM ('sdlc');
ALTER TABLE "flows" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "flows" ALTER COLUMN "kind" TYPE "flow_kind_new" USING ("kind"::text::"flow_kind_new");
ALTER TYPE "flow_kind" RENAME TO "flow_kind_old";
ALTER TYPE "flow_kind_new" RENAME TO "flow_kind";
DROP TYPE "flow_kind_old";
ALTER TABLE "flows" ALTER COLUMN "kind" SET DEFAULT 'sdlc';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "job_kind_new" AS ENUM ('webhook_delivery', 'schedule_fire', 'wait_fire', 'cancel', 'mr_create');
ALTER TABLE "jobs" ALTER COLUMN "kind" TYPE "job_kind_new" USING ("kind"::text::"job_kind_new");
ALTER TYPE "job_kind" RENAME TO "job_kind_old";
ALTER TYPE "job_kind_new" RENAME TO "job_kind";
DROP TYPE "job_kind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "flows" DROP CONSTRAINT "flows_parent_flow_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_steps" DROP CONSTRAINT "plan_steps_sub_flow_id_fkey";

-- DropForeignKey
ALTER TABLE "step_merges" DROP CONSTRAINT "step_merges_flow_id_fkey";

-- DropForeignKey
ALTER TABLE "step_merges" DROP CONSTRAINT "step_merges_parent_flow_id_fkey";

-- DropIndex
DROP INDEX "idx_flows_parent";

-- DropIndex
DROP INDEX "idx_plan_steps_sub_flow";

-- AlterTable
ALTER TABLE "flows" DROP COLUMN "parent_flow_id";

-- AlterTable
ALTER TABLE "plan_steps" DROP COLUMN "sub_flow_id";

-- DropTable
DROP TABLE "step_merges";

-- DropEnum
DROP TYPE "step_merge_status";
