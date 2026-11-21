import "server-only";

import { z } from "zod";
import { NODE_RUN_STATUS } from "../../../../../constants/flow";
import { AGENT_OUTPUT_FORMAT } from "../../../constants/declarative";
import type { RunOutcome } from "../../shared/nodeSharedExports";
import { validateStandardAgentOutput } from "../../shared/agentOutput/utils/standardOutput";
import { AGENT_OUTPUT_ERROR, AgentOutputError } from "../../shared/agent/outputError/outputErrorExports";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import type { RunOutcomeFacts } from "../../shared/types/runOutcome";

/**
 * The agent kind's output-contract shaping: the agent's raw response text
 * shaped into the declared output contract's {@link RunOutcome} (status,
 * output, artifact, event, reply) — the shape BOTH run paths (`run`,
 * `chat`) and restart recovery (`recover`) publish through. Invariant
 * upheld: nothing is published unvalidated (step 04) — `output: json` is
 * schema-validated with the standard {@link AgentOutputError} payload, and
 * an empty markdown response is a typed failure, never a fabricated
 * empty-response placeholder. Must never persist anything itself — it only
 * shapes; persistence belongs to the shared `applyOutcome` path.
 */

/**
 * Shape the agent's text into the declared output contract. `output: json`
 * validates against the output contract (the def's schema converted to Zod,
 * or the record contract when no schema is declared) and fails loudly on a
 * bad response — with the standard {@link AgentOutputError} payload: the
 * machine-readable code, every schema violation (path + message), and the
 * head of the raw response so the trail shows what actually came back.
 * The agent may also self-report that it cannot comply by answering with
 * the standard error envelope — its reason then is the failure message,
 * verbatim. (The node's `finalizeOutput` wraps the json path in the ONE
 * agent-output pipeline — one feedback retry per the def's `retryBudget` for
 * `no_json` / `schema_mismatch`; `recover` re-applies it as-is — recovery is
 * persistence-only, a bad recorded result fails for manual retry.)
 * `output: markdown` saves the text as an artifact and publishes
 * `{{nodes.<key>.output.markdown}}`.
 *
 * @param hold - Whether the node holds at `awaiting_approval` instead of
 *   `done` (approval-triggered instances — the caller computes it per
 *   attempt from the flow graph).
 * @param facts - The run's captured fact intents (Task 07): `result.git`
 *   mapped through the def's `produces` by `agentFactIntents` — pure data,
 *   attached verbatim to the shaped outcome. Shaping stays pure: the
 *   persistence belongs to `applyOutcome`'s terminal batch (Invariant F2).
 */
export const shapeAgentOutcome = (
  text: string,
  cfg: AgentDef,
  outputSchema: z.ZodType<Record<string, unknown>>,
  label: string,
  hold: boolean,
  facts?: RunOutcomeFacts,
): RunOutcome => {
  if (cfg.output === AGENT_OUTPUT_FORMAT.JSON) {
    // the standard validation (step 05 — the private extractJson →
    // envelope → schema copy is gone): `no_json`, the agent's error
    // envelope, or `schema_mismatch` with every issue
    const output = validateStandardAgentOutput({
      label,
      text,
      schema: outputSchema,
      mustBeObject: true,
      noJsonNote: "the node's output format is configured as json",
      mismatchNote: `${label}: the agent response violated its output schema`,
    });
    return {
      status: hold ? NODE_RUN_STATUS.AWAITING_APPROVAL : NODE_RUN_STATUS.DONE,
      output,
      artifact: {
        kind: AGENT_OUTPUT_FORMAT.JSON,
        content: JSON.stringify(output, null, 2),
      },
      event: `${label} output ready${hold ? ' — awaiting approval' : ''}`,
      eventData: { output_format: AGENT_OUTPUT_FORMAT.JSON },
      reply: '```json\n' + JSON.stringify(output, null, 2) + '\n```',
      ...(facts ? { facts } : {}),
    };
  }
  // step 05: an empty response is a typed failure — missing output is a
  // first-class state, never a fabricated empty-response placeholder
  const body = text.trim();
  if (!body) {
    throw new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label,
      message: `${label}: the agent returned an empty response — the markdown output contract requires non-empty text`,
      issues: [],
      response: text,
    });
  }
  return {
    status: hold ? NODE_RUN_STATUS.AWAITING_APPROVAL : NODE_RUN_STATUS.DONE,
    output: { [AGENT_OUTPUT_FORMAT.MARKDOWN]: body },
    artifact: { kind: AGENT_OUTPUT_FORMAT.MARKDOWN, content: body },
    event: `${label} output ready${hold ? ' — awaiting approval' : ''}`,
    eventData: { output_format: AGENT_OUTPUT_FORMAT.MARKDOWN },
    reply: body,
    ...(facts ? { facts } : {}),
  };
};
