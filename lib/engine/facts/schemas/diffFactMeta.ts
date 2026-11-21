import "server-only";

import { z } from "zod";
import { DIFF_ALT_PROJECTION, DIFF_ATTRIBUTION, DIFF_FACT_META } from "../constants/diffFactMeta";

/**
 * The `diff` fact's artifact-meta shape as the engine READS it back (Task
 * 08) — the reader half of the `DIFF_FACT_META` vocabulary the FactStore
 * writes. The refresh service parses a stored diff artifact's meta through
 * this schema before it re-captures; anything that doesn't parse (a
 * pre-Task-08 artifact without a branch key, or corrupt JSONB) reads as null
 * and the caller fails loudly instead of guessing.
 */
export const diffFactMetaSchema = z.object({
  [DIFF_FACT_META.BRANCH]: z.string().min(1),
  [DIFF_FACT_META.STAT]: z.string().default(""),
  [DIFF_FACT_META.BASE_SHA]: z.string().min(1).optional(),
  [DIFF_FACT_META.HEAD_SHA]: z.string().min(1).optional(),
  [DIFF_FACT_META.ATTRIBUTION]: z
    .enum([DIFF_ATTRIBUTION.AGENT, DIFF_ATTRIBUTION.ALL])
    .default(DIFF_ATTRIBUTION.ALL),
  [DIFF_FACT_META.UNCOMMITTED]: z.literal(true).optional(),
  [DIFF_FACT_META.ALT]: z
    .object({
      [DIFF_ALT_PROJECTION.ATTRIBUTION]: z.enum([DIFF_ATTRIBUTION.AGENT, DIFF_ATTRIBUTION.ALL]),
      [DIFF_ALT_PROJECTION.STAT]: z.string().default(""),
      [DIFF_ALT_PROJECTION.RAW]: z.string(),
    })
    .optional(),
});

export type DiffFactMeta = z.infer<typeof diffFactMetaSchema>;

/** Parse a stored diff artifact's meta; null when it is not a readable diff fact. */
export const parseDiffFactMeta = (meta: unknown): DiffFactMeta | null => {
  const parsed = diffFactMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
};