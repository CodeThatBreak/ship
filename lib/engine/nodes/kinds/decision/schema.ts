import "server-only";

import { z } from "zod";
import type { DecisionDef } from "../../declarativeSchemas";

/**
 * No declared input contract — the input is the previous node's output.
 * Loose: extra context fields pass through unenforced.
 */
export const DecisionRunInput = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>;

/**
 * The decision's REAL output contract (step 04): `{chosen: string[],
 * rationale?: string}` strict, plus one optional `z.unknown()` field per
 * `pass` key (trimmed, empties skipped) — the pass-down variables the node
 * merges into every pick. Unknown keys fail the contract: the pick payload is
 * built by this node itself, so anything else is a bug, not agent noise.
 * Pass fields are optional: evalPass omits a mapping whose expression resolved
 * to undefined, and the manual hold publishes before any mapping ran.
 */
export const decisionOutputContract = (def: DecisionDef): z.ZodType<Record<string, unknown>> => {
  const passFields: Record<string, z.ZodTypeAny> = {};
  for (const field of Object.keys(def.pass ?? {})) {
    const key = field.trim();
    if (key) passFields[key] = z.unknown().optional();
  }
  return z.object({
    chosen: z.array(z.string()),
    rationale: z.string().optional(),
    ...passFields,
  }) as unknown as z.ZodType<Record<string, unknown>>;
};

/**
 * The agent-source response contract (step 05): `{"choice","rationale"}` —
 * the shape the prompt's generated directive advertises and the pipeline
 * validates (the agent's error envelope is recognized by the shared
 * validator). The label membership check is the def's semantic gate (exact
 * match only — no case-insensitive salvage).
 */
export const DecisionAgentChoice = z.object({
  choice: z.string().min(1),
  rationale: z.string().optional(),
});
export type DecisionAgentChoice = z.infer<typeof DecisionAgentChoice>;

/** The JSON Schema the decision prompt's directive advertises — generated
 *  from the contract the pipeline validates against (byte-identical pair). */
export const DECISION_CHOICE_JSON_SCHEMA: unknown = z.toJSONSchema(DecisionAgentChoice);

/**
 * The per-run model override an agent-source decision accepts (prompt audit
 * #11 — the same override every other agent kind honors): a non-empty
 * trimmed string from the loose run record, else null. Parsed, not cast —
 * `DecisionRunInput` is a loose record.
 */
export const decisionModelOverride = (rawInput: Record<string, unknown>): string | null => {
  const parsed = z.string().trim().min(1).safeParse(rawInput.model);
  return parsed.success ? parsed.data : null;
};

