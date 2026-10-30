'use client';

import { useState, useCallback } from 'react';
import { useSendChatMessage } from '@/hooks/use-flow-chat';
import { composeModelChoice } from '@/lib/modelSpec';
import type { ModelChoice } from '@/types/model-spec';

type Params = {
  flowId: string;
  nodeKey: string;
  modelChoice: ModelChoice | null;
  sendMutationFn?: (p: { flowId: string; nodeKey: string; modelChoice: ModelChoice | null }) => Promise<void>;
};

/**
 * The standard chat composer's mechanics: draft state, the send mutation and
 * the derived send-gating state. The plan node bypasses this hook entirely —
 * its three composer states and send targets live in the plan feature's
 * `usePlanComposer` (docs/plan-conversation-refine.md §4d), so this hook
 * never grows plan logic.
 */
export function useChatComposer({ flowId, nodeKey, modelChoice, sendMutationFn }: Params) {
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: false,
    model: composeModelChoice(modelChoice) || undefined,
  });

  const [loading, setLoading] = useState(false);

  const sendMessageMutation = useCallback((content: string) => {
    if (sendMutationFn) {
      setLoading(true);
      return sendMutationFn({ flowId, nodeKey, modelChoice }).finally(() => setLoading(false));
    }

    const body = content.trim();
    if (!body || sendChat.isPending) return;
    return sendChat.mutateAsync(body);
  }, []);

  return {
    sendMessageMutation,
    isPending: sendChat.isPending || loading,
    error: sendChat.error,
  };
}
