import "server-only";

import { db } from "../../../db/app";
import { NotFoundError } from "../../../errors";
import { engineParts, nodeSupport } from "../../../composition/container";
import { agentPortRegistry } from "../../ports/agentPort";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { splitManager } from "../split/splitManager";
import { stepFlows } from "../fanout/stepFlowManager";
import { JobQueue } from "./jobQueue";
import { cancelPayloadSchema } from "./schemas/jobPayloads";
import type { JobRecord } from "./types/job";

/** The statuses a cancel may finalize (the `cancel` transition's from-set). */
const CANCELABLE_STATUSES: readonly string[] = [
  NODE_STATUS.RUNNING,
  NODE_STATUS.WAITING,
  NODE_STATUS.AWAITING_APPROVAL,
];

/**
 * CancelHandler — finalizes a claimed `cancel` job (step 06 task 4,
 * Invariant 7): the cancel intent is journaled write-ahead, the remote
 * cancel (agent-port kill per running run row) happens OUTSIDE any
 * transaction, then the declared `cancel` transition through the authority,
 * the flow touch, and the step-child terminal notifications.
 *
 * Used by BOTH callers — `flowEngine.cancelNode` (inline: claim the intent
 * it just enqueued and run this handler) and the worker sweep's
 * `reclaimExpired` (a crash between claim and finalize) — one finalize path,
 * so the crash window is closed by the claim, not by duplicated logic.
 *
 * Idempotent: a node already out of the cancel from-set (terminal — the
 * cancel landed before the crash, or a concurrent writer raced it) is a
 * no-op; the job still completes and the dedup key frees. Ownership note
 * (step 06 risk): the job sweep is the ONLY second writer to the runs rows
 * here — only a re-claimed cancel job finalizes orphaned intents.
 *
 * Must never: finalize a node in a status the `cancel` transition's from-set
 * does not declare, accept an unvalidated payload, or leave the dedup key
 * claimed after completion (a later cancel-after-retry must enqueue fresh).
 */
export class CancelHandler {
  constructor(private readonly jobs: JobQueue = new JobQueue()) {}

  async handle(job: JobRecord): Promise<void> {
    const parsed = cancelPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`cancel payload failed validation: ${parsed.error.message}`);
    }
    const { flowId, nodeKey } = parsed.data;
    const node = await nodeSupport.optionalNodeByKey(flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (!CANCELABLE_STATUSES.includes(node.status)) return; // already terminal — the cancel landed before the crash

    const mode = (await db.get<{ executionMode: string | null }>(
      `SELECT execution_mode AS "executionMode" FROM flows WHERE id=$1`, flowId,
    ))?.executionMode === "local" ? "local" : "cloud";
    // remote cancel per running run row (local mode kills the in-process run)
    const active = await db.all<{ runRef: string }>(
      `SELECT run_ref AS "runRef" FROM runs WHERE node_id=$1 AND status='running'`,
      node.id,
    );
    for (const r of active) {
      await (await agentPortRegistry.forMode(mode)).cancel({ runId: r.runRef });
    }
    // the interrupted run rows drop their leases; the cancel transition then
    // clears the durable wait + node lease with the status
    await db.run(
      `UPDATE runs SET status='error', lease_until=NULL, updated_at=$1 WHERE node_id=$2 AND status='running'`,
      db.now(), node.id,
    );
    await engineParts.transitions.applyOrThrow(flowId, nodeKey, "cancel");
    await db.run(`UPDATE flows SET updated_at=$1 WHERE id=$2`, db.now(), flowId);
    if (await this.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): a stopped step child
      // surfaces failed in its parent's rollup
      await stepFlows.onChildFinished(flowId);
      await splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
    }
    // free the dedup key so the node can be cancelled again after a retry
    await this.jobs.clearDedupKey(job.id);
  }

  private async isStepChild(flowId: string): Promise<boolean> {
    const row = await db.get<{ parentFlowId: string | null }>(
      `SELECT parent_flow_id AS "parentFlowId" FROM flows WHERE id=$1`, flowId,
    );
    return row?.parentFlowId != null;
  }
}
