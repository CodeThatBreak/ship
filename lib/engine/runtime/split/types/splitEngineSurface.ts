import "server-only";

import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { NodeDefinition } from "../../../nodes/shared/nodeSharedExports";
import type { TransitionKey } from "../../transitions/types/transitions";
import type { TriggerResult } from "../../triggers/types/triggerGateway";
import type { SplitChildPayload } from "./splitChildPayload";

/**
 * The engine surface the split runtime drives — bound once by flow-engine.ts
 * at module load (the same structural seam the StepFlowManager binds through).
 * Structural subset of `FlowEngine` — the split classes see exactly these
 * members and nothing else.
 */
export interface SplitEngineSurface {
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition<unknown, Record<string, unknown>>>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  /** the step-child lookup (the per-unit nesting guard) — the runtime owns
   *  the check since step 07 moved the gate out of the stage runner */
  isStepChild(flowId: string): Promise<boolean>;
  createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload
  ): Promise<string>;
  startStepChild(childFlowId: string): Promise<void>;
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey): Promise<boolean>;
  /** the retry service's node retry (a unit retry drives the child's failed node) */
  retries: { retryNode(flowId: string, nodeKey: string): Promise<TriggerResult> };
  cancelNode(flowId: string, nodeKey: string): Promise<void>;
  advanceFrom(flowId: string, nodeKey: string): Promise<void>;
  /** flows.updated_at heartbeat (the aggregate publish's post-publish touch) */
  touch(flowId: string): Promise<void>;
}
