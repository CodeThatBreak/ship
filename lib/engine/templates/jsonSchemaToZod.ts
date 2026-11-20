import "server-only";

import { z } from "zod";
import { convertJsonSchemaToZod } from "zod-from-json-schema";

/**
 * The JSON-Schema → Zod boundary (step 04): template-authored `output_schema`
 * configs stay JSON Schema (the authoring format the TS-lite editor and the
 * YAML templates publish); the Zod contract is converted ONCE at config load
 * and cached on the def instance (the declarative def cache holds instances).
 *
 * Unsupported JSON Schema keywords are a LOUD load-time error on the template
 * — never a silent pass-through (the step-04 risk rule). The alternative
 * (forcing template authors to write TS) was rejected in the step doc.
 */
export const jsonSchemaToZod = (schema: unknown, label: string): z.ZodType<Record<string, unknown>> => {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${label}: invalid output schema — a JSON Schema object is required`);
  }
  try {
    const converted = convertJsonSchemaToZod(schema as Parameters<typeof convertJsonSchemaToZod>[0]);
    if (!converted || typeof (converted as { safeParse?: unknown }).safeParse !== "function") {
      throw new Error("the conversion produced no validator");
    }
    return converted as unknown as z.ZodType<Record<string, unknown>>;
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: output schema could not be converted to a validator — ${reason}`);
  }
};
