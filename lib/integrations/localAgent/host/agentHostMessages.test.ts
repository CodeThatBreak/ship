import { describe, expect, it } from "vitest";
import { AGENT_HOST_MESSAGE_KINDS } from "./constants/agentHostMessageKinds";
import { parseAgentHostChildMessage, parseAgentHostParentMessage } from "./agentHostMessages";

const START = {
  kind: AGENT_HOST_MESSAGE_KINDS.START,
  apiKey: "key-1",
  cwd: "/repo",
  prompt: "do the thing",
  mode: "agent",
  name: "my node run",
  model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
  sandbox: false,
  force: true,
  resumeAgentId: "agent-abc",
  settingSources: ["project", "user"],
};

describe("agentHostMessages", () => {
  it("parses a valid start message", () => {
    const msg = parseAgentHostParentMessage(START);
    expect(msg.kind).toBe(AGENT_HOST_MESSAGE_KINDS.START);
    if (msg.kind !== AGENT_HOST_MESSAGE_KINDS.START) throw new Error("unreachable");
    expect(msg.model).toEqual({ id: "composer-2.5", params: [{ id: "fast", value: "false" }] });
    expect(msg.settingSources).toEqual(["project", "user"]);
  });

  it("parses a minimal start message and a cancel message", () => {
    const minimal = parseAgentHostParentMessage({
      kind: AGENT_HOST_MESSAGE_KINDS.START,
      apiKey: "key-1",
      cwd: "/repo",
      prompt: "p",
      sandbox: false,
      force: false,
    });
    if (minimal.kind !== AGENT_HOST_MESSAGE_KINDS.START) throw new Error("unreachable");
    expect(minimal.model).toBeUndefined();
    const cancel = parseAgentHostParentMessage({ kind: AGENT_HOST_MESSAGE_KINDS.CANCEL });
    expect(cancel.kind).toBe(AGENT_HOST_MESSAGE_KINDS.CANCEL);
  });

  it("rejects a malformed start message (missing required field, bad kind, bad setting source)", () => {
    expect(() => parseAgentHostParentMessage({ kind: AGENT_HOST_MESSAGE_KINDS.START, cwd: "/repo" })).toThrow(
      /invalid agent host parent-to-child message/,
    );
    expect(() =>
      parseAgentHostParentMessage({ ...START, sandbox: "yes" }),
    ).toThrow(/invalid agent host parent-to-child message/);
    expect(() => parseAgentHostParentMessage({ ...START, settingSources: ["bogus"] })).toThrow(
      /invalid agent host parent-to-child message/,
    );
    expect(() => parseAgentHostParentMessage({ kind: "bogus" })).toThrow(
      /invalid agent host parent-to-child message/,
    );
  });

  it("parses started/event/result/error child messages and passes unknown result fields through", () => {
    const started = parseAgentHostChildMessage({
      kind: AGENT_HOST_MESSAGE_KINDS.STARTED,
      agentId: "agent-1",
      runId: "run-1",
    });
    expect(started.kind).toBe(AGENT_HOST_MESSAGE_KINDS.STARTED);

    const event = parseAgentHostChildMessage({
      kind: AGENT_HOST_MESSAGE_KINDS.EVENT,
      event: { type: "tool", name: "shell", status: "completed", callId: "c1", result: "ok" },
    });
    expect(event.kind).toBe(AGENT_HOST_MESSAGE_KINDS.EVENT);

    const result = parseAgentHostChildMessage({
      kind: AGENT_HOST_MESSAGE_KINDS.RESULT,
      result: {
        id: "run-1",
        status: "finished",
        result: "all done",
        durationMs: 12_000,
        model: { id: "composer-2.5" },
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 30 },
        sdkOnlyField: { nested: true }, // unknown SDK fields pass through
      },
    });
    expect(result.kind).toBe(AGENT_HOST_MESSAGE_KINDS.RESULT);
    if (result.kind !== AGENT_HOST_MESSAGE_KINDS.RESULT) throw new Error("unreachable");
    expect(result.result.status).toBe("finished");
    // the loose result schema passes unknown SDK fields through untouched
    expect((result.result as unknown as Record<string, unknown>).sdkOnlyField).toEqual({ nested: true });

    const error = parseAgentHostChildMessage({ kind: AGENT_HOST_MESSAGE_KINDS.ERROR, message: "boom" });
    expect(error.kind).toBe(AGENT_HOST_MESSAGE_KINDS.ERROR);
  });

  it("rejects malformed child messages (missing fields, bad event shape)", () => {
    expect(() => parseAgentHostChildMessage({ kind: AGENT_HOST_MESSAGE_KINDS.STARTED, agentId: "agent-1" })).toThrow(
      /invalid agent host child-to-parent message/,
    );
    expect(() =>
      parseAgentHostChildMessage({ kind: AGENT_HOST_MESSAGE_KINDS.EVENT, event: { type: "assistant" } }),
    ).toThrow(/invalid agent host child-to-parent message/);
    expect(() =>
      parseAgentHostChildMessage({
        kind: AGENT_HOST_MESSAGE_KINDS.RESULT,
        result: { status: "finished" }, // missing required id
      }),
    ).toThrow(/invalid agent host child-to-parent message/);
    expect(() => parseAgentHostChildMessage("not an object")).toThrow(
      /invalid agent host child-to-parent message/,
    );
  });
});
