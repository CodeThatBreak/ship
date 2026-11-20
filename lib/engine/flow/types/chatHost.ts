import "server-only";

import type { FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";

/**
 * The orchestrator surface {@link FlowChatService} drives — the engine
 * facade's def resolution, pre-claim status reads, keyed claims, background
 * wrapper and edge release (a deliberate narrow boundary, not a public API;
 * `FlowEngine` implements it).
 */
export interface ChatHost {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  /** the engine's keyed claim wrapper (delegates to the authority) */
  claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  ctx(flowId: string): Promise<FlowCtx>;
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
}
