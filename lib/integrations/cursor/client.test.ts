import { afterEach, describe, expect, it, vi } from "vitest";

const cancelRun = vi.fn();
const getRun = vi.fn();
const reattachRun = vi.fn();
const pumpRun = vi.fn();
const hasActiveRun = vi.fn();

vi.mock("../cursorSdk", () => ({
  cursorAgent: {
    hasActiveRun,
    streamRun: vi.fn(),
    cancelRun,
    getRun,
    reattachRun,
    pumpRun,
  },
}));

const { CursorClient } = await import("./client");
const { AgentRunLookupError } = await import("../../engine/ports/agentErrors");

describe("CursorClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("propagates cancelRun boolean from the SDK service", async () => {
    cancelRun.mockResolvedValueOnce(false);
    cancelRun.mockResolvedValueOnce(true);

    const client = new CursorClient();
    await expect(client.cancelRun("bc-1", "run-1")).resolves.toBe(false);
    await expect(client.cancelRun("bc-1", "run-2")).resolves.toBe(true);
    expect(cancelRun).toHaveBeenCalledWith("run-1", "bc-1");
    expect(cancelRun).toHaveBeenCalledWith("run-2", "bc-1");
  });

  it("streamRun throws lookup errors instead of treating them as still running", async () => {
    hasActiveRun.mockReturnValue(false);
    reattachRun.mockResolvedValue(null);
    const lookupErr = new AgentRunLookupError("auth failed", "run-x", "bc-x");
    getRun.mockResolvedValue({ state: "unavailable", error: lookupErr });

    const client = new CursorClient();
    await expect(client.streamRun("bc-x", "run-x")).rejects.toBe(lookupErr);
  });
});
