-- CreateEnum
CREATE TYPE "job_kind" AS ENUM ('webhook_delivery', 'schedule_fire', 'wait_fire', 'merge_back');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('queued', 'claimed', 'done', 'failed');

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "lease_until" TIMESTAMPTZ,
ADD COLUMN     "wait_until" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "attempt_id" TEXT,
ADD COLUMN     "lease_until" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "kind" "job_kind" NOT NULL,
    "flow_id" TEXT,
    "payload" JSONB,
    "status" "job_status" NOT NULL DEFAULT 'queued',
    "lease_until" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedup_key" TEXT,
    "run_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_jobs_status_run_at" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedup_key_key" ON "jobs"("dedup_key");

