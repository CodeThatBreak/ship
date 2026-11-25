import { afterEach, describe, expect, it, vi } from "vitest";

const hostStream = vi.fn();
const hostCancel = vi.fn();

vi.mock("./host/hostPin", () => ({
  localAgentHost: {
    available: () => true,
    hasActiveRun: () => false,
    start: vi.fn().mockResolvedValue({ agentId: "agent-1", runId: "run-1" }),
    stream: (...args: unknown[]) => hostStream(...args),
    cancel: (...args: unknown[]) => hostCancel(...args),
    release: vi.fn(),
    inspect: vi.fn(),
    catalog: vi.fn(),
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
    hostStream.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    hostCancel.mockResolvedValue(true);

    const svc = new LocalAgentService({
      getSetting: async (_key, schema, fallback) => schema.parse(fallback),
    });
    vi.spyOn(svc, "defaults").mockResolvedValue({
      force: true,
      sandbox: false,
      timeoutMs: 30,
    });

    await expect(svc.streamRun("run-timeout")).rejects.toMatchObject({
      runId: "run-timeout",
      timeoutMs: 30,
      name: "AgentRunTimeoutError",
    });
    expect(hostCancel).toHaveBeenCalledWith("run-timeout");
  });

  it("maps host stream events onto the caller's callbacks", async () => {
    const onAssistant = vi.fn();
    const onTool = vi.fn();
    hostStream.mockImplementation(
      (_runId: string, onEvent: (e: unknown) => void) => {
        onEvent({ kind: "assistant", text: "hello" });
        onEvent({ kind: "tool", name: "shell", status: "start", callId: "c1" });
        return Promise.resolve({
          result: { status: "finished" },
          agentId: "agent-1",
          usage: null,
        });
      },
    );

    const svc = new LocalAgentService({
      getSetting: async (_key, schema, fallback) => schema.parse(fallback),
    });
    vi.spyOn(svc, "defaults").mockResolvedValue({
      force: true,
      sandbox: false,
      timeoutMs: 1_000,
    });

    const out = await svc.streamRun("run-1", { onAssistant, onTool });

    expect(onAssistant).toHaveBeenCalledWith("hello");
    expect(onTool).toHaveBeenCalledWith("shell", "start", undefined, "c1", {
      result: undefined,
      truncated: undefined,
    });
    expect(out.sessionId).toBe("agent-1");
    expect(out.result.status).toBe("finished");
  });
});
