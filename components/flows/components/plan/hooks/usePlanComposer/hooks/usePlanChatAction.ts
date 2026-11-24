import { useFetchAllNodePrompt } from '@/hooks/useFlowChat';

/**
 * The plan chat rail's data seam: every promptable node's prompt body in one
 * read, used as the composer's prefill source (§4a). With a single whole-plan
 * conversation there is no thread state to own.
 */
type Params = {
  /** the flow id the bulk prompt read (every node's prompt body) is scoped to */
  flowId: string;
};

const usePlanChatAction = ({ flowId }: Params) => {
  const { prompts, isLoading: isPromptsLoading } = useFetchAllNodePrompt(flowId);

  return { prompts, isPromptsLoading };
};

export default usePlanChatAction;
