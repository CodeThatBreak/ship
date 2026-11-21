import "server-only";

import { db } from "../../../db/app";
import { NotFoundError } from "../../../errors";
import { engineParts, nodeSupport } from "../../../composition/container";
import { agentPortRegistry } from "../../ports/agentPort";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { RUN_STATUS } from "../../constants/vocabulary";
import { resolveRunMode } from "../../utils/runMode";
import { EffectRegistry } from "../effects/effectRegistry";
import { EFFECT_LIFECYCLE } from "../effects/constants/effectLifecycles";
import { TRIGGER_SOURCE } from "../triggers/constants/triggerSources";
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
  constructor(
    private readonly jobs: JobQueue = new JobQueue(),
    /** the effect/join layer (step 07): the child-terminal notification is a
     *  registration, not a manager call — callers pass the engine's registry;
     *  the default empty registry keeps a bare handler a no-op dispatcher */
    private readonly effects: EffectRegistry = new EffectRegistry(),
  ) {}

  async handle(job: JobRecord): Promise<void> {
    const parsed = cancelPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`cancel payload failed validation: ${parsed.error.message}`);
    }
    const { flowId, nodeKey } = parsed.data;
    const node = await nodeSupport.optionalNodeByKey(flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (!CANCELABLE_STATUSES.includes(node.status)) return; // already terminal — the cancel landed before the crash

    const flow = await db.prisma.flow.findUnique({
      where: { id: flowId },
      select: { executionMode: true },
    });
    const mode = resolveRunMode(flow?.executionMode);
    // remote cancel per running run row (local mode kills the in-process run)
    const active = await db.prisma.run.findMany({
      where: { nodeId: node.id, status: RUN_STATUS.RUNNING },
      select: { runRef: true },
    });
    for (const r of active) {
      await (await agentPortRegistry.forMode(mode)).cancel({ runId: r.runRef });
    }
    // the interrupted run rows drop their leases; the cancel transition then
    // clears the durable wait + node lease with the status
    await db.prisma.run.updateMany({
      where: { nodeId: node.id, status: RUN_STATUS.RUNNING },
      data: { status: RUN_STATUS.ERROR, leaseUntil: null, updatedAt: db.now() },
    });
    await engineParts.transitions.applyOrThrow(flowId, nodeKey, "cancel");
    await db.prisma.flow.update({ where: { id: flowId }, data: { updatedAt: db.now() } });
    // child-terminal notification (step 07): a stopped step child surfaces
    // failed in its parent's rollup — the registered onChildTerminal effects
    // react (no-op without fan-out/split linkage; the wildcard registrations
    // don't key on the defKey)
    await this.effects.run(EFFECT_LIFECYCLE.ON_CHILD_TERMINAL, {
      flowId,
      nodeKey,
      defKey: "",
      status: NODE_STATUS.FAILED,
      output: null,
      source: TRIGGER_SOURCE.UI,
    });
    // free the dedup key so the node can be cancelled again after a retry
    await this.jobs.clearDedupKey(job.id);
  }
}
