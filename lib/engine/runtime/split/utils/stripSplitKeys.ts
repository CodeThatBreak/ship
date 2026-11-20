import "server-only";

import { SPLIT_CONFIG_KEYS } from "../constants/splitConfigKeys";

/** Strip the split knobs from a copied child config (pure): a child never
 *  splits — the nesting guard is the runtime rule, the strip is hygiene. */
export const stripSplitKeys = (cfg: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...cfg };
  for (const k of SPLIT_CONFIG_KEYS) delete out[k];
  return out;
};
