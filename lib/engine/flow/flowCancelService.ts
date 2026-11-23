import "server-only";

import { db } from "../../db/app";
import { ConflictError, NotFoundError } from "../../errors";
import { NODE_STATUS } from "../constants/nodeStatus";
import { CancelHandler } from "../runtime/jobs/cancelHandler";
import { JOB_KIND } from "../runtime/jobs/constants/jobVocabulary";
import { cancelDedupKey } from "../runtime/jobs/utils/jobDedupKeys";
import { JobQueue } from "../runtime/jobs/jobQueue";
import type { CancelHost } from "./types/cancelHost";

/**
 * FlowCancelService — stop an in-flight node (the action route's cancel),
 * carved out of the FlowEngine facade (step 07's composition-only collapse).
 * The cancel intent is journaled write-ahead (Invariant 7), then the same CancelHandler the
 * worker sweep's re-claim would run finalizes — whoever wins the claim
 * finishes, a crash in between leaves the job for the sweep.
 *
 * Must never: cancel a node outside the cancelable statuses, or finalize a
 * cancel whose journal entry a live intent already owns.
 */
export class FlowCancelService {
  constructor(private readonly host: CancelHost) {}

  async cancel(flowId: string, nodeKey: string): Promise<void> {
    const node = await db.prisma.node.findFirst({ where: { flowId, nodeKey }, select: { status: true } });
    if (!node) throw new NotFoundError('node', nodeKey);
    if (
      node.status !== NODE_STATUS.RUNNING &&
      node.status !== NODE_STATUS.WAITING &&
      node.status !== NODE_STATUS.AWAITING_APPROVAL
    ) {
      throw new ConflictError(`cannot cancel ${nodeKey} while it is ${node.status}`);
    }
    // write the intent first; whoever wins the claim finalizes — a crash
    // between claim and finalize leaves the job for the sweep's re-claim
    const jobs = new JobQueue();
    const { id: jobId, deduplicated } = await jobs.enqueue({ kind: JOB_KIND.CANCEL, flowId, dedupKey: cancelDedupKey(flowId, nodeKey), payload: { flowId, nodeKey } });
    if (deduplicated) return; // a live intent owns the finalize
    const job = await jobs.claimById(jobId);
    if (!job) return; // the sweep (or a concurrent cancel) owns the finalize
    await new CancelHandler(jobs).handle(job); // a throw surfaces here; the claim's lease expiry re-claims the job
    await jobs.complete(jobId);
  }
}
