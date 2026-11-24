/** The fixed tabs; artifact kinds add further string values to the strip. */
export const AGENT_VIEW_TAB = {
  OUTPUT: 'output',
} as const;

/** `-mx-5` cancels the panel body's 20px insets; `w-full` alone would only
 *  span the content box and stop 20px short on the right, so add the insets
 *  back to make the strip truly edge-to-edge. */
export const TABS_LIST_CLASS =
  '-mx-5 -mt-3 h-auto w-[calc(100%+2.5rem)] rounded-none border-b border-border bg-transparent p-0';
