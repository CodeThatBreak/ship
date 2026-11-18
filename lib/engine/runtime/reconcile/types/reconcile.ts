import "server-only";

import type { NodeRow } from "../../../../db/rows";
import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { AgentRunResult } from "../../../ports/agentPort";

/**
 * A node the reconciler walker selected from durable state — the raw
 * non-terminal row facts (step 03). Handlers re-verify anything they act on;
 * these views are the *selection*, never the proof.
 */
export type NodeStateView = {
  id: string;
  nodeKey: string;
  status: string;
  attemptId: string | null;
  /** computed in SQL against DB-server time — never app-clock comparisons */
  leaseExpired: boolean;
  waitDue: boolean;
};

/** The engine surface the recovery driver needs (FlowEngine satisfies it). */
export type RecoveryHost = {
  ctx(flowId: string): Promise<FlowCtx>;
  completeNodeFromResult(
    c: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    note: string,
  ): Promise<boolean>;
  failOrphanedNode(flowId: string, nodeId: string, nodeKey: string, reason: string): Promise<void>;
};
