import "server-only";

import { db } from "../../db";

type TextBuf = {
  /** Uncapped accumulation before the first cap breach */
  content: string;
  head: string;
  tail: string;
  omitted: number;
  timer: NodeJS.Timeout | null;
};

/**
 * Buffers thinking/assistant deltas and flushes them to the event feed at a
 * fixed cadence, head/tail-capped, so long streams don't flood the DB.
 */
export class StreamBuffer {
  private static readonly FLUSH_MS = 1500;
  private static readonly THINKING_CAP = 4000;
  private static readonly ASSISTANT_CAP = 20000;

  private readonly bufs: Record<"thinking" | "assistant", TextBuf> = {
    thinking: { content: "", head: "", tail: "", omitted: 0, timer: null },
    assistant: { content: "", head: "", tail: "", omitted: 0, timer: null },
  };

  constructor(
    private readonly flowId: string,
    private readonly nodeId: string,
    private readonly runId: string
  ) {}

  private static capFor(kind: "thinking" | "assistant"): number {
    return kind === "thinking" ? StreamBuffer.THINKING_CAP : StreamBuffer.ASSISTANT_CAP;
  }

  private static appendDelta(b: TextBuf, delta: string, cap: number): void {
    if (b.omitted === 0) {
      b.content += delta;
      if (b.content.length <= cap) return;
      const headLen = Math.floor(cap / 2);
      const tailLen = cap - headLen;
      b.head = b.content.slice(0, headLen);
      b.tail = b.content.slice(-tailLen);
      b.omitted = b.content.length - cap;
      b.content = "";
      return;
    }
    b.omitted += delta.length;
    b.tail += delta;
    const total = b.head.length + b.tail.length;
    if (total > cap) {
      b.head = b.head.slice(total - cap);
    }
  }

  private static textOf(b: TextBuf): string {
    if (b.omitted === 0) return b.content;
    return (
      b.head +
      `\n… [${b.omitted.toLocaleString()} chars omitted] …\n` +
      b.tail
    );
  }

  private flush(kind: "thinking" | "assistant"): void {
    const b = this.bufs[kind];
    if (b.timer) {
      clearTimeout(b.timer);
      b.timer = null;
    }
    const text = StreamBuffer.textOf(b);
    b.content = "";
    b.head = "";
    b.tail = "";
    b.omitted = 0;
    if (!text) return;
    db.emitEvent(this.flowId, this.nodeId, kind, text, { run_id: this.runId });
  }

  push(kind: "thinking" | "assistant", delta: string): void {
    const b = this.bufs[kind];
    StreamBuffer.appendDelta(b, delta, StreamBuffer.capFor(kind));
    if (!b.timer) b.timer = setTimeout(() => this.flush(kind), StreamBuffer.FLUSH_MS);
  }

  /** Flush buffered text before a tool event so the feed stays in order. */
  flushBeforeTool(): void {
    this.flushAll();
  }

  flushAll(): void {
    this.flush("thinking");
    this.flush("assistant");
  }
}
