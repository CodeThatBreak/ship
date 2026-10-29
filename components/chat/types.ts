/** Chat-level option types shared between ChatPanel and its subcomponents. */

/** Options for plan-style runs (the decompose toggle). */
export type PlanOptions = { decompose: boolean };

/**
 * A conversation thread the feed can split into its own tab (the plan
 * feature's per-sub-plan-refinement tabs): a thread id (the plan's branch
 * name) and the tab's display label.
 */
export type ChatTab = {
  /** the thread id stored on `messages.thread` (the plan's branch name) */
  thread: string;
  label: string;
};

/**
 * The chat panel's tabs seam (the `composer` seam's sibling): a feature
 * supplies the thread tabs and owns the active thread; the panel only
 * renders the strip and filters the feed. `active: null` = the main
 * conversation. Absent (null) = single-transcript behavior, unchanged.
 */
export type ChatTabs = {
  items: ChatTab[];
  active: string | null;
  onActive: (thread: string | null) => void;
};
