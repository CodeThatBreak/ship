import { uncachedInputTokens } from "../../../usage";
import type { PricingEntry } from "../../ports/agentPort";

/**
 * Cost of a token payload at list price minus the given discount fraction
 * (the running port's `listDiscount` — a vendor billing-agreement fact), in
 * cents.
 */
/** See lib/usage.ts — uncached portion of a prompt-total input count. */
export const estimateCostCents = (
  usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  rates: PricingEntry,
  discount = 0,
): { cents: number; model?: string } => {
  const per = (v?: number, rate?: number) => ((v ?? 0) * (rate ?? 0)) / 1_000_000 * 100;
  const cents =
    (per(uncachedInputTokens(usage), rates.input_per_mtok) +
      per(usage.outputTokens, rates.output_per_mtok) +
      per(usage.cacheReadTokens, rates.cache_read_per_mtok) +
      per(usage.cacheWriteTokens, rates.cache_write_per_mtok)) *
    (1 - discount);
  return { cents: Math.round(cents * 100) / 100, model: usage.model };
};

/** Best billed figure for an entry: only > $0 counts. All-zero billed data
 *  (plan-included / BYOK usage reports $0 charged) is "reporting exists but
 *  no charge", which is useless for display — callers fall back to estimates. */
export const billedCents = (cost?: { rawCostCents?: number; chargedCents?: number }): number | null => {
  if (!cost) return null;
  if ((cost.chargedCents ?? 0) > 0) return cost.chargedCents ?? null;
  if ((cost.rawCostCents ?? 0) > 0) return cost.rawCostCents ?? null;
  return null;
};
