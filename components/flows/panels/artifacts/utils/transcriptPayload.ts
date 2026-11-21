/** The `transcript` artifact's stored JSON narrowed to what the renderer
 *  shows (task 22). Mirrors the engine's `TranscriptPayload` — the client
 *  cannot import `lib/engine`, so the shape is restated here (the
 *  usagePayload precedent). Null when the content is not a transcript
 *  payload or carries no calls at all (the renderer's fallback). */
export interface TranscriptCallView {
  name: string;
  status: string;
  durationMs: number | null;
  summary: string | null;
}

export interface TranscriptPayloadView {
  calls: TranscriptCallView[];
  totalCalls: number;
  truncated: boolean;
}

const strOf = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const numOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const callOf = (value: unknown): TranscriptCallView | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const name = strOf(o.name);
  if (name == null) return null;
  return {
    name,
    status: strOf(o.status) ?? "completed",
    durationMs: numOf(o.durationMs),
    summary: strOf(o.summary),
  };
};

export const parseTranscriptPayload = (content: string): TranscriptPayloadView | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.calls)) return null;
  const calls = o.calls.map(callOf).filter((c): c is TranscriptCallView => c != null);
  // no calls at all → the fallback, not an empty timeline
  if (calls.length === 0) return null;
  const total = numOf(o.totalCalls);
  return {
    calls,
    // the run's true count when the log was capped — never below what is shown
    totalCalls: total != null && total >= calls.length ? total : calls.length,
    truncated: o.truncated === true,
  };
};
