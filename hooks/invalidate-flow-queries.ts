import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query-keys";

/** Refresh the cockpit snapshot after a flow action. */
export async function invalidateFlowDetail(
  queryClient: QueryClient,
  flowId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
}

/** Every prompt read for one flow (modal, plan composer, node previews). */
export async function invalidateFlowPrompts(
  queryClient: QueryClient,
  flowId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.flows.promptScope(flowId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.flows.prompts(flowId) }),
    queryClient.invalidateQueries({ queryKey: ["flows", "node-prompt", flowId] }),
    queryClient.invalidateQueries({ queryKey: ["flows", "node-branch-prompt", flowId] }),
  ]);
}
