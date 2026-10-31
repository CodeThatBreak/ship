import { describe, expect, it, vi, beforeEach } from "vitest";

const emitEvent = vi.fn();

vi.mock("../../db", () => ({
  db: { emitEvent },
}));

const { StreamBuffer } = await import("./stream-buffer");

describe("StreamBuffer cap accounting", () => {
  beforeEach(() => {
    emitEvent.mockClear();
  });

  it("reports total omitted characters after many pushes", () => {
    const buf = new StreamBuffer("flw_1", "node_1", "run_1");
    const chunk = "x".repeat(500);
    for (let i = 0; i < 50; i++) {
      buf.push("assistant", chunk);
    }
    buf.flushAll();
    expect(emitEvent).toHaveBeenCalled();
    const text = emitEvent.mock.calls[0]?.[3] as string;
    const omitted = 50 * 500 - 20_000;
    expect(text).toContain(`${omitted.toLocaleString()} chars omitted`);
  });

  it("flushes text before tool events when flushBeforeTool is called", () => {
    const buf = new StreamBuffer("flw_1", "node_1", "run_1");
    buf.push("assistant", "hello");
    buf.flushBeforeTool();
    expect(emitEvent).toHaveBeenCalledWith(
      "flw_1",
      "node_1",
      "assistant",
      "hello",
      { run_id: "run_1" },
    );
  });
});
