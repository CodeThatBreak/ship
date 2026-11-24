import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/constants/queryKeys';
import { fetchJson, postJson } from './fetchJson';

const CHAT_REFETCH_MS = 4000;

/** One chat turn, scoped to a node (or flow-level when nodeKey is unset). */
export type ChatMessage = {
  id: string;
  nodeKey?: string;
  thread?: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type ChatPayload = { messages?: ChatMessage[] };
type PromptPayload = { prompt?: string };
type AllPromptsPayload = { prompts?: Record<string, string> };
type ChatSendOptions = { model?: string; thread?: string | null };

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
 * Send a chat message to the flow's agent (the options passed as one object
 * so the gating and model pick are always current) and refresh the
 * transcript on success. `thread` tags the turn for consumers that split the
 * conversation into tabs.
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
          model: options.model,
          thread: options.thread ?? null,
        })
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flows.chat(flowId),
      });
      // the send flips flow state synchronously (claim → the node's status
      // turns running) before the POST resolves — invalidate the snapshot
      // too, so the status-driven UIs ("Agent is cooking up the plan...", the
      // feed's busy/pending row) move without waiting for the events poll to
      // catch the run event
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flows.detail(flowId),
      });
    },
  });
}
