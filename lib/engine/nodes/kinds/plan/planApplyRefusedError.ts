import 'server-only';

/**
 * Conversational refusal raised by the §3b apply guard in
 * {@link PlanOutputContract.applyTurnResult}: the node's claim moved on (a
 * different or cleared attempt owns it — cancelled/retried mid-turn) or the
 * node sits in a non-apply-allowed status, so the validated plan is NOT
 * applied and `reply` is the refusal text the user sees.
 *
 * Invariant: this is a user-facing refusal, not a contract violation — the
 * retry pipeline (`applyTurnResultWithRetry`) must catch it and return the
 * refusal as a quiet outcome instead of spending feedback-retry budget on it.
 * It must never be thrown for parse/schema failures (those stay
 * `AgentOutputError`).
 */
export class PlanApplyRefusedError extends Error {
  constructor(readonly reply: string) {
    super(reply);
    this.name = 'PlanApplyRefusedError';
  }
}
