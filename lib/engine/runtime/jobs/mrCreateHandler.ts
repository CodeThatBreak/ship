import "server-only";

import { flowEngine } from "../../flowEngine";
import type { ChangeRequest } from "../../ports/gitHost";
import {
  isCommitError,
  mergeRequests,
  type CommitError,
} from "../../nodes/kinds/mergeRequest/mergeRequestExports";
import { JobQueue } from "./jobQueue";
import { mrCreatePayloadSchema } from "./schemas/jobPayloads";
import { MR_CREATE_DEFAULTS } from "./constants/jobVocabulary";
import type { JobRecord, MrCreateFixTarget } from "./types/job";
/**
 * MrCreateHandler — dispatches a claimed `mr_create` job (step 06 task 5,
 * Invariant 7): the MR-creation sequence (create-or-adopt + the bounded
 * commit-fix retry) is journaled write-ahead through the jobs table.
 *
 * - Success: `create` persists the branch/flow MR rows and completes the job
 *   in ONE transaction (`onPersist`) — a crash before it lands is healed by
 *   the sweep's re-claim, whose adopt path (`listChangeRequestsByBranch`)
 *   picks up the existing MR instead of duplicating it.
 * - `CommitError` (fix budget exhausted): a NORMAL terminal, not a crash —
 *   the mr-failed event + the declared `mrHandback` transition record the
 *   outcome (moved here from sdlcChain's catch) and the job completes; the
 *   "Approve & create MR" button reappears for a manual retry.
 * - Any other error: rethrow — the JobQueue requeues with backoff and
 *   terminal-fails past {@link JOB_LIMITS.MAX_ATTEMPTS} with a typed event.
 *   Infra failures (network/auth/API) now AUTO-RETRY instead of handing the
 *   build back — the journaling win; the developer is no longer the retry
 *   loop for transient host errors.
 *
 * Must never: run host I/O inside the persist transaction, swallow a
 * non-CommitError (the retry budget owns infra outcomes), or hand back a
 * build node for a crash the queue can recover on its own.
 */
export class MrCreateHandler {
  constructor(
    private readonly jobs: JobQueue,
    private readonly runFix: (
      target: MrCreateFixTarget,
      attempt: number,
      error: CommitError,
    ) => Promise<void>,
  ) {}

  /** `null` = the branch's creation ended in a recorded failure (or a live
   *  intent defers it) — the caller must not advance past the build. */
  async handle(job: JobRecord): Promise<ChangeRequest | null> {
    const parsed = mrCreatePayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`mr_create payload failed validation: ${parsed.error.message}`);
    }
    const p = parsed.data;
    const maxAttempts = p.maxCommitFixAttempts ?? MR_CREATE_DEFAULTS.MAX_COMMIT_FIX_ATTEMPTS;
    const target: MrCreateFixTarget = {
      flowId: p.flowId,
      buildKey: p.emitNodeKey ?? "",
      branch: p.branchName ?? null,
      maxAttempts,
    };
    try {
      return await mergeRequests.createWithFixes(await flowEngine.ctx(p.flowId), p.branchName, {
        maxAttempts,
        emitNodeKey: p.emitNodeKey,
        gateKey: p.gateKey,
        reviewKey: p.reviewKey,
        skipGateReviewReset: p.skipGateReviewReset,
        runFix: (attempt, error) => this.runFix(target, attempt, error),
        onPersist: async (tx) => {
          // the flows-row update + the job's completion land in the SAME
          // transaction (the step's explicit requirement) — the dedup key
          // frees with them so a re-approve can enqueue a fresh intent
          await this.jobs.complete(job.id, tx);
          await this.jobs.clearDedupKey(job.id, tx);
        },
      });
    } catch (e: unknown) {
      if (!isCommitError(e) || !p.emitNodeKey) throw e;
      // budget exhausted — a normal terminal: record the outcome in the feed
      // and hand the build back (moved here from sdlcChain's catch)
      await flowEngine.emitMrFailed(
        p.flowId,
        p.emitNodeKey,
        `MR creation failed: ${e.message} — fix the issue, then click "Approve & create MR" again to retry`,
        {
          branchName: p.branchName,
          nodeKey: p.emitNodeKey,
          detail: e.detail !== e.message ? e.detail : undefined,
        },
      );
      await flowEngine.setNodeStatus(p.flowId, p.emitNodeKey, "mrHandback");
      await this.jobs.complete(job.id);
      await this.jobs.clearDedupKey(job.id);
      return null;
    }
  }
}
