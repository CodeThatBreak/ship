import usePlanChatAction from './hooks/usePlanChatAction';

/**
 * The plan feature's composer + chat-rail state machine
 * (docs/architecture/plan-unified-turns.md): every send is
 * `POST /api/flows/:id/chat` via `useChatComposer` / `useSendChatMessage`.
 * Branch tabs pass `thread` from `usePlanChatAction`; the engine routes
 * pre-publish, whole-plan, and branch turns from artifact count + thread.
 *
 * Thread state (active tab, per-thread draft stash, composer draft swaps)
 * lives in `usePlanChatAction`.
 */
type Params = {
  flowId: string;
};

const usePlanComposer = ({ flowId }: Params) => {
  const { activeThreadId, chatInputRef, onAction, prompts, isPromptsLoading } = usePlanChatAction({ flowId });

  return {
    activeThreadId,
    onAction,
    chatInputRef,
    /** every promptable node's prompt body (the prefill source), null while loading */
    prompts,
    isPromptsLoading,
  };
};

export { usePlanComposer };
