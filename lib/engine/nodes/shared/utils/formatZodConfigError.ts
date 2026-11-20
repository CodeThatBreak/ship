import "server-only";

import { z } from "zod";

/** The typed config-violation error `parseRunConfig` throws: the offending
 *  knob path prefixed with the node (or instance) key. Extracted from
 *  `nodeDefinition.ts` (step 08) — a class file exports only its class. */
export const formatZodConfigError = (nodeKey: string, error: z.ZodError): Error => {
  const first = error.issues[0];
  if (!first) return new Error(`invalid config for ${nodeKey}`);
  const at = first.path.length ? `${nodeKey}.${first.path.join(".")}` : nodeKey;
  return new Error(`invalid config for ${at}: ${first.message}`);
};
