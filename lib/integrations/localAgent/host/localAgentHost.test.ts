import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHostExitError, AgentRunLookupError } from "../../../engine/ports/agentErrors";
import { UpstreamError } from "../../../errors";
import type { LocalAgentHostRunInput } from "./types/localAgentHostTypes";
import { LocalAgentHost } from "./localAgentHost";

const FIXTURE_TIMEOUT_MS = 30_000;

const fixtureChild = path.resolve(import.meta.dirname, "fixtures/agentHostFixtureChild.ts");
const workerTsconfig = path.resolve(import.meta.dirname, "../../../../worker/tsconfig.json");

const makeHost = (): LocalAgentHost =>
  new LocalAgentHost({
    childModulePath: fixtureChild,
    tsconfigPath: workerTsconfig,
    killGraceMs: 250,
  });

const makeInput = (overrides: Partial<LocalAgentHostRunInput> = {}): LocalAgentHostRunInput => ({
  prompt: "fixture prompt",
  cwd: process.cwd(),
  apiKey: "fixture-key",
  sandbox: true,
  force: false,
  ...overrides,
});

const makeCallbacks = () => {
  const events: { kind: string; text?: string; status?: string }[] = [];
  return {
    events,
    callbacks: {
      onStatus: (status: string) => events.push({ kind: "status", status }),
      onAssistant: (text: string) => events.push({ kind: "assistant", text }),
      onThinking: (text: string) => events.push({ kind: "thinking", text }),
    },
  };
};

const parseEcho = <T>(text: string | undefined): T => JSON.parse(text ?? "{}") as T;

describe("LocalAgentHost (fixture child)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    "start then stream: forwards the start payload, streams events, resolves on the result",
    async () => {
      const host = makeHost();
      const started = await host.createRun(
        makeInput({
          mode: "agent",
          model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
          settingSources: ["project"],
        }),
      );
      expect(started).toEqual({ agentId: "agent-fx", runId: "run-fx" });
      expect(host.hasActiveRun("run-fx")).toBe(true);

      const { events, callbacks } = makeCallbacks();
      const out = await host.streamRun("run-fx", callbacks);
      expect(out.result.status).toBe("finished");
      expect(out.result.result).toBe("default done");
      expect(out.result.durationMs).toBe(42);
      expect(out.agentId).toBe("agent-fx");

      const echo = parseEcho<{ prompt: string; model: unknown; sandbox: boolean; settingSources: unknown }>(
        events[0]?.text,
      );
      expect(echo.prompt).toBe("fixture prompt");
      expect(echo.model).toEqual({ id: "composer-2.5", params: [{ id: "fast", value: "false" }] });
      expect(echo.sandbox).toBe(true);
      expect(echo.settingSources).toEqual(["project"]);
      expect(events.some((e) => e.status === "RUNNING")).toBe(true);
      expect(events.some((e) => e.text === "hello from fixture")).toBe(true);
      // the handle is dropped once the stream settles (same as the in-process runtime)
      expect(host.hasActiveRun("run-fx")).toBe(false);
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "buffers events that arrive before streamRun attaches, and resolves a parked result",
    async () => {
      const host = makeHost();
      const started = await host.createRun(makeInput({ name: "finish-fast" }));
      // the fixture child has already finished (and exited) by now
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { events, callbacks } = makeCallbacks();
      const out = await host.streamRun(started.runId, callbacks);
      expect(events.map((e) => e.text)).toEqual(["buffered before attach"]);
      expect(out.result.status).toBe("finished");
      expect(out.result.result).toBe("fast done");
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "cancelRun delivers cancel and the run settles with its cancelled result",
    async () => {
      const host = makeHost();
      const started = await host.createRun(makeInput({ name: "wait-for-cancel" }));
      const { callbacks } = makeCallbacks();
      const stream = host.streamRun(started.runId, callbacks);
      expect(await host.cancelRun(started.runId)).toBe(true);
      const out = await stream;
      expect(out.result.status).toBe("cancelled");
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "a child crash without a result rejects streamRun with AgentHostExitError",
    async () => {
      const host = makeHost();
      const started = await host.createRun(makeInput({ name: "crash-mid-run" }));
      const { callbacks } = makeCallbacks();
      const error: AgentHostExitError = await host
        .streamRun(started.runId, callbacks)
        .then(() => {
          throw new Error("expected a rejection");
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(AgentHostExitError);
      expect(error.runId).toBe("run-fx");
      expect(error.exitCode).toBe(3);
      expect(host.hasActiveRun("run-fx")).toBe(false);
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "an error before `started` rejects createRun",
    async () => {
      const host = makeHost();
      const error: UpstreamError = await host
        .createRun(makeInput({ name: "error-before-started" }))
        .then(() => {
          throw new Error("expected a rejection");
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error.message).toBe("boom before start");
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "forks with a scrubbed env plus the run env (NODE_ENV=production case): the child sees no NODE_ENV, but does see DEVFLOW_AGENT_TOKEN",
    async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DEVFLOW_SECRETS_KEY", "server-key");
      const host = makeHost();
      const started = await host.createRun(
        makeInput({ name: "env-report", env: { DEVFLOW_AGENT_TOKEN: "run-token" } }),
      );
      const { events, callbacks } = makeCallbacks();
      const out = await host.streamRun(started.runId, callbacks);
      expect(out.result.status).toBe("finished");
      const env = parseEcho<Record<string, string | null>>(events[0]?.text);
      expect(env.NODE_ENV).toBeNull();
      expect(env.DEVFLOW_SECRETS_KEY).toBeNull();
      expect(env.DEVFLOW_AGENT_TOKEN).toBe("run-token");
      expect(env.TSX_TSCONFIG_PATH).toBe(workerTsconfig);
    },
    FIXTURE_TIMEOUT_MS,
  );

  it("unknown runs: streamRun throws AgentRunLookupError, cancelRun is false, releaseRun is a no-op", async () => {
    const host = makeHost();
    await expect(host.streamRun("nope")).rejects.toBeInstanceOf(AgentRunLookupError);
    await expect(host.cancelRun("nope")).resolves.toBe(false);
    expect(() => host.releaseRun("nope")).not.toThrow();
    expect(host.hasActiveRun("nope")).toBe(false);
  });
});
