import "server-only";

import type { FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { TemplateGraph } from "../../templates/templateStore";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";

/**
 * The orchestrator surface {@link FlowManualRunService} drives — the engine
 * facade's def resolution, gateway claim, staging delegates and post-terminal
 * dispatch (a deliberate narrow boundary, not a public API; `FlowEngine`
 * implements it).
 */
export interface ManualRunHost {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  graph(flowId: string): Promise<TemplateGraph | null>;
  joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean>;
  /** the merged upstream outputs a declarative run inherits (the auto-start mirror) */
  inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Promise<Record<string, unknown>>;
  ctx(flowId: string): Promise<FlowCtx>;
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
  }): Promise<TriggerResult>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  /** the post-terminal dispatch (step 07) */
  postTerminal(flowId: string, nodeKey: string): Promise<void>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
}
