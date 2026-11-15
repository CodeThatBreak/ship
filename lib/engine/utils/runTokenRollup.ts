import "server-only";

import type { RunRow } from "../../db/rows";
import { uncachedInputTokens } from "../../usage";

export type RunTokenBucket = {
  totalCents: number;
  tokens: number;
  runs: RunRow[];
};

export const emptyRunTokenBucket = (): RunTokenBucket => ({
  totalCents: 0,
  tokens: 0,
  runs: [],
});

/** Fold one run row into a per-node or per-flow token/cost rollup. */
export const accumulateRunRow = (bucket: RunTokenBucket, r: RunRow): void => {
  if (r.costCents != null) bucket.totalCents += r.costCents;
  bucket.tokens += uncachedInputTokens({
    inputTokens: r.inputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
  })
    + (r.outputTokens ?? 0)
    + (r.cacheReadTokens ?? 0)
    + (r.cacheWriteTokens ?? 0);
  bucket.runs.push(r);
};
