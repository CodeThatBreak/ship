import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AgentOptions, Run, SDKAgent } from "@cursor/sdk";
import { runAgentHostChild, type AgentHostChildPort, type AgentHostChildSdk } from "./agentHostChild";
import { AGENT_HOST_MESSAGE_KINDS } from "./constants/agentHostMessageKinds";
import type { AgentHostChildMessage } from "./types/agentHostProtocol";

const REAL_DIR = os.tmpdir();

const START = {
  kind: AGENT_HOST_MESSAGE_KINDS.START,
  apiKey: "key-1",
  cwd: REAL_DIR,
  prompt: "do the thing",
  mode: "agent" as const,
  name: "node run",
  model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
  sandbox: true,
  force: false,
};

const makePort = () => {
  const posted: AgentHostChildMessage[] = [];
  let exitCode: number | null = null;
  const handlers: { parent?: (raw: unknown) => void; disconnect?: () => void } = {};
  const port: AgentHostChildPort = {
    post: (message) => posted.push(message),
    onParentMessage: (handler) => {
      handlers.parent = handler;
    },
    onDisconnect: (handler) => {
      handlers.disconnect = handler;
    },
    exit: (code) => {
      exitCode = code;
    },
  };
  return { port, posted, exitCode: () => exitCode, handlers };
};

const makeSdk = (run: Run) => {
  const agent = {
    agentId: "agent-1",
    send: vi.fn().mockResolvedValue(run),
    close: vi.fn(),
  } as unknown as SDKAgent;
  const create = vi.fn().mockResolvedValue(agent);
  const resume = vi.fn();
  const sdk: AgentHostChildSdk = {
    create: (opts: AgentOptions) => create(opts),
    resume: (agentId: string, opts: Partial<AgentOptions>) => resume(agentId, opts),
  };
  return { sdk, create, resume, send: agent.send as unknown as ReturnType<typeof vi.fn>, close: agent.close };
};

/** A scripted fake run: yields `messages`, then ends and resolves `result`. */
const makeRun = (messages: unknown[], result: Record<string, unknown>, gate?: Promise<void>) =>
  ({
    id: "run-1",
    wait: () => Promise.resolve(result),
    cancel: vi.fn(() => Promise.resolve()),
    stream: async function* () {
      for (const m of messages) {
        yield m as never;
      }
      if (gate) await gate;
    },
  }) as unknown as Run;

