import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/constants/queryKeys';
import { fetchJson, postJson } from './fetchJson';

const CHAT_REFETCH_MS = 4000;

/** One chat turn, scoped to a node (or flow-level when node_key is unset).
 *  `thread` (the plan node's branch names) puts the turn in a refinement tab
 *  instead of the main conversation. */
export type ChatMessage = {
  id: string;
  node_key?: string;
  thread?: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type ChatPayload = { messages?: ChatMessage[] };
type PromptPayload = { prompt?: string };
type AllPromptsPayload = { prompts?: Record<string, string> };
type ChatSendOptions = { chatOnly: boolean; model?: string; thread?: string | null };

/** The flow's chat transcript, polled for the node's agent replies. */
export function useFlowChatMessages(flowId: string) {
  return useQuery({
    queryKey: queryKeys.flows.chat(flowId),
    queryFn: () => fetchJson<ChatPayload>(`/api/flows/${flowId}/chat`),
    refetchInterval: CHAT_REFETCH_MS,
    select: d => d.messages ?? [],
  });
}

/**
 * A node's prompt preview (the plan composer's prompt state — the prefilled
 * plan body before the first run, §4a). `enabled: false` skips the fetch
 * entirely; a failed read leaves the send gated and the retry inline.
 */
export function useNodePrompt(flowId: string, nodeKey: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.flows.nodePrompt(flowId, nodeKey),
    queryFn: () => fetchJson<PromptPayload>(`/api/flows/${flowId}/prompt?node=${encodeURIComponent(nodeKey)}`),
    enabled: options.enabled ?? true,
    // null (not "") so a missing template fails loudly in the composer
    // instead of seeding an empty, sendable body
    select: d => d.prompt ?? null,
  });
}

/**
 * Every promptable node's prompt body in one read (the plan composer's
 * prefill source, §4a): one bounded fetch instead of one per node. `prompts`
 * is keyed by node key; nodes without a previewable prompt (agent kinds)
 * never appear. null while loading — a missing body fails loudly instead of
 * seeding an empty, sendable draft.
 */
export function useFetchAllNodePrompt(flowId: string) {
  const promptsQuery = useQuery({
    queryKey: queryKeys.flows.prompts(flowId),
    queryFn: () => fetchJson<AllPromptsPayload>(`/api/flows/${flowId}/prompts`),
  });
  return {
    prompts: promptsQuery.data?.prompts ?? null,
    isLoading: promptsQuery.isPending,
  };
}

/**
 * A node's branch-scoped prompt body (the plan composer's scoped-refine
 * prefill, §4c). The route answers 400 when the ref'd branch is no longer in
 * the latest plan — the read stays failed and the chip shows invalidated.
 */
export function useNodeBranchPrompt(flowId: string, nodeKey: string, branch: string | null) {
  return useQuery({
    queryKey: queryKeys.flows.nodeBranchPrompt(flowId, nodeKey, branch ?? ''),
    queryFn: () =>
      fetchJson<PromptPayload>(
        `/api/flows/${flowId}/prompt?node=${encodeURIComponent(nodeKey)}&branch=${encodeURIComponent(branch ?? '')}`
      ),
    enabled: branch != null,
    // null (not "") so a missing branch body fails loudly in the composer
    select: d => d.prompt ?? null,
  });
}

/**
 * Send a chat message to the flow's agent (the options passed as one object
 * so the gating and model pick are always current) and refresh the
 * transcript on success. `thread` tags the turn with the active refinement
 * tab (the plan's sub-plan refines) instead of the main conversation.
 */
export function useSendChatMessage(flowId: string, nodeKey: string, options: ChatSendOptions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      postJson<{ ok: boolean }>(
        `/api/flows/${flowId}/chat`,
        JSON.stringify({
          nodeKey,
          content,
          chatOnly: options.chatOnly,
          model: options.model,
          thread: options.thread ?? null,
        })
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flows.chat(flowId),
      });
    },
  });
}
