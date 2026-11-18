import "server-only";

import type { TransitionKey } from "../types/transitions";

/**
 * Lifecycle messages the authority announces on a transition (task 5: one
 * place speaks about status changes). Keys without an entry stay silent in
 * the event feed — their call sites carry richer context (run outcomes post
 * the def's `outcome.event`; claims never announce, matching today's feed).
 * `detail` from the call site is appended when present.
 */
export const TRANSITION_MESSAGES: Partial<Record<TransitionKey, string>> = {
  armWait: "{nodeKey} {detail}",
  skipBranch: "{nodeKey} skipped — no active branch leads to it",
  loopReentry: "{nodeKey} re-enters via the loop edge — reset to pending",
  approve: "{nodeKey} approved",
  buildApprove: "{nodeKey} approved",
  cancel: "{nodeKey} stopped by user — retry when ready",
  fanoutOutcome: "{nodeKey} {detail}",
  splitOutcome: "{nodeKey} {detail}",
};