describe("runAgentHostChild", () => {
  it("happy path: posts started first, then events (RUNNING + SDK messages), result, closes the agent, exits 0", async () => {
    const run = makeRun(
      [
        { type: "status", status: "tool_running" },
        { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
        { type: "tool_call", name: "shell", status: "completed", args: { cmd: "ls" }, call_id: "c1" },
      ],
      { id: "run-1", status: "finished", result: "done" },
    );
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk, close, send } = makeSdk(run);

    runAgentHostChild(port, sdk);
    handlers.parent?.(START);
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());

    expect(send).toHaveBeenCalledWith(
      "do the thing",
      expect.objectContaining({ mode: "agent", model: START.model }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(exitCode()).toBe(0);
    expect(posted[0]?.kind).toBe(AGENT_HOST_MESSAGE_KINDS.STARTED); // ordering invariant
    const kinds = posted.map((m) => m.kind);
    expect(kinds).toEqual([
      AGENT_HOST_MESSAGE_KINDS.STARTED,
      AGENT_HOST_MESSAGE_KINDS.EVENT, // RUNNING
      AGENT_HOST_MESSAGE_KINDS.EVENT, // tool_running
      AGENT_HOST_MESSAGE_KINDS.EVENT, // assistant hello
      AGENT_HOST_MESSAGE_KINDS.EVENT, // tool_call
      AGENT_HOST_MESSAGE_KINDS.RESULT,
    ]);
    const resultMsg = posted.at(-1);
    if (resultMsg?.kind !== AGENT_HOST_MESSAGE_KINDS.RESULT) throw new Error("expected result");
    expect(resultMsg.result.status).toBe("finished");
  });

  it("fails before started when the cwd does not exist: posts error, exits 1, never creates the agent", async () => {
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk, create } = makeSdk(makeRun([], { id: "r", status: "finished" }));

    runAgentHostChild(port, sdk);
    handlers.parent?.({ ...START, cwd: "/definitely/not/a-real-dir-xyz" });
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());

    expect(create).not.toHaveBeenCalled();
    expect(exitCode()).toBe(1);
    const last = posted.at(-1);
    if (last?.kind !== AGENT_HOST_MESSAGE_KINDS.ERROR) throw new Error("expected error");
    expect(last.message).toMatch(/does not exist/);
  });

  it("stream failure after started: posts error and exits 1, closes the agent", async () => {
    const run = {
      id: "run-1",
      wait: () => new Promise<never>(() => {}),
      cancel: vi.fn(() => Promise.resolve()),
      stream: async function* () {
        throw new Error("stream blew up");
      },
    } as unknown as Run;
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk, close } = makeSdk(run);

    runAgentHostChild(port, sdk);
    handlers.parent?.(START);
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());

    expect(posted[0]?.kind).toBe(AGENT_HOST_MESSAGE_KINDS.STARTED);
    const last = posted.at(-1);
    if (last?.kind !== AGENT_HOST_MESSAGE_KINDS.ERROR) throw new Error("expected error");
    expect(last.message).toBe("stream blew up");
    expect(close).toHaveBeenCalledTimes(1);
    expect(exitCode()).toBe(1);
  });

  it("cancel cancels the in-flight run; the run then finishes with its result", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = makeRun([], { id: "run-1", status: "cancelled" }, gate);
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk } = makeSdk(run);

    runAgentHostChild(port, sdk);
    handlers.parent?.(START);
    await vi.waitFor(() =>
      expect(posted.some((m) => m.kind === AGENT_HOST_MESSAGE_KINDS.STARTED)).toBe(true),
    );

    handlers.parent?.({ kind: AGENT_HOST_MESSAGE_KINDS.CANCEL });
    expect(run.cancel).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());
    expect(posted.at(-1)?.kind).toBe(AGENT_HOST_MESSAGE_KINDS.RESULT);
    expect(exitCode()).toBe(0);
  });

  it("disconnect (parent died) cancels the run and exits 0 with no result", async () => {
    const run = makeRun([], { id: "run-1", status: "finished" }, new Promise(() => {}));
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk } = makeSdk(run);

    runAgentHostChild(port, sdk);
    handlers.parent?.(START);
    await vi.waitFor(() =>
      expect(posted.some((m) => m.kind === AGENT_HOST_MESSAGE_KINDS.STARTED)).toBe(true),
    );

    handlers.disconnect?.();
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => m.kind === AGENT_HOST_MESSAGE_KINDS.RESULT)).toBe(false);
    expect(exitCode()).toBe(0);
  });

  it("rejects a malformed parent message and a second start while a run is active", async () => {
    const run = makeRun([], { id: "run-1", status: "finished" }, new Promise(() => {}));
    const { port, posted, exitCode, handlers } = makePort();
    const { sdk } = makeSdk(run);

    runAgentHostChild(port, sdk);
    handlers.parent?.("not a message");
    await vi.waitFor(() => expect(exitCode()).not.toBeNull());
    expect(exitCode()).toBe(1);
    expect(posted.at(-1)?.kind).toBe(AGENT_HOST_MESSAGE_KINDS.ERROR);

    // fresh child for the second-start case
    const run2 = makeRun([], { id: "run-2", status: "finished" }, new Promise(() => {}));
    const second = makePort();
    const sdk2 = makeSdk(run2);
    runAgentHostChild(second.port, sdk2.sdk);
    second.handlers.parent?.(START);
    await vi.waitFor(() =>
      expect(second.posted.some((m) => m.kind === AGENT_HOST_MESSAGE_KINDS.STARTED)).toBe(true),
    );
    second.handlers.parent?.(START);
    await vi.waitFor(() => expect(second.exitCode()).not.toBeNull());
    expect(second.exitCode()).toBe(1);
    expect(second.posted.at(-1)?.kind).toBe(AGENT_HOST_MESSAGE_KINDS.ERROR);
  });

  it("resume path: start with resumeAgentId routes through sdk.resume with local options", async () => {
    const run = makeRun([], { id: "run-9", status: "finished" });
    const { port, posted, handlers } = makePort();
    const { sdk, resume, create } = makeSdk(run);
    vi.mocked(resume).mockResolvedValue({
      agentId: "agent-9",
      send: vi.fn().mockResolvedValue(run),
      close: vi.fn(),
    } as unknown as SDKAgent);

    runAgentHostChild(port, sdk);
    handlers.parent?.({ ...START, resumeAgentId: "agent-9", settingSources: ["project"] });
    await vi.waitFor(() =>
      expect(posted.some((m) => m.kind === AGENT_HOST_MESSAGE_KINDS.STARTED)).toBe(true),
    );

    expect(create).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(
      "agent-9",
      expect.objectContaining({
        apiKey: "key-1",
        local: { cwd: REAL_DIR, settingSources: ["project"] },
        model: START.model,
      }),
    );
    if (posted[0]?.kind !== AGENT_HOST_MESSAGE_KINDS.STARTED) throw new Error("expected started");
    expect(posted[0].agentId).toBe("agent-9");
  });
});
