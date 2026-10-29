import type * as React from "react";

/**
 * The composer's config seam (docs/plan-conversation-refine.md §4d): the
 * surface a feature builds to drive the chat composer from outside, so
 * ChatComposerForm stays generic — no feature forks inside it. The plan node
 * is the first consumer: its three states (prompt / conversation /
 * scoped-prefill) all express as this config, built by the plan feature's
 * `usePlanComposer`. Other nodes render the standard composer (the chat
 * panel builds a zero-cost config from its own draft/send mechanics).
 */
export interface ComposerConfig {
  /**
   * The draft. null = conversation state — the composer manages its own
   * empty draft (and clears it after an accepted send). A string = a
   * controlled draft (the prefilled prompt / scoped branch body), whose
   * edits flow back through `onDraftChange`.
   */
  draft: string | null;
  /** Forward the controlled draft's edits to the config builder. */
  onDraftChange?: (draft: string) => void;
  /** The prefill fetch is in flight → the composer renders a skeleton. */
  loading: boolean;
  /** Prefill failure + retry slot, rendered in place of the textarea. */
  error: React.ReactNode | null;
  /**
   * The builder's send-mutation pending state (double-send disable).
   * Undefined = the composer tracks a pending send itself (managed draft).
   */
  sending?: boolean;
  /** Explicit send-gating override (e.g. the invalidated scoped chip). */
  canSend?: boolean;
  /** The builder's send-mutation error message (alerted under the feed). */
  sendError?: string | null;
  /** Send-button label: "Generate plan" | "Send" (plain send keeps the arrow-only look). */
  sendLabel: string;
  /** Auto-grow tall gated textarea (prompt / scoped states). */
  growing: boolean;
  /** Caption row above the input: char count, scoped chip slot. */
  caption?: React.ReactNode | null;
  /** The ghost "Reset to template" affordance (prefill diverges from the template). */
  reset?: { canReset: boolean; onReset: () => void };
  /** Extra trailing controls beside the model selector (the decompose toggle in the prompt state). */
  aside?: React.ReactNode;
  /** The send target — run_node | chat | refine_plan, decided by the builder.
   *  A returned promise is the "send accepted" signal: a managed draft clears
   *  on its resolution (and keeps the draft while it is pending/rejected). */
  onSend: (draft: string) => void | Promise<unknown>;
  placeholder: string;
  /** Bump to move focus into the textarea (the plan panel's "Refine plan"). */
  focus?: number;
}
