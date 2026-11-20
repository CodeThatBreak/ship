import "server-only";

import { z } from "zod";
import { jsonSchemaToZod } from "../../../templates/jsonSchemaToZod";

/**
 * No declared input contract — the input is the previous node's output.
 * Loose: extra context fields pass through unenforced.
 */
export const ScriptRunInput = z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>;

/**
 * The script's REAL output contract (step 04 — nothing is published
 * unvalidated): a declared `output_schema` converts to Zod once at config
 * load; without one the contract is still "must be a JSON object" — but the
 * node only publishes `{}` when the script produced nothing (an output-bearing
 * script without a declared schema is an output-contract violation).
 */
export const scriptOutputContract = (outputSchema: unknown, label: string): z.ZodType<Record<string, unknown>> => {
  if (outputSchema && typeof outputSchema === "object") {
    return jsonSchemaToZod(outputSchema, label);
  }
  return z.record(z.string(), z.unknown()) as unknown as z.ZodType<Record<string, unknown>>;
};
