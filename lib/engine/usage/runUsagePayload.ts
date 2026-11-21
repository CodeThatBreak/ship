import "server-only";

import type { RunCostSummary } from "../harness/types/runCostSummary";

/**
 * The `usage` artifact's payload (Task 21, use case 8d): one finished run's
 * token/cost facts — the `AgentRunUsage` the run's port reported, the cost
 * priced at capture time, and the run duration. Persisted as the artifact's
 * `content` JSON so the renderer and the flow-header rollup read one shape.
 * All fields optional — a port may report any subset; a run with no usage at
 * all establishes no artifact (`hasRunUsage`).
 */
export interface RunUsagePayload {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** cents, as priced by the usage capture (billed or estimated) */
  costCents?: number;
  /** the cost came from the rate-card estimate, not a billed charge */
  estimated?: boolean;
  durationMs?: number;
}

/** A summary carries usage facts when any token or cost figure is present —
 * a duration-only capture (the `!u` path) establishes no artifact. Undefined
 * (a run result that reported no summary at all) carries none either. */
export const hasRunUsage = (
  summary?: RunCostSummary,
): summary is RunCostSummary =>
  summary?.inputTokens != null
  || summary?.outputTokens != null
  || summary?.cacheReadTokens != null
  || summary?.cacheWriteTokens != null
  || summary?.costCents != null;

/** Map the capture's summary onto the artifact payload (undefined fields
 * stay absent — the persisted JSON carries only what the run reported). */
export const runUsagePayload = (summary: RunCostSummary): RunUsagePayload => ({
  ...(summary.model ? { model: summary.model } : {}),
  ...(summary.inputTokens != null ? { inputTokens: summary.inputTokens } : {}),
  ...(summary.outputTokens != null ? { outputTokens: summary.outputTokens } : {}),
  ...(summary.cacheReadTokens != null ? { cacheReadTokens: summary.cacheReadTokens } : {}),
  ...(summary.cacheWriteTokens != null ? { cacheWriteTokens: summary.cacheWriteTokens } : {}),
  ...(summary.costCents != null ? { costCents: summary.costCents } : {}),
  ...(summary.estimated ? { estimated: true } : {}),
  ...(summary.durationMs != null ? { durationMs: summary.durationMs } : {}),
});
