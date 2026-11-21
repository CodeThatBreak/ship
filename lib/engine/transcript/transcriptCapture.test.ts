import { describe, expect, it } from "vitest";

import { TOKEN_MASK } from "../agentTools/utils/toolsPromptBlock";
import { TRANSCRIPT_CALL_CAP, TRANSCRIPT_SUMMARY_CAP } from "./constants/transcriptCaps";
import { TranscriptCapture } from "./transcriptCapture";

const TOKEN = "tok_capability_9f8e7d6c";

describe("TranscriptCapture (task 22 — the capped tool-call log)", () => {
  it("records terminal tool emits only — start-ish statuses stay out", () => {
    const capture = new TranscriptCapture(null);
    capture.observe("Bash", "started", { command: "npm test" });
    capture.observe("Bash", "running", { command: "npm test" });
    capture.observe("Bash", "completed", { command: "npm test" }, 1000);

    expect(capture.payload()).toEqual({
      calls: [{ name: "Bash", status: "completed", durationMs: expect.any(Number), summary: '{"command":"npm test"}' }],
      totalCalls: 1,
      truncated: false,
    });
  });

  it("redacts the capability token out of the args summary", () => {
    const capture = new TranscriptCapture(TOKEN);
    capture.observe("create_change_request", "completed", {
      authorization: `Bearer ${TOKEN}`,
      title: "Open the MR",
    });

    const payload = capture.payload();
    const summary = payload?.calls[0]?.summary ?? "";
    expect(summary).toContain(TOKEN_MASK);
    expect(summary).not.toContain(TOKEN);
  });

  it("truncates the args summary to the cap", () => {
    const capture = new TranscriptCapture(null);
    capture.observe("Bash", "completed", { command: "x".repeat(TRANSCRIPT_SUMMARY_CAP + 500) });

    const summary = capture.payload()?.calls[0]?.summary ?? "";
    expect(summary.length).toBe(TRANSCRIPT_SUMMARY_CAP + 1); // the ellipsis
    expect(summary.endsWith("…")).toBe(true);
  });

  it("caps the call list and reports the true count", () => {
    const capture = new TranscriptCapture(null);
    for (let i = 0; i < TRANSCRIPT_CALL_CAP + 7; i += 1) {
      capture.observe(`tool_${i}`, "completed", { i });
    }

    const payload = capture.payload();
    expect(payload?.calls).toHaveLength(TRANSCRIPT_CALL_CAP);
    expect(payload?.totalCalls).toBe(TRANSCRIPT_CALL_CAP + 7);
    expect(payload?.truncated).toBe(true);
    // the FIRST calls survive the cap, in arrival order
    expect(payload?.calls[0]?.name).toBe("tool_0");
  });

  it("payload is undefined for a run with no tool calls", () => {
    const capture = new TranscriptCapture(TOKEN);
    capture.observe("Bash", "started", { command: "npm test" });
    expect(capture.payload()).toBeUndefined();
  });

  it("survives unserializable args (no entry summary, no throw)", () => {
    const capture = new TranscriptCapture(null);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => capture.observe("Bash", "completed", circular)).not.toThrow();
    expect(capture.payload()?.calls[0]?.summary).toBeUndefined();
  });
});
