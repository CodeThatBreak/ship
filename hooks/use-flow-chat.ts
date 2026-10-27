import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson, postJson } from "./fetch-json";

const CHAT_REFETCH_MS = 4000;

/** One chat turn, scoped to a node (or flow-level when node_key is unset). */
export type ChatMessage = {
  id: string;
  node_key?: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ChatPayload = { messages?: ChatMessage[] };
type PromptPayload = { prompt?: string };
type ChatSendOptions = { chatOnly: boolean; model?: string };

/** The flow's chat transcript, polled for the node's agent replies. */
export function useFlowChatMessages(flowId: string) {
  return useQuery({
    queryKey: queryKeys.flows.chat(flowId),
    queryFn: () => fetchJson<ChatPayload>(`/api/flows/${flowId}/chat`),
    refetchInterval: CHAT_REFETCH_MS,
    select: (d) => d.messages ?? [],
  });
}

/**
 * A node's prompt preview (prompt-publishing nodes, before the first output).
 * `enabled: false` skips the fetch entirely — pass the prompt-box visibility.
 */
export function useNodePrompt(
  flowId: string,
  nodeKey: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.flows.nodePrompt(flowId, nodeKey),
    queryFn: () =>
      fetchJson<PromptPayload>(
        `/api/flows/${flowId}/prompt?node=${encodeURIComponent(nodeKey)}`,
      ),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    select: (d) => d.prompt ?? "",
  });
}

/**
 * Send a chat message to the flow's agent (the config passed as one object so
 * the refine toggle and model pick are always current) and refresh the
 * transcript on success.
 */
export function useSendChatMessage(
  flowId: string,
  nodeKey: string,
  options: ChatSendOptions,
) {
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
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flows.chat(flowId),
      });
    },
  });
}
