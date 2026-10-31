'use client';

import { useState, useCallback } from 'react';
import { useSendChatMessage } from '@/hooks/useFlowChat';
import { composeModelChoice } from '@/lib/modelSpec';
import useLatest from '@/hooks/utility/useLatest';
import type { ModelChoice } from '@/types/modelSpec';

type SendMutationVariables = {
  flowId: string;
  nodeKey: string;
  modelChoice: ModelChoice | null;
  thread?: string | null;
  /** the composer's draft at send time (the run-node send IS the prompt body) */
  content: string;
};

export type SendMutationFn = (p: SendMutationVariables) => Promise<unknown>;

type Params = Omit<SendMutationVariables, 'content'> & {
  sendMutationFn?: SendMutationFn;
};

/**
 * The standard chat composer's mechanics: draft state, the send mutation and
 * the derived send-gating state. An optional feature-owned `sendMutationFn`
 * overrides the default chat mutation; the plan node uses the standard
 * `useSendChatMessage` path (including `thread` for branch tabs).
 */
export function useChatComposer({ flowId, nodeKey, modelChoice, sendMutationFn, thread }: Params) {
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: false,
    model: composeModelChoice(modelChoice) || undefined,
    thread,
  });

  // referential stability (AGENTS §2.5): the mutation reads the latest
  // values through refs, so a consumer taking it as a callback never needs
  // an unstable prop
  const latestSendMutationFn = useLatest(sendMutationFn);
  const latestSendChat = useLatest(sendChat);

  const [customSendPending, setCustomSendPending] = useState(false);
  const [customSendError, setCustomSendError] = useState<unknown>(null);

  const sendMessageMutation = useCallback(
    (content: string) => {
      if (latestSendMutationFn.current) {
        setCustomSendError(null);
        setCustomSendPending(true);
        return latestSendMutationFn
          .current({ flowId, nodeKey, modelChoice, thread, content })
          .catch((error: unknown) => {
            setCustomSendError(error);
            throw error;
          })
          .finally(() => setCustomSendPending(false));
      }

      const body = content.trim();
      if (!body || latestSendChat.current.isPending) return;
      return latestSendChat.current.mutateAsync(body);
    },
    [flowId, nodeKey, modelChoice, thread, latestSendMutationFn, latestSendChat]
  );

  const resetSendError = useCallback(() => {
    setCustomSendError(null);
    latestSendChat.current.reset();
  }, [latestSendChat]);

  const sendError = customSendError ?? sendChat.error;

  return {
    sendMessageMutation,
    isPending: sendChat.isPending || customSendPending,
    error: sendError,
    resetSendError,
  };
}
