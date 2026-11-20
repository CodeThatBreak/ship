import "server-only";

import { db } from "../../db/app";
import { NodeRow } from "../../db/rows";
import { NODE_KEYS } from "../constants/nodeKeys";
import { NotFoundError, ValidationError } from "../../errors";
import { parseRow } from "@/lib/db/ormRowHelpers";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import type { TransitionKey } from "../runtime/transitions/types/transitions";
import type { TriggerResult } from "../runtime/triggers/types/triggerGateway";
import type { ManualRunHost } from "./types/manualRunHost";

/**
 * FlowManualRunService — the generic manual node start (the runtime panel's
 * Run), carved out of the FlowEngine facade (step 07's composition-only
 * collapse). A failed entry node re-runs from the form (its recorded input
 * never satisfied the contract, so the retry path can't help); everything
 * else claims `runFromPending` through the gateway — the atomic duplicate
 * fence (step 06): a racer that claimed first loses atomically and emits the
 * typed skip event.
 *
 * Must never: run the plan node (its input path is the chat rail), start a
 * node whose joins are unsatisfied, or bypass the post-terminal dispatch —
 * the manual path must mirror the engine's auto start exactly.
 */
export class FlowManualRunService {
  constructor(private readonly host: ManualRunHost) {}

  async runNodeManual(
    flowId: string,
    nodeKey: string,
    opts: { prompt?: string; model?: string; input?: Record<string, unknown> } = {}
  ): Promise<TriggerResult> {
    const def = await this.host.defOf(flowId, nodeKey);
    if (def.chainRole === NODE_KEYS.PLAN) {
      throw new ValidationError('The plan node only accepts input via POST /api/flows/:id/chat');
    }
    const row = await db.prisma.node.findFirst({ where: { flowId, nodeKey } });
    const node = row ? parseRow(NodeRow, row, `node ${nodeKey} for flow ${flowId}`) : null;
    if (!node) throw new NotFoundError('node', nodeKey);
    // the status read only SELECTS the claim key — the claim's from-set still
    // decides (a racer that claimed first loses atomically and emits the
    // typed skip event; the old status pre-read throw is gone, step 06).
    const claimKey: TransitionKey = node.status === 'failed' && def.isEntry ? 'retry' : 'runFromPending';
    const result = await this.host.claimTrigger({
      flowId,
      nodeKey,
      source: TRIGGER_SOURCE.UI,
      key: claimKey,
    });
    if (!result.started) return result;
    this.host.bg(flowId, nodeKey, async () => {
      const g = await this.host.graph(flowId);
      if (g && !(await this.host.joinSatisfied(flowId, g, nodeKey))) {
        throw new Error('upstream nodes must finish before this run can start');
      }
      // `input` carries the values the user provided at trigger time (the
      // start node's contract form) — it IS the payload. With no explicit
      // input, agent-style nodes (inheritsParentInput) take the merged
      // upstream outputs — the manual path must mirror the engine's auto
      // start (StageRunner.startNodeStage), otherwise `{{input.*}}` renders
      // empty — and prompt/model keep today's shape for agent nodes on top.
      const rawInput =
        opts.input && typeof opts.input === 'object'
          ? { ...opts.input }
          : {
              ...(def.inheritsParentInput
                ? await this.host.inheritedInput(flowId, nodeKey, await this.host.ctx(flowId))
                : {}),
              prompt: opts.prompt ?? null,
              model: opts.model ?? null,
            };
      await this.host.runNode(flowId, nodeKey, rawInput);
      // the post-terminal dispatch (step 07): child-terminal notifications +
      // the registered lifecycle effects, falling through to the edge walk
      await this.host.postTerminal(flowId, nodeKey);
    });
    return result;
  }
}
