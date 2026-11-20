import "server-only";

import type { FlowCtx, NodeDefinition } from "../../../nodes/shared/nodeSharedExports";

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

/**
 * The engine surface the recovery driver needs (FlowEngine satisfies it).
 * Step 07: the completion/orphan finalizers moved INTO the driver (they are
 * the recover() ABI's seam) — the host carries the lookups the ABI needs.
 */
export type RecoveryHost = {
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
};
