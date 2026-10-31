import { afterEach, describe, expect, it, vi } from "vitest";

const streamRun = vi.fn();
const cancelRun = vi.fn();

vi.mock("../cursorSdk", () => ({
  cursorAgent: {
    available: () => true,
    createRun: vi.fn().mockResolvedValue({ agentId: "agent-1", runId: "run-1" }),
    streamRun,
    cancelRun: (...args: unknown[]) => cancelRun(...args),
    hasActiveRun: () => false,
    releaseRun: vi.fn(),
    listModels: vi.fn(),
    listCatalog: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {
    getSetting: (key: string, fallback: unknown) =>
      key === "local_agent.timeout_ms" ? 30 : fallback,
  },
}));

const { LocalAgentService } = await import("./agent");

describe("LocalAgentService.streamRun timeout", () => {
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

    const svc = new LocalAgentService({
      getSetting: (_key, schema, fallback) => schema.parse(fallback),
    });
    vi.spyOn(svc, "defaults").mockReturnValue({
      force: true,
      sandbox: false,
      timeoutMs: 30,
    });
    await expect(svc.streamRun("run-timeout")).rejects.toMatchObject({
      runId: "run-timeout",
      timeoutMs: 30,
      name: "AgentRunTimeoutError",
    });
    expect(cancelRun).toHaveBeenCalledWith("run-timeout");
  });
});
