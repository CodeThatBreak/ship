import { afterEach, describe, expect, it, vi } from "vitest";

const getRunMock = vi.fn();
const waitMock = vi.fn();

vi.mock("./cursor/credentials", () => ({
  cursorCredentials: {
    apiKey: () => "test-key",
    isStored: () => true,
  },
}));

vi.mock("@cursor/sdk", () => ({
  Agent: {
    getRun: getRunMock,
  },
  Cursor: { models: { list: vi.fn() } },
}));

const { CursorAgentService } = await import("./cursorSdk");
const { AgentRunLookupError } = await import("../engine/ports/agent-errors");

describe("CursorAgentService.getRun", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns unavailable with AgentRunLookupError when the SDK throws", async () => {
    getRunMock.mockRejectedValueOnce(new Error("401 unauthorized"));

    const svc = new CursorAgentService();
    const query = await svc.getRun("bc-agent", "run-1");

    expect(query).toEqual({
      state: "unavailable",
      error: expect.any(AgentRunLookupError),
    });
    if (query.state !== "unavailable") throw new Error("expected unavailable");
    expect(query.error.message).toContain("401 unauthorized");
    expect(query.error.runId).toBe("run-1");
  });

  it("returns running when the cloud run is still in flight", async () => {
    getRunMock.mockResolvedValueOnce({ status: "running", wait: waitMock });

    const svc = new CursorAgentService();
    await expect(svc.getRun("bc-agent", "run-2")).resolves.toEqual({ state: "running" });
  });
});

describe("CursorAgentService.pumpRun", () => {
  it("swallows a late wait() rejection when stream() throws", async () => {
    const doneReject = vi.fn();
    const run = {
      wait: () =>
        new Promise((_resolve, reject) => {
          doneReject.mockImplementation(reject);
          setTimeout(() => reject(new Error("wait failed")), 5);
        }),
      stream: async function* () {
        throw new Error("stream blew up");
      },
    };

    const svc = new CursorAgentService();
    await expect(svc.pumpRun(run as never)).rejects.toThrow("stream blew up");
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("CursorAgentService.releaseRun", () => {
  it("releaseRun is idempotent", () => {
    const svc = new CursorAgentService();
    expect(() => svc.releaseRun("missing")).not.toThrow();
  });
});
