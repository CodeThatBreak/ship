import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/query-keys';
import { postJson } from '@/hooks/fetch-json';

type Variables = Record<string, unknown>;

/**
 * The flow's action route (run_node, refine_plan for branch refines, …) as one mutation.
 * Returns `mutateAsync` so a caller awaiting the send gets the
 * accepted-draft semantics (the composer clears only on success).
 */
export function useFlowMutation({ flowId }: { flowId: string }) {
  const queryClient = useQueryClient();
  const actionSend = useMutation({
    mutationFn: (variables: Variables) =>
      postJson(`/api/flows/${flowId}/action`, JSON.stringify(variables)),
    onSuccess: () => {
      // the action changed flow state — refresh the cockpit's snapshot
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
    },
  });
  return actionSend.mutateAsync;
}
