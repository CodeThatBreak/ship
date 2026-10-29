import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/constants/query-keys';

type Variables = Record<string, unknown>;

export function useFlowMutation({ flowId }: { flowId: string }) {
  const queryClient = useQueryClient();
  const actionSend = useMutation({
    mutationFn: async (variables: Variables) => {
      const res = await fetch(`/api/flows/${flowId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
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
