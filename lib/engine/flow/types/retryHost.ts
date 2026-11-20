import "server-only";

import type { ChainRole, FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";

/**
 * The orchestrator surface {@link FlowRetryService} drives — the engine
 * facade's def resolution, keyed claims/wrappers, lookups and lifecycle
 * emission (a deliberate narrow boundary, not a public API; `FlowEngine`
 * implements it).
 */
export interface RetryHost {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  /** the engine's keyed claim wrapper (delegates to the authority) */
  claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string>;
  /** the keyed transition wrapper for callers whose contract says the
   *  from-set MUST hold (the plan-retry revert) */
  applyOrThrow(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts?: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string },
  ): Promise<void>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  ctx(flowId: string): Promise<FlowCtx>;
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** full config layer stack for the retried node's run */
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  chainBusy(flowId: string): Promise<boolean>;
  isStepChild(flowId: string): Promise<boolean>;
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): Promise<T | undefined>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
}
