import "server-only";

import type { Prisma } from "@prisma/client";
import type { FlowCtx, NodeDefinition } from "../../../nodes/shared/nodeSharedExports";
import type { TemplateGraph } from "../../../templates/templateStore";
import type { SubflowChildPayload } from "./subflowChildPayload";

/**
 * The engine surface the subflow runtime drives — bound once by the
 * `SubflowManager` facade (flowEngine's module tail resolves the
 * flow ↔ subflow singleton cycle, the same resolution the fan-out and split
 * runtimes use).
 *
 * Structural subset of `FlowEngine` — the subflow classes see exactly these
 * members and nothing else. Children are ordinary step-kind flows created
 * through the EXISTING `createStepChild` path (start-contract validated).
 */
export interface SubflowEngineSurface {
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition<unknown, Record<string, unknown>>>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  /** the step-child lookup (the no-nesting guard) — the runtime owns the
   *  check since step 07 moved the gates out of the stage runner */
  isStepChild(flowId: string): Promise<boolean>;
  /** the merged upstream outputs the declarative run inherits — the gate
   *  materializes the same input the def run would have seen */
  inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Promise<Record<string, unknown>>;
  createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SubflowChildPayload,
    opts: { branch: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<string>;
  startStepChild(childFlowId: string): Promise<void>;
  /** the flow's template graph — the aggregate publish reads the node's
   *  trigger type from it (approval ⇒ `awaiting_approval` terminal) */
  graph(flowId: string): Promise<TemplateGraph | null>;
  /** the normal edge evaluation after a success-terminal aggregate publish */
  advanceFrom(flowId: string, nodeKey: string): Promise<void>;
  /** flows.updated_at heartbeat (the aggregate publish's post-publish touch) */
  touch(flowId: string): Promise<void>;
}
