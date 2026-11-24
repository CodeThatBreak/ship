import usePlanChatAction from './hooks/usePlanChatAction';

/**
 * The plan feature's composer data seam (docs/architecture/plan-unified-turns.md):
 * every send is `POST /api/flows/:id/chat` via `useChatComposer` /
 * `useSendChatMessage`. Prompt prefill comes from one bounded bulk read.
 */
type Params = {
  flowId: string;
};

const usePlanComposer = ({ flowId }: Params) => {
  const { prompts, isPromptsLoading } = usePlanChatAction({ flowId });

  return {
    /** every promptable node's prompt body (the prefill source), null while loading */
    prompts,
    isPromptsLoading,
  };
};

export { usePlanComposer };
