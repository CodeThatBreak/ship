import { FLOW_STATUS } from '@/constants/flow';

/** Footer copy per node status; unlisted statuses get no hint. */
export const FOOTER_HINT_BY_STATUS: Partial<Record<string, string>> = {
  [FLOW_STATUS.AWAITING_APPROVAL]: 'Output is ready — approve it to activate the next steps.',
  [FLOW_STATUS.DONE]: 'Output ready. Continue in the chat to refine it.',
  [FLOW_STATUS.APPROVED]: 'Output ready. Continue in the chat to refine it.',
  [FLOW_STATUS.PENDING]: 'Review the prompt in the chat, then send to run.',
  [FLOW_STATUS.FAILED]: 'The run failed — retry it once the issue is fixed.',
};

export const NO_FOOTER_HINT = '';
