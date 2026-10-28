import "server-only";

import type { PricingEntry } from "../../engine/ports/agent-port";

/**
 * Cursor's pricing facts for the engine's token-based cost estimator:
 * the plan discount (`listDiscount`) and the rate-card corrections
 * (`rateOverrides`) the port surfaces as {@link AgentPort} vendor facts.
 */

/** Cursor Enterprise billing runs at 7% off the published list prices.
 *  Applied to our token-based cost estimate; billed charges from the usage
 *  API are used as-is (Cursor discounts them at billing time already). */
export const CURSOR_LIST_DISCOUNT = 0.07;

/**
 * List-price entries the public pricing table (PricingSource / LiteLLM)
 * doesn't track: Cursor's own models and its internal Grok reporting keys,
 * USD per Mtok — source: https://cursor.com/docs/models-and-pricing.
 * Fast-mode surcharges are not modeled — the base rates apply.
 */
export const CURSOR_RATE_OVERRIDES: Record<string, PricingEntry> = {
  "composer-2.5": { input_per_mtok: 0.5, output_per_mtok: 2.5, cache_read_per_mtok: 0.2 },
  "grok-4": { input_per_mtok: 2, output_per_mtok: 6, cache_read_per_mtok: 0.5 },
};
