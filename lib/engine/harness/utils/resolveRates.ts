import type { PricingEntry } from "../../ports/agentPort";
import type { PricingSource } from "../pricingSource";

/**
 * The effective rate card for a model: the remote source table with the
 * running vendor's `rateOverrides` merged on top, and the `pricing` setting
 * winning over it (exact model id, then the setting's own `"*"`/`"default"`
 * wildcard, then the merged table's longest-prefix entry).
 */
export const resolveRates = (
  model: string | undefined,
  pricing: Record<string, PricingEntry>,
  source: PricingSource,
  table: Record<string, PricingEntry>,
): PricingEntry => {
  const exact = model ? pricing[model] : undefined;
  return exact ?? pricing["*"] ?? pricing.default ?? source.entryFor(model, table);
};

/** The effective source table: the fetched remote table with the vendor's
 *  `rateOverrides` merged on top (overrides win). */
export const rateTable = async (
  source: PricingSource,
  overrides: Record<string, PricingEntry> | undefined,
): Promise<Record<string, PricingEntry>> => {
  const remote = await source.entries();
  return overrides ? { ...remote, ...overrides } : remote;
};
