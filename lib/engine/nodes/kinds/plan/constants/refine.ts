import { FLOW_STATUS } from "../../../../../../constants/flow";

/**
 * The conversational-refine domain constants (docs/plan-conversation-refine.md):
 * the `refinedFrom` provenance union (§6c), the apply-state guard (§3b), and
 * the conversation turn's labels + plain-language copy (§3a/§3c). Engine node
 * rows carry these status values verbatim (the UI's own set lives in
 * `constants/flow.ts` — the same strings).
 */

/** Who produced a plan version (§6c provenance). Stored ONLY on version-
 *  bump-producing runs — "a version with `refinedFrom`" == "a produced refine". */
export const REFINED_FROM_SOURCE = {
  /** a conversational apply (PlanNode.chat → applyPlanVersion) */
  CHAT: "chat",
  /** the branch-scoped sub-plan refine (PlanOutputContract.scopedOutcome) */
  BRANCH: "branch",
  /** a run started with a prompt body that diverged from the plan template */
  START: "start",
} as const;
export type RefinedFromSource = (typeof REFINED_FROM_SOURCE)[keyof typeof REFINED_FROM_SOURCE];

/** Plan artifact meta's `refinedFrom` record (and PlanStore.persistPlan's arg). */
export interface RefinedFrom {
  /** the plan artifact version the refine was based on (0 = no version yet) */
  version: number;
  source: RefinedFromSource;
}

/**
 * Node states a conversational plan apply may mutate (§3b): `awaiting_approval`
 * is the normal case, `pending` is the FIRST-apply state (no UI path — the tab
 * opens after run 1; contract-required), `failed` is the rescue path. Every
 * other non-empty status refuses (`running`, `approved`, `done`, …) — the
 * conservative default, never a silent mid-run mutation.
 */
export const PLAN_APPLY_ALLOWED: ReadonlySet<string> = new Set([
  FLOW_STATUS.PENDING,
  FLOW_STATUS.AWAITING_APPROVAL,
  FLOW_STATUS.FAILED,
]);

// ── the conversation follow-up turn (PlanNode.chat, §3a) ─────────────────────

/** The run label a conversation follow-up turn records (the agent's intent is
 *  not known until the response parses — version-bearing turns are visible via
 *  the `plan vN ready for review` lifecycle event instead of the run label). */
export const PLAN_CHAT_LABEL = "plan chat";
/** The bounded validation-retry turn's run label (plan-bearing by construction). */
export const PLAN_CHAT_RETRY_LABEL = "plan refine retry";

/** The reply default when a turn carries a plan but no reply (§8: plan wins). */
export const PLAN_UPDATED_REPLY = "Plan updated.";

/** The plain-language violation for a retry turn that came back reply-only. */
export const PLAN_RETRY_NO_PLAN = "the retried response carried no plan payload";

/** The §3b refusal reason — plain language, quoted back into the chat reply. */
export const planRefusalReason = (status: string): string =>
  `can't update the plan while it is ${status}`;

/** ONE lifecycle event per §3b state-guard refusal. */
export const planUpdateIgnoredEvent = (status: string): string =>
  `plan update ignored — node ${status}`;

/** §3c failure semantics: a validation-failed apply ends the turn as an
 *  assistant message with ONE lifecycle event — no `failed` node, no partial version. */
export const planValidationFailedEvent = "plan refine failed validation — nothing was changed";
export const planValidationRefusalReply = (violation: string): string =>
  `I couldn't produce a valid plan for that — ${violation}. Try rephrasing or being more specific; nothing was changed.`;

/** The conversational refusal wrapper: the reply answers AND explains the skip (§8) — never a silent dead end. */
export const planRefusedReply = (reply: string, reason: string): string =>
  `${reply}\n\nNoted — but the plan itself wasn't updated: ${reason}`;
