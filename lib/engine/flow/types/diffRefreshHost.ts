import "server-only";

import type { FlowCtx } from "../../nodes/shared/nodeSharedExports";

/**
 * The host surface FlowDiffRefreshService needs (Task 08) — the same
 * engine-carved shape the other `flow/` services take: the flow context the
 * diff capture reads and the lifecycle event emitter the feed shows the
 * refresh on. Node status is never written — the refresh is read-only.
 */
export interface DiffRefreshHost {
  ctx(flowId: string): Promise<FlowCtx>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
}