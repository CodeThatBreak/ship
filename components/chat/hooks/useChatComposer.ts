'use client';

import { useState, useCallback } from 'react';
import { useSendChatMessage } from '@/hooks/use-flow-chat';
import { composeModelChoice } from '@/lib/modelSpec';
import useLatest from '@/hooks/utility/useLatest';
import type { ModelChoice } from '@/types/model-spec';

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
 * the derived send-gating state. A feature-owned send target (the plan node's
 * run_node rides `sendMutationFn`, receiving the draft text with the
 * composer's model pick and thread); without one the standard chat mutation
 * applies.
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

  const [loading, setLoading] = useState(false);

  const sendMessageMutation = useCallback(
    (content: string) => {
      if (latestSendMutationFn.current) {
        setLoading(true);
        return latestSendMutationFn
          .current({ flowId, nodeKey, modelChoice, thread, content })
          .finally(() => setLoading(false));
      }

      const body = content.trim();
      if (!body || latestSendChat.current.isPending) return;
      return latestSendChat.current.mutateAsync(body);
    },
    [flowId, nodeKey, modelChoice, thread, latestSendMutationFn, latestSendChat]
  );

  return {
    sendMessageMutation,
    isPending: latestSendChat.current.isPending || loading,
    error: latestSendChat.current.error,
  };
}
