/** The `usage` artifact's stored JSON narrowed to what the renderer shows
 *  (Task 21). Mirrors the engine's `RunUsagePayload` — the client cannot
 *  import `lib/engine`, so the shape is restated here (the diffFactMeta
 *  precedent). Null when the content is not a usage payload or carries no
 *  usage facts at all (the renderer's empty state). */
export interface UsagePayloadView {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCents: number | null;
  estimated: boolean;
  durationMs: number | null;
}

const numOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const parseUsagePayload = (content: string): UsagePayloadView | null => {
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
  const costCents = o.costCents == null ? null : numOf(o.costCents);
  const model = typeof o.model === "string" && o.model ? o.model : undefined;
  const durationMs = o.durationMs == null ? null : numOf(o.durationMs);
  // no usage facts at all → the empty state, not a zeroed table
  if (model == null && !inputTokens && !outputTokens && !cacheReadTokens && !cacheWriteTokens && costCents == null) {
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
    durationMs,
  };
};
