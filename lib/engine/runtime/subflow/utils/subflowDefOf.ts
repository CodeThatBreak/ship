import "server-only";

import { SubflowDefSchema, type SubflowDef } from "../../../nodes/schemas/declarativeSchemas";

/**
 * Parse a subflow node's layered config (class ← app ← flow snapshot) as the
 * declarative def — loud on a malformed config, never a silent skip. The
 * expansion gate and the terminal rollup both read through this one parser
 * so they can never disagree about what the node delegates to.
 */
export const subflowDefOf = (config: unknown, label: string): SubflowDef => {
  try {
    return SubflowDefSchema.parse(config ?? {});
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: invalid subflow config — ${msg}`);
  }
};
