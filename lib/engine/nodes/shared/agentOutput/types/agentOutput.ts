import type { FlowCtx } from "../nodeSharedExports";
import type { AgentOutputError } from "../agent/outputError/outputErrorExports";

/** One agent-output run: the first response, the kind's contract validator,
 *  and (for kinds with a feedback path) the retry prompt + turn executor. */
export interface AgentOutputRequest<R> {
  readonly ctx: FlowCtx;
  readonly nodeId: string;
  /** the label the events and failure messages carry (e.g. "plan", "resolve") */
  readonly label: string;
  /** the FIRST agent response text */
  readonly text: string;
  /** per-node bounded feedback-retry budget (the def's `retryBudget` knob) */
  readonly budget: number;
  /** validate one response text against the kind's contract — throws the
   *  standard {@link AgentOutputError} on a miss */
  readonly validate: (text: string) => Promise<R> | R;
  /** the retry prompt for a retryable miss — omit on validation-only kinds
   *  (no feedback turn exists; the first miss is terminal) */
  readonly retryPrompt?: (failure: AgentOutputError, attempt: number) => Promise<string> | string;
  /** execute one feedback turn on the kind's agent session — returns its
   *  response text. Non-`AgentOutputError` throws (e.g. RunSupersededError)
   *  propagate untouched. */
  readonly executeRetry: (retryPrompt: string, attempt: number) => Promise<string>;
}
