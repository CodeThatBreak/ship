import "server-only";

import type { ChainRole, FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";

/**
 * The orchestrator surface {@link FlowRetryService} drives — the engine
 * facade's def resolution, keyed claims/wrappers, lookups and lifecycle
 * emission (a deliberate narrow boundary, not a public API; `FlowEngine`
 * implements it).
 */
export interface RetryHost {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  /** the TriggerGateway claim door (step 06) — the atomic duplicate fence */
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    chainKeys?: readonly string[];
  }): Promise<TriggerResult>;
  /** the TriggerGateway approval-style door (the plan-retry revert) */
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    toStatus?: EngineNodeStatus;
  }): Promise<TriggerResult>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  ctx(flowId: string): Promise<FlowCtx>;
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** the post-terminal dispatch (step 07): child-terminal notifications +
   *  the registered lifecycle effects, falling through to the edge walk */
  postTerminal(flowId: string, nodeKey: string): Promise<void>;
  /** full config layer stack for the retried node's run */
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  latestResourceArtifact<T>(flowId: string, role: ChainRole): Promise<T | undefined>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
}
