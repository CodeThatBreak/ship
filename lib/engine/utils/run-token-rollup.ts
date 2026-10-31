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
  if (r.cost_cents != null) bucket.totalCents += r.cost_cents;
  bucket.tokens += uncachedInputTokens({
    inputTokens: r.input_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
  })
    + (r.output_tokens ?? 0)
    + (r.cache_read_tokens ?? 0)
    + (r.cache_write_tokens ?? 0);
  bucket.runs.push(r);
};
