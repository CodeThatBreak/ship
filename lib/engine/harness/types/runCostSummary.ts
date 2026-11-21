import "server-only";

/** Token-usage and cost summary captured for one finished run. */
export interface RunCostSummary {
  durationMs?: number;
  tokens?: number;
  costCents?: number;
  estimated?: boolean;
  model?: string;
  /** the run's reported token split (Task 21 — the usage artifact's source) */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
