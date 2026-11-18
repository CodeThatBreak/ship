import "server-only";

import { Prisma } from "@prisma/client";
import type { Database, QueryExecutor } from "../../../db/database";
import { db } from "../../../db/app";
import { EVENT_KIND } from "../../constants/vocabulary";
import { JOB_LIMITS, JOB_STATUS, type JobKind } from "./constants/jobVocabulary";
import type { JobHandlers, JobRecord } from "./types/job";

/**
 * JobQueue — durable, claimable background work (Invariant 7,
 * target-architecture §3/§8). External-I/O sequences are journaled through
 * the `jobs` table: enqueue write-ahead (dedup key), claim atomically
 * (`UPDATE … WHERE status='queued' … FOR UPDATE SKIP LOCKED` + lease +
 * attempt bump), do the work, mark done — or fail with backoff until the
 * attempt cap lands the job `failed` with a typed event. A crash between
 * dispatch and done leaves a `claimed` job whose lease expiry makes it
 * reclaimable; the resume claim itself dedups the side effect.
 *
 * Clock rule: lease writes and sweeps compare on DB-server time (`now()`),
 * never app-server `Date.now()` (step 03 risk: clock skew).
 *
 * Must never: dispatch inside the claim UPDATE (claim and dispatch stay
 * separate so a handler crash cannot lose the claim), write `nodes`/`runs`
 * state (that is the authority's and the stores' job), or retry a job past
 * {@link JOB_LIMITS.MAX_ATTEMPTS} silently.
 */
export class JobQueue {
  /** Upper bound on jobs processed per sweep — one tick never loops forever. */
  private static readonly SWEEP_MAX = 50;

  constructor(private readonly database: Database = db) {}

  /**
   * Write-ahead insert. A non-null `dedupKey` that already exists is a no-op
   * (returns `deduplicated: true`) — the existing row keeps ownership of the
   * side effect; retried deliveries and re-swept schedule fires land here.
   */
  async enqueue(input: {
    kind: JobKind;
    flowId?: string | null;
    payload?: unknown;
    dedupKey?: string | null;
    runAt?: Date;
  }): Promise<{ id: string; deduplicated: boolean }> {
    const id = this.database.uid("job_");
    const created = await this.database.prisma.job.createMany({
      data: [{
        id,
        kind: input.kind,
        flowId: input.flowId ?? null,
        payload: input.payload === undefined
          ? Prisma.DbNull
          : (input.payload as Prisma.InputJsonValue),
        status: JOB_STATUS.QUEUED,
        dedupKey: input.dedupKey ?? null,
        runAt: input.runAt ?? new Date(),
      }],
      skipDuplicates: true,
    });
    return { id, deduplicated: created.count === 0 };
  }

  /**
   * Atomically claim the oldest due queued job of `kinds`. One conditional
   * UPDATE fenced by the claim subselect (`FOR UPDATE SKIP LOCKED` — correct
   * under concurrent claimers: the loser simply finds nothing) that stamps
   * the lease and bumps `attempts` in the same statement. Null when nothing
   * is due.
   */
  async claimNext(kinds: readonly JobKind[]): Promise<JobRecord | null> {
    if (kinds.length === 0) return null;
    const marks = kinds.map((_, i) => `$${i + 2}`).join(", ");
    return (await this.database.get<JobRecord>(
      `UPDATE jobs SET status=$1, lease_until = now() + make_interval(secs => $${kinds.length + 2}),
          attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status='${JOB_STATUS.QUEUED}' AND run_at <= now()
           AND kind IN (${marks})
         ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, kind, flow_id AS "flowId", payload, status, attempts,
          dedup_key AS "dedupKey", run_at AS "runAt"`,
      JOB_STATUS.CLAIMED,
      ...kinds,
      JOB_LIMITS.LEASE_SECONDS,
    )) ?? null;
  }

  /**
   * Atomically claim one specific queued job (the webhook routes' synchronous
   * in-request dispatch): the write-ahead insert is deduped, then THIS claim
   * decides who dispatches — a concurrent worker sweep that got there first
   * makes this return null and the route answers `dedup`.
   */
  async claimById(jobId: string): Promise<JobRecord | null> {
    return (await this.database.get<JobRecord>(
      `UPDATE jobs SET status=$1, lease_until = now() + make_interval(secs => $2),
          attempts = attempts + 1, updated_at = now()
       WHERE id=$3 AND status='${JOB_STATUS.QUEUED}'
       RETURNING id, kind, flow_id AS "flowId", payload, status, attempts,
          dedup_key AS "dedupKey", run_at AS "runAt"`,
      JOB_STATUS.CLAIMED,
      JOB_LIMITS.LEASE_SECONDS,
      jobId,
    )) ?? null;
  }

  /**
   * Reclaim a job whose claim lease lapsed — the crash window between
   * dispatch and done. Bounded by the attempt cap; a job that exhausted its
   * budget mid-crash is failed loudly by {@link failExhausted}.
   */
  async reclaimExpired(kinds: readonly JobKind[]): Promise<JobRecord | null> {
    if (kinds.length === 0) return null;
    const marks = kinds.map((_, i) => `$${i + 1}`).join(", ");
    return (await this.database.get<JobRecord>(
      `UPDATE jobs SET lease_until = now() + make_interval(secs => $${kinds.length + 2}),
          attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status='${JOB_STATUS.CLAIMED}' AND lease_until < now()
           AND kind IN (${marks}) AND attempts < $${kinds.length + 1}
         ORDER BY lease_until LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, kind, flow_id AS "flowId", payload, status, attempts,
          dedup_key AS "dedupKey", run_at AS "runAt"`,
      ...kinds,
      JOB_LIMITS.MAX_ATTEMPTS,
      JOB_LIMITS.LEASE_SECONDS,
    )) ?? null;
  }

