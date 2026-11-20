import "server-only";

import { TemplateRenderer } from "../../templateRenderer";
import { AGENT_OUTPUT_ERROR, type AgentOutputError } from "../../agent/outputError/outputErrorExports";

/** The kind-specific tail line appended after the shared re-emit instruction
 *  (resolve's one-decision-per-comment rule, plan's branch/whole guidance). */
export interface RetryFeedbackOptions {
  readonly extraInstruction?: string;
}

/**
 * The ONE retry-feedback body (step 05 dedupe — the plan/resolve/agent
 * "re-emit your ENTIRE response" copies are gone): the specific failure in
 * the agent's own response's terms, then the re-emit instruction. The
 * pipeline appends the contract directive on top (`AgentOutputPipeline`
 * callers compose `retryFeedbackBody` + `AgentOutputError.directive`).
 */
export const retryFeedbackBody = (failure: AgentOutputError, opts: RetryFeedbackOptions = {}): string => {
  const reemit = "Re-emit your ENTIRE response as a single JSON object.";
  const body =
    failure.code === AGENT_OUTPUT_ERROR.NO_JSON
      ? TemplateRenderer.compose("Your previous response could not be used: no JSON object could be parsed from it.")
          .addBlankLine()
          .addLine(reemit)
          .build()
      : TemplateRenderer.compose("Your previous response was valid JSON but violated the output contract:")
          .addBlankLine()
          .addLines(failure.detail.issues.map((i) => `  - ${i.path ? `${i.path}: ` : ""}${i.message}`))
          .addBlankLine()
          .addLine(reemit)
          .build();
  if (!opts.extraInstruction) return body;
  return TemplateRenderer.compose(body).addBlankLine().addLine(opts.extraInstruction).build();
};
