import { useMutation, useQueryClient } from "@tanstack/react-query";

import { postJson } from "@/hooks/fetch-json";

import { invalidateFlowDetail, invalidateFlowPrompts } from "@/hooks/invalidate-flow-queries";

type FlowActionBody = { action: string } & Record<string, unknown>;

/**
 * The flow's action route (run_node, approve_plan, checklist updates, …) as one mutation.
 * Returns the mutation object so panels can show pending/error and retry.
 */
export const useFlowMutation = ({ flowId }: { flowId: string }) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: FlowActionBody) => {
      const { action, ...body } = variables;
      return postJson(`/api/flows/${flowId}/action`, JSON.stringify({ action, ...body }));
    },
    onSuccess: (_data, variables) => {
      void invalidateFlowDetail(queryClient, flowId);
      if (variables.action === "set_node_config") {
        void invalidateFlowPrompts(queryClient, flowId);
      }
    },
  });
};
