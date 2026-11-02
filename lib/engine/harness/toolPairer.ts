import "server-only";

// ── tool-call pairing for local mode (FIFO unmatched-start per name) ─────────

export type ToolEmitFn = (
  name: string,
  status: string,
  callId: string,
  args?: unknown,
  result?: string,
  startedAt?: number
) => void;

/** Serialize a tool result payload (unknown per the SDK) to display text. */
function asResultText(v: unknown): string | undefined {
  if (v == null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * Pairs tool-call start/end events for local runs: matches by callId when
 * present, otherwise FIFO per tool name; synthesizes ids for unpaired ends.
 */
export class ToolPairer {
  private unmatched = new Map<string, { callId: string; startedAt: number }[]>();
  private seq = 0;

  constructor(private readonly emit: ToolEmitFn) {}

  handle(name: string, status: string, args?: unknown, callId?: string, extra?: { result?: unknown }): void {
    const resultText = asResultText(extra?.result);
    const isEnd = /complete|finish|success|fail|error|result|end/i.test(status) && !/start|begin|call|invok/i.test(status);
    if (isEnd) {
      const q = this.unmatched.get(name);
      if (callId) {
        const q2 = this.unmatched.get(name) ?? [];
        const idx = q2.findIndex((p) => p.callId === callId);
        const start = idx >= 0 ? q2.splice(idx, 1)[0] : undefined;
        if (q2.length) this.unmatched.set(name, q2); else this.unmatched.delete(name);
        this.emit(name, status, callId, args, resultText, start?.startedAt);
        return;
      }
      if (q?.length) {
        const start = q.shift();
        if (!start) return;
        if (!q.length) this.unmatched.delete(name);
        this.emit(name, status, start.callId, args, resultText, start.startedAt);
        return;
      }
      this.emit(name, status, callId ?? `${name}_${++this.seq}`, args, resultText);
    } else {
      const id = callId ?? `${name}_${++this.seq}`;
      const q = this.unmatched.get(name) ?? [];
      q.push({ callId: id, startedAt: Date.now() });
      this.unmatched.set(name, q);
      this.emit(name, status, id, args);
    }
  }
}
