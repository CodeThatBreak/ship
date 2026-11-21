import "server-only";

import type { UsageRollup, UsageRollupModel } from "../../../../../types/flow";

/** The `usage` artifact payload fields the rollup consumes — narrowed out of
 *  the artifact's stored JSON (tolerant: a malformed row prices as nothing).
 *  `parseUsagePayload` coerces every field, so the numbers are total. */
interface UsagePayloadLike {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number;
  estimated: boolean;
}

const numOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const strOf = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** Parse one stored artifact content into the payload shape — null when the
 *  row is not a usage payload or carries no usage facts at all (never
 *  throws; the rollup skips bad rows). */
export const parseUsagePayload = (content: string): UsagePayloadLike | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const inputTokens = numOf(o.inputTokens);
  const outputTokens = numOf(o.outputTokens);
  const cacheReadTokens = numOf(o.cacheReadTokens);
  const cacheWriteTokens = numOf(o.cacheWriteTokens);
  const costCents = numOf(o.costCents);
  const model = strOf(o.model);
  // no usage facts at all (a duration-only capture) → not a usage row
  if (model == null && !inputTokens && !outputTokens && !cacheReadTokens && !cacheWriteTokens && !costCents) {
    return null;
  }
  return {
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costCents,
    estimated: o.estimated === true,
  };
};

const emptyModel = (model: string): UsageRollupModel => ({
  model,
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  costCents: 0,
});

/**
 * Sum the flow's `usage` artifacts across runs (Task 21, use case 8d): every
 * stored version is one run's usage — a re-run supersedes nothing, it adds a
 * version — so the sum is the flow's true spend. Rows that are not usage
 * payloads are skipped. Null when no run established a usage artifact.
 */
export const sumUsageArtifacts = (contents: string[]): UsageRollup | null => {
  const rollup: UsageRollup = {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costCents: 0,
    estimatedRuns: 0,
    models: [],
  };
  const byModel = new Map<string, UsageRollupModel>();
  for (const content of contents) {
    const payload = parseUsagePayload(content);
    if (!payload) continue;
    const cache = payload.cacheReadTokens + payload.cacheWriteTokens;
    const modelKey = payload.model ?? "unknown";
    let entry = byModel.get(modelKey);
    if (!entry) {
      entry = emptyModel(modelKey);
      byModel.set(modelKey, entry);
      rollup.models.push(entry);
    }
    rollup.runs++;
    rollup.inputTokens += payload.inputTokens;
    rollup.outputTokens += payload.outputTokens;
    rollup.cacheTokens += cache;
    rollup.costCents += payload.costCents;
    if (payload.estimated) rollup.estimatedRuns++;
    entry.runs++;
    entry.inputTokens += payload.inputTokens;
    entry.outputTokens += payload.outputTokens;
    entry.cacheTokens += cache;
    entry.costCents += payload.costCents;
  }
  if (!rollup.runs) return null;
  return rollup;
};
