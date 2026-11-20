import "server-only";

import { NODE_TRIGGER_TYPE } from "../../../constants/triggers";
import { templateStore } from "../../../templates/templateStore";
import type { FlowCtx } from "../runContext/types/flowContext";

/** Whether the flow's template holds the node for user approval (declarative kinds). */
export const declarativeHoldsForApproval = async (ctx: FlowCtx, nodeKey: string): Promise<boolean> => {
  const graph = await templateStore.graphForFlow(ctx.flow.id);
  if (!graph) return false;
  const spec = graph.byKey.get(nodeKey);
  return spec?.trigger.type === NODE_TRIGGER_TYPE.APPROVAL;
};
