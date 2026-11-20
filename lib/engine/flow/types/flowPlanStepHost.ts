import "server-only";

import type { ChainRole } from "../../nodes/shared/nodeSharedExports";

/**
 * The orchestrator surface {@link FlowPlanStepService} drives — the engine
 * facade's plan-artifact lookup, role keys, lifecycle emission and the flow
 * touch (a deliberate narrow boundary, not a public API; `FlowEngine`
 * implements it).
 */
export interface FlowPlanStepHost {
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): Promise<T | undefined>;
  keyOfRole(flowId: string, role: ChainRole): Promise<string | null>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
}
