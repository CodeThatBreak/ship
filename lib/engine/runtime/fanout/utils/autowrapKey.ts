import "server-only";

import crypto from "node:crypto";
import { stripFanoutKeys } from "../../../templates/nodeConfig";
import { FANOUT_AUTOWRAP_DESC_PREFIX } from "../constants/autowrap";

/** The auto-wrap template's dedup description: one hidden child template per
 *  (source template, node key, effective config) triple — a config change
 *  re-wraps, an unchanged one reuses the existing row. */
export const fanoutAutoWrapDescription = (
  sourceTemplateId: string,
  nodeKey: string,
  configHash: string,
): string => `${FANOUT_AUTOWRAP_DESC_PREFIX}${sourceTemplateId}:${nodeKey}:${configHash}`;

/** The config hash in the auto-wrap key: the fan-out knobs are stripped
 *  before hashing so a parallel_max change does not fork a new child
 *  template (the child runs the parent's config minus the fan-out knobs). */
export const hashFanoutChildConfig = (config: Record<string, unknown>): string =>
  crypto.createHash("sha256").update(JSON.stringify(stripFanoutKeys(config))).digest("hex").slice(0, 16);
