/**
 * Token-usage semantics shared by the server (cost estimation) and the client
 * (cost/tooltip breakdown). Deliberately dependency-free so browser bundles
 * can import it without dragging in the SQLite/engine layer.
 */

/**
 * Cursor's local-run `TokenUsage` reports `inputTokens` as the full prompt with
 * cache reads/writes as a subset, while the usage/billing API breaks the same
 * prompt up as uncached input + separate cache volumes (there, cacheRead is
 * NOT part of input). Pricing the input rate on tokens already billed as cache
 * reads inflates cost ~3x (e.g. agent 2715a6b6: one run estimated at 205.77¢
 * vs ~63¢ actually billed — Cursor's usage API reports 68.54¢ for the agent).
 * Detect the overlap — `cache ≤ input` only holds under prompt-total semantics
 * (true for every local row; API rows have cache > uncached input) — and
 * return just the uncached portion, which is what `input_per_mtok` prices.
 */
export function uncachedInputTokens(u: {
  inputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): number {
  const input = u.inputTokens ?? 0;
  const cached = (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  return input >= cached && cached > 0 ? input - cached : input;
}
