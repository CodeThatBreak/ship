import { db } from "../../../db";

/**
 * Buffers thinking/assistant deltas and flushes them to the event feed at a
 * fixed cadence, head/tail-capped, so long streams don't flood the DB.
 */
export class StreamBuffer {
  private static readonly FLUSH_MS = 1500;
  private static readonly THINKING_CAP = 4000;
  private static readonly ASSISTANT_CAP = 20000;

  private readonly bufs: Record<"thinking" | "assistant", { text: string; timer: NodeJS.Timeout | null }> = {
    thinking: { text: "", timer: null },
    assistant: { text: "", timer: null },
  };

  constructor(
    private readonly flowId: string,
    private readonly nodeId: string,
    private readonly runId: string
  ) {}

  private static capHeadTail(s: string, cap: number): string {
    if (s.length <= cap) return s;
    const head = Math.floor(cap / 2);
    const tail = cap - head;
    return s.slice(0, head) + `\n… [${(s.length - cap).toLocaleString()} chars omitted] …\n` + s.slice(-tail);
  }

  private flush(kind: "thinking" | "assistant"): void {
    const b = this.bufs[kind];
    if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    const text = b.text;
    b.text = "";
    if (!text) return;
    db.emitEvent(this.flowId, this.nodeId, kind, text, { run_id: this.runId });
  }

  push(kind: "thinking" | "assistant", delta: string): void {
    const b = this.bufs[kind];
    b.text = StreamBuffer.capHeadTail(
      b.text + delta,
      kind === "thinking" ? StreamBuffer.THINKING_CAP : StreamBuffer.ASSISTANT_CAP
    );
    if (!b.timer) b.timer = setTimeout(() => this.flush(kind), StreamBuffer.FLUSH_MS);
  }

  flushAll(): void {
    this.flush("thinking");
    this.flush("assistant");
  }
}
