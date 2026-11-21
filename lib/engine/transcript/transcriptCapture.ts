import "server-only";

import { redactCapabilityToken } from "../agentTools/utils/toolsPromptBlock";
import { isToolCallEnd } from "../harness/utils/toolCallStatus";
import { TRANSCRIPT_CALL_CAP, TRANSCRIPT_SUMMARY_CAP } from "./constants/transcriptCaps";
import type { TranscriptCall, TranscriptPayload } from "./transcriptPayload";

/**
 * The run's tool-call collector (task 22, use case 8c): the AgentRunner feeds
 * every streamed tool emit through `observe`; only terminal emits become
 * entries, each reduced to name + status + duration + a REDACTED, truncated
 * args preview. The capability token is masked at record time (it can echo
 * through args on local runs, where the prompt carries it inline); tool
 * results are never recorded — they are the leak surface, and the transcript
 * is a call LOG, not a payload dump.
 *
 * One instance per run; `payload()` returns undefined for a run with no tool
 * calls (no artifact — the `hasRunUsage` precedent).
 */
export class TranscriptCapture {
  private readonly calls: TranscriptCall[] = [];

  constructor(private readonly redactToken: string | null) {}

  /** Observe one streamed tool emit; terminal statuses record an entry. */
  observe(name: string, status: string, args?: unknown, startedAtMs?: number): void {
    if (!isToolCallEnd(status)) return;
    this.calls.push({
      name,
      status,
      ...(startedAtMs != null ? { durationMs: Math.max(0, Date.now() - startedAtMs) } : {}),
      ...this.summaryOf(args),
    });
  }

  /** The capped payload, or undefined when the run made no tool calls. */
  payload(): TranscriptPayload | undefined {
    if (this.calls.length === 0) return undefined;
    const truncated = this.calls.length > TRANSCRIPT_CALL_CAP;
    return {
      calls: truncated ? this.calls.slice(0, TRANSCRIPT_CALL_CAP) : this.calls,
      totalCalls: this.calls.length,
      truncated,
    };
  }

  /** The redacted args preview: a truncated JSON stringify with every
   *  occurrence of the capability token masked (undefined for calls without
   *  args, and for args that cannot serialize). */
  private summaryOf(args: unknown): { summary?: string } {
    if (args == null) return {};
    let raw: string;
    try {
      raw = JSON.stringify(args);
    } catch {
      return {};
    }
    if (raw == null) return {};
    const preview = raw.length > TRANSCRIPT_SUMMARY_CAP ? `${raw.slice(0, TRANSCRIPT_SUMMARY_CAP)}…` : raw;
    const redacted = redactCapabilityToken(preview, this.redactToken);
    return redacted ? { summary: redacted } : {};
  }
}
