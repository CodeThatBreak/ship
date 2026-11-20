import "server-only";

/** Token-usage and cost summary captured for one finished run. */
export interface RunCostSummary {
  durationMs?: number;
  tokens?: number;
  costCents?: number;
  estimated?: boolean;
  model?: string;
}
