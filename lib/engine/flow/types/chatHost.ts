import "server-only";

import type { FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";

/**
 * The orchestrator surface {@link FlowChatService} drives — the engine
 * facade's def resolution, pre-claim status reads, the gateway claim door,
 * background wrapper and edge release (a deliberate narrow boundary, not a
 * public API; `FlowEngine` implements it).
 */
export interface ChatHost {
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
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  ctx(flowId: string): Promise<FlowCtx>;
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
}
