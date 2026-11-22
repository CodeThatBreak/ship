import { FLOW_STATUS } from '@/constants/flow';

/** The fixed tabs; artifact kinds add further string values to the strip. */
export const AGENT_VIEW_TAB = {
  OUTPUT: 'output',
  STEPS: 'steps',
} as const;

/** full-width, edge-to-edge line tabs: each tab shares the strip evenly and
 *  its active underline spans the whole tab (the strip has no inset padding) */
export const TRIGGER_CLASS =
  'min-w-0 flex-1 truncate rounded-none border-b-2 border-b-transparent px-3 py-2 text-[12.5px] font-medium after:hidden data-active:border-b-foreground data-active:text-foreground';
/** `-mx-5` cancels the panel body's 20px insets; `w-full` alone would only
 *  span the content box and stop 20px short on the right, so add the insets
 *  back to make the strip truly edge-to-edge. */
export const TABS_LIST_CLASS =
  '-mx-5 -mt-4 h-auto w-[calc(100%+2.5rem)] rounded-none border-b border-border bg-transparent p-0';

/** The direct change-request verb pushes the branch and adopts an existing
 *  MR — only the affordance's label changes once one is recorded. */
export const CHANGE_REQUEST_ACTION_LABEL = {
  OPEN: 'Open PR',
  PUSH: 'Push changes',
} as const;

/** Footer copy per node status; unlisted statuses get no hint. */
export const FOOTER_HINT_BY_STATUS: Partial<Record<string, string>> = {
  [FLOW_STATUS.AWAITING_APPROVAL]: 'Output is ready — approve it to activate the next steps.',
  [FLOW_STATUS.DONE]: 'Output ready. Continue in the chat to refine it.',
  [FLOW_STATUS.APPROVED]: 'Output ready. Continue in the chat to refine it.',
  [FLOW_STATUS.PENDING]: 'Review the prompt in the chat, then send to run.',
  [FLOW_STATUS.FAILED]: 'The run failed — retry it once the issue is fixed.',
};

export const NO_FOOTER_HINT = '';
