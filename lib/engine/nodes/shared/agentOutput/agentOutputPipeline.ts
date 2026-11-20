import "server-only";

import type { AgentOutputRequest } from "./types/agentOutput";
import type { NodeSupport } from "../nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { AGENT_OUTPUT_ERROR, AgentOutputError } from "../agent/outputError/outputErrorExports";
import { RETRYABLE_OUTPUT_ERRORS } from "./constants/agentOutput";

/**
 * The one agent-output pipeline (Invariant 6, engine overhaul step 05): every
 * agent-emitting node funnels its response through THIS component —
 * `validate` (contract) → `output_error` envelope → per-node bounded feedback
 * retry → typed events — instead of each kind carrying a private parse/retry
 * loop.
 *
 * Role in the mental model: the `AgentOutputPipeline` §1 component. Invariants
 * upheld: 6 (one agent-output pipeline; missing output is a first-class state,
 * never a fabricated value) and 4's spirit (failures are typed and loud).
 *
 * Must never: fabricate a default output, retry `agent_reported` (the agent's
 * own reason goes to the user, not back to the agent), or swallow a
 * non-`AgentOutputError` throw — those belong to the kind's execution path.
 */

export class AgentOutputPipeline {
  constructor(private readonly support: NodeSupport = nodeSupport) {}

  /**
   * Run one response through the contract with the bounded feedback retry.
   * Returns the validated value; throws the standard {@link AgentOutputError}
   * when the budget is exhausted, the failure is not retryable, or the agent
   * self-reported — after emitting the matching typed event
   * (`output_retry` / `output_exhausted` / `agent_reported`). The success
   * event is the kind's own lifecycle outcome.
   */
  async run<R>(req: AgentOutputRequest<R>): Promise<R> {
    let text = req.text;
    for (let attempt = 0; ; attempt++) {
      let value: R;
      try {
        value = await req.validate(text);
      } catch (e: unknown) {
        if (!(e instanceof AgentOutputError)) throw e;
        if (e.code === AGENT_OUTPUT_ERROR.AGENT_REPORTED) {
          // the agent's escape hatch: its reason IS the failure — conveyed to
          // the user, never fed back for another attempt
          await this.emit(req, EVENT_KIND.AGENT_REPORTED, e.detail.message, {
            code: e.code,
            reason: e.detail.reported?.reason ?? null,
          });
          throw e;
        }
        if (!RETRYABLE_OUTPUT_ERRORS.has(e.code) || req.retryPrompt == null) throw e;
        if (attempt >= req.budget) {
          await this.emit(
            req,
            EVENT_KIND.OUTPUT_EXHAUSTED,
            `${req.label}: output contract still violated after ${req.budget} feedback retry(ies) (${e.code}) — failing`,
            { code: e.code, budget: req.budget, issues: e.detail.issues },
          );
          throw e;
        }
        await this.emit(
          req,
          EVENT_KIND.OUTPUT_RETRY,
          `${req.label}: output contract failed — retrying with feedback (${e.code})`,
          { code: e.code, attempt: attempt + 1, budget: req.budget, issues: e.detail.issues },
        );
        text = await req.executeRetry(await req.retryPrompt(e, attempt + 1), attempt + 1);
        continue;
      }
      return value;
    }
  }

  private async emit(req: AgentOutputRequest<unknown>, kind: string, message: string, data: Record<string, unknown>): Promise<void> {
    await this.support.emit(req.ctx.flow.id, req.nodeId, kind, message, data);
  }
}
