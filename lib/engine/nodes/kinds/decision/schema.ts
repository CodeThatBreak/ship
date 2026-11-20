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