  /** Mark a dispatched job done. Pass `tx` to join the completion into a
   *  caller transaction (the schedule fire advances its template in the same
   *  tx — a crash can no longer drop a fire). */
  async complete(jobId: string, tx?: QueryExecutor): Promise<void> {
    const client: QueryExecutor = tx ?? this.database.prisma;
    await client.$executeRawUnsafe(
      `UPDATE jobs SET status=$1, lease_until=NULL, updated_at=now()
       WHERE id=$2 AND status='${JOB_STATUS.CLAIMED}'`,
      JOB_STATUS.DONE,
      jobId,
    );
  }

  /**
   * Fail a claimed job: requeue with exponential backoff until the attempt
   * cap, then `failed` + a typed `error` event on the job's flow (console
   * when the job carries no flow — nothing else exists to attach it to).
   */
  async fail(jobId: string, error: string): Promise<"requeued" | "failed"> {
    const job = await this.database.get<{ attempts: number; kind: JobKind; flowId: string | null }>(
      `SELECT attempts, kind, flow_id AS "flowId" FROM jobs WHERE id=$1`,
      jobId,
    );
    if (!job) return "failed";
    if (job.attempts < JOB_LIMITS.MAX_ATTEMPTS) {
      // backoff: base * 2^(attempts-1) — attempt 1 waits one base interval
      const backoffSeconds = JOB_LIMITS.BACKOFF_BASE_SECONDS * 2 ** (job.attempts - 1);
      await this.database.run(
        `UPDATE jobs SET status=$1, lease_until=NULL,
            run_at = now() + make_interval(secs => $2), updated_at = now()
         WHERE id=$3 AND status='${JOB_STATUS.CLAIMED}'`,
        JOB_STATUS.QUEUED,
        backoffSeconds,
        jobId,
      );
      return "requeued";
    }
    await this.finishFailed(jobId, job.kind, job.flowId, error);
    return "failed";
  }

  /**
   * One sweep: reclaim expired claims (crash recovery), fail jobs whose
   * budget a crash exhausted, then claim-and-dispatch due queued jobs of the
   * kinds that have a handler registered here. Returns the jobs processed.
   * Handler errors route into {@link fail} — the sweep itself never throws.
   */
  async sweepDue(handlers: JobHandlers): Promise<number> {
    const kinds = Object.keys(handlers) as JobKind[];
    let processed = 0;
    while (processed < JobQueue.SWEEP_MAX) {
      const job = (await this.reclaimExpired(kinds))
        ?? (await this.claimNext(kinds));
      if (!job) break;
      processed++;
      try {
        await handlers[job.kind]?.(job);
        await this.complete(job.id);
      } catch (e: unknown) {
        await this.fail(job.id, e instanceof Error ? e.message : String(e));
      }
    }
    await this.failExhausted(kinds);
    return processed;
  }

  /** Terminal-fail `claimed` jobs a crash left past the attempt cap. */
  private async failExhausted(kinds: readonly JobKind[]): Promise<void> {
    if (kinds.length === 0) return;
    const marks = kinds.map((_, i) => `$${i + 1}`).join(", ");
    const exhausted = await this.database.all<{
      id: string; kind: JobKind; flowId: string | null;
    }>(
      `UPDATE jobs SET status=$${kinds.length + 1}, lease_until=NULL, updated_at=now()
       WHERE status='${JOB_STATUS.CLAIMED}' AND lease_until < now()
         AND attempts >= $${kinds.length + 2} AND kind IN (${marks})
       RETURNING id, kind, flow_id AS "flowId"`,
      ...kinds,
      JOB_STATUS.FAILED,
      JOB_LIMITS.MAX_ATTEMPTS,
    );
    for (const job of exhausted) {
      await this.emitJobFailed(job.id, job.kind, job.flowId, "claim lease expired after the attempt budget");
    }
  }

  private async finishFailed(
    jobId: string,
    kind: JobKind,
    flowId: string | null,
    error: string,
  ): Promise<void> {
    await this.database.run(
      `UPDATE jobs SET status=$1, lease_until=NULL, updated_at=now() WHERE id=$2`,
      JOB_STATUS.FAILED,
      jobId,
    );
    await this.emitJobFailed(jobId, kind, flowId, error);
  }

  private async emitJobFailed(
    jobId: string,
    kind: JobKind,
    flowId: string | null,
    error: string,
  ): Promise<void> {
    const message = `job ${kind} (${jobId}) failed after ${JOB_LIMITS.MAX_ATTEMPTS} attempts: ${error}`;
    if (flowId) {
      await this.database.emitEvent(flowId, null, EVENT_KIND.ERROR, message);
      return;
    }
    console.error(`[job-queue] ${message}`);
  }
}

/** Re-exported status type for callers that read job rows. */
