import { afterEach, describe, expect, it, vi } from "vitest";

const streamRun = vi.fn();
const cancelRun = vi.fn();

vi.mock("./host/localAgentHost", () => ({
  // the pinned localAgentHost instance is built from this mock — the service's
  // run lifecycle calls land on these spies. A constructor that returns an
  // object (regular function, not an arrow) so `new LocalAgentHost()` works.
  LocalAgentHost: vi.fn(function mockLocalAgentHost() {
    return {
      createRun: vi.fn(),
      streamRun: (...args: unknown[]) => streamRun(...args),
      cancelRun: (...args: unknown[]) => cancelRun(...args),
      hasActiveRun: () => false,
      releaseRun: vi.fn(),
    };
  }),
}));

vi.mock("../../db", () => ({
  db: {
    getSetting: (key: string, fallback: unknown) =>
      key === "local_agent.timeout_ms" ? 30 : fallback,
  },
}));

const { LocalAgentService } = await import("./agent");

const makeService = (): InstanceType<typeof LocalAgentService> => {
  const svc = new LocalAgentService({
    getSetting: async (_key, schema, fallback) => schema.parse(fallback),
  });
  vi.spyOn(svc, "defaults").mockResolvedValue({
    force: true,
    sandbox: false,
    timeoutMs: 30,
  });
  return svc;
};

describe("LocalAgentService.streamRun", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cancels and rejects when the run exceeds local_agent.timeout_ms", async () => {
    streamRun.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    cancelRun.mockResolvedValue(true);

    const svc = makeService();
    await expect(svc.streamRun("run-timeout")).rejects.toMatchObject({
      runId: "run-timeout",
      timeoutMs: 30,
      name: "AgentRunTimeoutError",
    });
    expect(cancelRun).toHaveBeenCalledWith("run-timeout");
  });

  it("maps the host's outcome into LocalRunResult (sessionId from agentId, usage from the result)", async () => {
    streamRun.mockResolvedValueOnce({
      result: {
        id: "run-1",
        status: "finished",
        result: "done",
        durationMs: 100,
        model: { id: "composer-2.5" },
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 3 },
      },
      agentId: "agent-9",
    });

    const svc = makeService();
    const out = await svc.streamRun("run-1");
    expect(streamRun).toHaveBeenCalledWith("run-1", expect.anything());
    expect(out.result.status).toBe("finished");
    expect(out.sessionId).toBe("agent-9");
    expect(out.usage).toMatchObject({ inputTokens: 1, outputTokens: 2, durationMs: 100, model: "composer-2.5" });
  });
});
