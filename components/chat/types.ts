/** Chat-level option types shared between ChatPanel and its subcomponents. */

/** Options for plan-style runs (the decompose toggle). */
export type PlanOptions = { decompose: boolean };

/**
 * The chat panel's tabs seam (the `composer` seam's sibling): the feature
 * supplies the full tab list — its default view (e.g. the main plan) plus
 * one tab per selectable conversation — and owns the active id. The panel
 * renders the generic `TabStrip` and filters the feed by the active id
 * (`messages.thread`). Absent (null) = single-transcript behavior, unchanged.
 */
export type ChatTab = {
  id: string;
  label: string;
  /**
   * The tab's feed empty state — feature-owned copy (the defining feature
   * knows what its conversation is for); absent = the generic agent default
   * in `ChatFeed`.
   */
  emptyTitle?: string;
  emptyDescription?: string;
};

/**
 * The chat composer's imperative handle: the input's focus/selection plus
 * `setDraft` — a feature-owned draft change (the plan's thread switch restores
 * that thread's kept draft) via the exposed ref, without a prop round trip.
 */
export type ChatInputHandle = {
  focus: (position?: number) => void;
  setSelectionRange: (start: number, end: number) => void;
  setDraft: (draft: string) => void;
};
