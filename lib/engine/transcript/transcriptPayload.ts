import "server-only";

/**
 * The `transcript` artifact's payload (task 22, use case 8c): one agent run's
 * capped tool-call log — the calls the runner observed on the stream, each
 * reduced to name + status + duration + a REDACTED, truncated args preview.
 * Tool results are never recorded (they carry file contents and command
 * output); the capability token is masked everywhere it could echo through
 * args. Persisted as the artifact's `content` JSON so the client renderer
 * reads one shape (the RunUsagePayload precedent).
 */
export interface TranscriptCall {
  /** the tool name exactly as the runtime reported it */
  name: string;
  /** the terminal tool status ("completed", "failed", …) */
  status: string;
  /** start→end wall time when the runtime pairs the call (local runs) */
  durationMs?: number;
  /** the redacted, truncated args preview — absent when the call had none */
  summary?: string;
}

export interface TranscriptPayload {
  /** the capped call list, in arrival order */
  calls: TranscriptCall[];
  /** how many tool calls the run actually made (≥ calls.length when capped) */
  totalCalls: number;
  /** true when the run made more calls than the cap keeps */
  truncated: boolean;
}

/** A run transcript exists only when at least one tool call ran — a run with
 *  no tool calls establishes no artifact (the `hasRunUsage` precedent). */
export const hasTranscript = (payload?: TranscriptPayload): payload is TranscriptPayload =>
  (payload?.calls.length ?? 0) > 0;
