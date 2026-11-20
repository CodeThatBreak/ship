import "server-only";

import { z } from "zod";
import { AGENT_OUTPUT_FORMAT } from "../../../constants/declarative";
import type { AgentDef } from "../../declarativeSchemas";
import { jsonSchemaToZod } from "../../../templates/jsonSchemaToZod";

/**
 * No declared input contract (§3): the run input is inherited from the
 * previous node's output — everything else reaches the prompt through the
 * flow-context variables. Loose: extra context fields (prompt refs, retries)
 * pass through unenforced.
 */
export const AgentRunInput = z.looseObject({
  model: z.string().nullish(),
  prompt: z.string().nullish(),
}) as z.ZodType<Record<string, unknown>>;

/**
 * The agent's REAL output contract (step 04 — nothing is published
 * unvalidated):
 *
 * - `output: markdown` → exactly `{markdown: string}` (the artifact contract).
 * - `output: json` with a declared `output_schema` → the template-authored
 *   JSON Schema converted to Zod at config load (the declarative def cache
 *   holds instances, so the conversion happens once per node instance).
 * - `output: json` without a schema → a JSON object of any shape — still a
 *   real contract (the response must BE an object), not a free pass.
 *
 * Unsupported/invalid JSON Schema is a loud load-time error on the template
 * (the step-04 risk rule) — never a silent pass-through.
 */
export const agentOutputContract = (def: AgentDef, label: string): z.ZodType<Record<string, unknown>> => {
  if (def.output !== AGENT_OUTPUT_FORMAT.JSON) {
    return z.object({ [AGENT_OUTPUT_FORMAT.MARKDOWN]: z.string() }) as unknown as z.ZodType<Record<string, unknown>>;
  }
  if (def.output_schema && typeof def.output_schema === "object") {
    return jsonSchemaToZod(def.output_schema, label);
  }
  return z.record(z.string(), z.unknown()) as unknown as z.ZodType<Record<string, unknown>>;
};
