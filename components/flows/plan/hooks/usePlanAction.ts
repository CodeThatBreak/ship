import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { PLAN_ACTION, PLAN_STEP_ACTION } from "../constants";
import type { PlanFlowAction } from "../types";

/** The plan action route's open body shape (mirrors `PanelProps["action"]`). */
type ActionBody = Record<string, unknown>;

/**
 * The `{type, payload}` envelope → the plan action route's body: the action
 * name rides the `action` field, the payload flattens beside it. The switch
 * makes an unknown action envelope a type error, and keeps every body shape
 * declared in one place.
 */
function toActionBody({ type, payload }: PlanFlowAction): ActionBody {
  switch (type) {
    case PLAN_ACTION.RETRY:
    case PLAN_ACTION.CANCEL:
      return { action: type, nodeKey: payload.nodeKey };
    case PLAN_ACTION.APPROVE:
      return { action: type, executionOverride: payload.executionOverride };
    case PLAN_STEP_ACTION.SET:
      return { action: type, stepId: payload.stepId, status: payload.status };
    case PLAN_STEP_ACTION.UPDATE:
      return { action: type, steps: payload.steps };
    default: {
      void (type satisfies never); // exhaustiveness: an unknown action member is a type error
      throw new Error(`Unknown plan action: ${JSON.stringify(type)}`);
    }
  }
}

/**
 * The plan panel's actions as a TanStack mutation: POSTs to the flow's action
 * route and refreshes the cockpit's snapshot after the action accepted
 * (mirrors the panel contract's `action` callback). On a rejected action the
 * snapshot is NOT invalidated, so the UI keeps showing the state the server
 * actually has.
 */
export function usePlanAction(flowId: string) {
  const queryClient = useQueryClient();
  const actionSend = useMutation({
    mutationFn: async (action: PlanFlowAction) => {
      const res = await fetch(`/api/flows/${flowId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toActionBody(action)),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      // the action changed flow state — refresh the cockpit's snapshot
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
    },
  });
  return actionSend.mutate;
}
