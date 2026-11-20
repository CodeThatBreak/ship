import "server-only";

import { db } from "../../db/app";
import { NodeRow, rows } from "../../db/rows";
import { NotFoundError, ValidationError } from "../../errors";
import { NODE_KEYS } from "../constants/nodeKeys";
import { PlanInput } from "../nodes/kinds/plan/schema";
import {
  PLAN_CHAT_READY_LIFECYCLE,
  resolvePlanFailedRetryStatus,
} from "../nodes/kinds/plan/planRetryRevert";
import { nodeRoles } from "../nodes/shared/nodeRoles";
import { stepFlows } from "../runtime/fanout/stepFlowManager";
import { splitManager } from "../runtime/split/splitManager";
import { isNodeTerminalSuccess } from "../runtime/transitions/constants/statusSets";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import { templateStore } from "../templates/templateStore";
import { PROMPT_REBUILD_RETRY_KEYS, RECORDED_PROMPT_KEYS } from "./constants/retryPromptRebuild";
import type { RetryHost } from "./types/retryHost";
import type { NodeDefinition } from "../nodes/shared/nodeSharedExports";
import type { TriggerResult } from "../runtime/triggers/types/triggerGateway";

/**
 * FlowRetryService — the retry paths carved out of the FlowEngine facade
 * (step 05, target-architecture §12's `flow/` focused services): re-running a
 * failed node on its recorded (schema-validated) input, with the step-05
 * retry coherence — the prompt-rebuilding kinds (see
 * `flow/constants/retryPromptRebuild.ts`) lose their recorded prompt keys so
 * the def's run path rebuilds from the CURRENT template + recorded vars, and
 * the plan node's dead-end fix: a recorded chat turn replays through the
 * ChatRefiner, no recorded turn reverts the node to an actionable status
 * (`planRetryRevert`) with the chat-ready lifecycle event.
 *
 * Must never: run a retry on an unvalidated recorded payload (the recorded
 * input parses against the node's schema first — retry fails fast rather
 * than running corrupt), or write node status outside the gateway/authority
 * doors. The duplicate fence is the `retry` claim's from-set (step 06): a
 * running/waiting node or a busy post-MR chain loses the claim atomically,
 * emits the typed `skipped_duplicate_trigger` event and returns the skipped
 * result — the old ad-hoc `ConflictError` guards are gone. The recorded
 * prompt itself stays persisted for audit/preview only.
 */
export class FlowRetryService {
  constructor(private readonly host: RetryHost) {}

  async retryNode(flowId: string, nodeKey: string): Promise<TriggerResult> {
    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) throw new NotFoundError('node', nodeKey);
    const def = await this.host.defOf(flowId, nodeKey);
    if (!def.retryable) throw new ValidationError(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (def.capabilities.chatMode === 'plan') {
      return this.retryPlanNode(flowId, nodeKey, node, def, PlanInput.parse(recorded));
    }

    // a chain node's retry respects the chain — the guard rides the claim
    // UPDATE itself (step 06), not a read-then-act pre-check
    const chainKeys = (await templateStore.chainNodeKeys(flowId)).includes(nodeKey)
      ? await templateStore.chainNodeKeys(flowId)
      : undefined;
    const result = await this.host.claimTrigger({ flowId, nodeKey, source: TRIGGER_SOURCE.UI, key: 'retry', chainKeys });
    if (!result.started) return result;
    await this.host.emitLifecycle(flowId, nodeKey, `retrying ${nodeKey}`);
    this.host.bg(flowId, nodeKey, async () => {
      // a retried node re-runs on its recorded input — with the recorded
      // prompt stripped for the prompt-rebuilding kinds (step 05 retry
      // coherence): the run path REBUILDS the prompt from the CURRENT
      // template + the recorded vars. The recorded prompt itself stays
      // persisted for audit/preview only.
      // the pipeline gate self-heals (an already-green head finishes
      // immediately) and a green gate then advances the template edges
      // (review → debounced resolve)
      const runInput = this.rebuildRetryInput(def, recorded) as typeof recorded;
      await def.run(await this.host.ctx(flowId), runInput, await this.host.nodeConfigFor(flowId, nodeKey));
      // a retried generic node that now succeeded advances the template
      // edges exactly like the engine's auto-start path
      const finalStatus = await this.host.nodeStatus(flowId, nodeKey);
      if (await this.host.isStepChild(flowId)) {
        // child-terminal notification hook (plan fan-out): the parent's
        // scheduler/rollup reacts to the retried child's terminal state
        await stepFlows.onChildFinished(flowId);
        await splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
      }
      if (isNodeTerminalSuccess(finalStatus ?? '')) {
        await this.host.advanceFrom(flowId, nodeKey);
      }
    });
    return result;
  }

  /** Plan retry: replay a recorded chat turn, or revert when nothing was recorded. */
  private async retryPlanNode(
    flowId: string,
    nodeKey: string,
    node: NodeRow,
    def: NodeDefinition,
    recorded: PlanInput
  ): Promise<TriggerResult> {
    const turnMessage = recorded.turnUserMessage?.trim();
    if (!turnMessage) {
      const revertStatus = resolvePlanFailedRetryStatus(
        recorded,
        (await this.host.latestResourceArtifact(flowId, NODE_KEYS.PLAN)) != null
      );
      const reverted = await this.host.transitionTrigger({
        flowId,
        nodeKey,
        source: TRIGGER_SOURCE.UI,
        key: 'planRetryRevert',
        toStatus: revertStatus,
      });
      if (!reverted.started) return reverted;
      await this.host.emitLifecycle(flowId, nodeKey, PLAN_CHAT_READY_LIFECYCLE);
      await this.touch(flowId);
      return reverted;
    }

    const result = await this.host.claimTrigger({ flowId, nodeKey, source: TRIGGER_SOURCE.UI, key: 'retry' });
    if (!result.started) return result;
    await this.host.emitLifecycle(flowId, nodeKey, `retrying ${nodeKey}`);
    this.host.bg(flowId, nodeKey, async () => {
      const chatRefiner = nodeRoles.chatRefinerOf(def);
      if (!chatRefiner) {
        throw new ValidationError(`${nodeKey} does not accept chat replay`);
      }
      const chatResponse = await chatRefiner.turn(await this.host.ctx(flowId), turnMessage, {
        model: recorded.model ?? undefined,
        thread: recorded.planThread,
      });
      await db.addMessage(
        flowId,
        nodeKey,
        'assistant',
        chatResponse || 'Done.',
        recorded.planThread ?? null
      );
    });
    return result;
  }

  /** The input a retry runs on: the recorded input as-is, except the
   *  prompt-rebuilding kinds (see the module constant) lose their recorded
   *  prompt keys so the def's run path rebuilds from the current template. */
  rebuildRetryInput(def: NodeDefinition, recorded: unknown): unknown {
    if (!PROMPT_REBUILD_RETRY_KEYS.has(def.key)) return recorded;
    const stripped = { ...(recorded as Record<string, unknown>) };
    for (const key of RECORDED_PROMPT_KEYS) delete stripped[key];
    return stripped;
  }

  private async touch(flowId: string): Promise<void> {
    await db.run(`UPDATE flows SET updated_at=$1 WHERE id=$2`, db.now(), flowId);
  }
}
