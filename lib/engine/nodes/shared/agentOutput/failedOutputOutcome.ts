import "server-only";

import { NODE_RUN_STATUS } from "../../../../../constants/flow";
import { ARTIFACT_KIND } from "../../../constants/vocabulary";
import type { RunOutcome } from "../types/runOutcome";
import type { AgentOutputError } from "../agent/outputError/outputErrorExports";

/**
 * The `failed_output` artifact's meta (Task 20, use case 8e): the ledger a
 * retry-exhausted run persists beside the raw response head — the feedback
 * budget it spent, the contract code, and the per-path schema violations the
 * LAST response committed. The panel's renderer and the in-flow Configure
 * dialog read this to see what to fix.
 */
export interface FailedOutputPayload {
  /** the retryable output-contract code that exhausted the budget */
  code: string;
  /** feedback retries the pipeline spent before the failure went terminal */
  budget: number;
  /** the schema violations (dotted path + message) of the last response */
  issues: { path: string; message: string }[];
}

/**
 * The failed terminal for an agent run whose output contract was still
 * violated after the bounded feedback budget (Task 20): a failed
 * {@link RunOutcome} carrying the `failed_output` artifact — the raw
 * response head as the content, the violations ledger as the meta. The
 * artifact rides the terminal batch's transaction (Invariant F2) because
 * the outcome goes through the one persistence path (`applyOutcome`) —
 * the same door a success exits through. Pure shaping: no persistence here.
 */
export const failedOutputOutcome = (label: string, failure: AgentOutputError, budget: number): RunOutcome => {
  const payload: FailedOutputPayload = {
    code: failure.code,
    budget,
    issues: failure.detail.issues,
  };
  const message = `${label}: output contract still violated after ${budget} feedback retry(ies) (${failure.code}) — failing`;
  return {
    status: NODE_RUN_STATUS.FAILED,
    output: {},
    artifact: {
      kind: ARTIFACT_KIND.FAILED_OUTPUT,
      // the head of the exact bad response — what the panel shows first
      content: failure.detail.response_excerpt,
      meta: payload,
    },
    event: `${label} failed — output contract exhausted (${failure.code})`,
    eventData: { error: message, code: payload.code, budget: payload.budget, issues: payload.issues },
    reply: message,
  };
};
