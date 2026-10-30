import { useCallback } from 'react';

import type { SendMutationFn } from '@/components/chat';
import { useFlowMutation } from '@/components/flows/mutations/useFlowMutation';
import { FLOW_ACTION, FLOW_STATUS } from '@/constants/flow';
import usePlanChatAction from './hooks/usePlanChatAction';

/**
 * The plan feature's composer + chat-rail state machine
 * (docs/plan-conversation-refine.md §4d): the send targets live here —
 * the composer's send is the node run itself while the plan is pending
 * (the chat text becomes the prompt body); once the plan exists, the chat
 * conversation owns the sends and the rail's standard mechanics apply.
 * The chat rail's thread state (the active tab, the per-thread unsent
 * drafts, the composer draft swaps) lives in `usePlanChatAction` (§4d).
 *
 * There is no mode state: where you are (plan pending or not) decides what
 * a send does.
 */
type Params = {
  flowId: string;
  artifactCount: number;
  nodeStatus?: string;
  model: string;
  nodeKey: string;
};

const usePlanComposer = ({ flowId, artifactCount, nodeStatus, model, nodeKey }: Params) => {
  const flowMutationFn = useFlowMutation({ flowId });

  const {
    activeThreadId,
    chatInputRef,
    onAction,
    prompts,
    isPromptsLoading,
  } = usePlanChatAction({ flowId });

  // No plan yet (no artifacts, node still pending) — the first send must run
  // the node itself before any chat conversation exists.
  const isPlanPending = artifactCount === 0 && nodeStatus === FLOW_STATUS.PENDING;

  const onSendChatMutationFn: SendMutationFn = useCallback(
    ({ content }) => {
      // If there is no plan, we first need to run the node — the composer's
      // text rides the run as the prompt body
      return flowMutationFn({
        action: FLOW_ACTION.RUN_NODE,
        nodeKey,
        input: { prompt: content, promptIsBody: true, model: model || null },
      });
    },
    [flowMutationFn, nodeKey, model]
  );

  return {
    activeThreadId,
    onAction,
    chatInputRef,
    /** every promptable node's prompt body (the prefill source), null while loading */
    prompts,
    loading: isPromptsLoading,
    /**
     * If plan is generated, chat conversation can handle the state
     */
    onSendChatMutationFn: isPlanPending ? onSendChatMutationFn : undefined,
  };
};

export { usePlanComposer };
