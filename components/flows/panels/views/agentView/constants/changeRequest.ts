/** The direct change-request verb pushes the branch and adopts an existing
 *  MR — only the affordance's label changes once one is recorded. */
export const CHANGE_REQUEST_ACTION_LABEL = {
  OPEN: 'Open PR',
  PUSH: 'Push changes',
} as const;
