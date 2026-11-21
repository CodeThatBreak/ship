import "server-only";

import { EVENT_KIND } from "../../../constants/vocabulary";
import { NODE_RUN_STATUS } from "../../../../../constants/flow";
import type { NodeRow } from "../../../../db/rows";
import type { NodeSupport } from "../nodeSupport";
import type { FlowCtx } from "../nodeSharedExports";
import type { RunOutcome } from "../types/runOutcome";

/**
 * The typed terminal for an outcome that violated the def's `outputSchema`
 * (step 04): a typed `output_contract_violation` event with the per-path
 * issues, then the failed terminal (failed writes carry no payload data —
 * the violation detail lives in the event). Retriable like any other failed
 * node. Extracted from `NodeDefinition` (shrink-only) — the base class's
 * `applyOutput` contract-violation path and any caller with the same shape
 * share this one terminal.
 */
export const failOutputContract = async (
  support: NodeSupport,
  ctx: FlowCtx,
  node: NodeRow,
  issues: string[],
  opts?: { attemptId?: string | null; fenceSuperseded?: boolean },
): Promise<RunOutcome> => {
  const message = `${node.nodeKey}: output contract violation — ${issues[0] ?? "the output did not satisfy its schema"}`;
  const failed: RunOutcome = {
    status: NODE_RUN_STATUS.FAILED,
    output: {},
    event: `${node.nodeKey} failed — output contract violation`,
    eventData: { error: message, issues },
    reply: message,
  };
  // the violation batch (step 06, Invariant 7): typed event + failed terminal + lifecycle in one tx
  await support.transaction(async (tx) => {
    await support.emit(ctx.flow.id, node.id, EVENT_KIND.OUTPUT_CONTRACT_VIOLATION, message, { nodeKey: node.nodeKey, issues }, tx);
    await support.publishOutcome({
      flowId: ctx.flow.id, nodeKey: node.nodeKey, nodeId: node.id,
      attemptId: opts?.fenceSuperseded ? opts.attemptId ?? undefined : undefined,
      outcome: { status: failed.status, output: failed.output, agentId: await support.lastAgentId(node.id, tx) },
      tx,
    });
    await support.emitLifecycle(ctx.flow.id, node.id, failed.event, failed.eventData, tx);
  });
  return failed;
};
