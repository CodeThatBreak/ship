import "server-only";

import fs from "node:fs";
import type { AgentOptions, Run, SDKAgent } from "@cursor/sdk";
import { dispatchSdkMessage, type StreamCallbacks } from "../../utils/sdkMessageDispatch";
import { parseAgentHostParentMessage } from "./agentHostMessages";
import { AGENT_HOST_MESSAGE_KINDS } from "./constants/agentHostMessageKinds";
import type {
  AgentHostChildMessage,
  AgentHostParentMessage,
  AgentHostStartMessage,
} from "./types/agentHostProtocol";

/** How long a disconnecting child waits for `run.cancel()` before exiting. */
const DISCONNECT_EXIT_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * What the child needs from its host process. Injected so the loop is
 * testable without forking; `worker/agentHost/main.ts` wires the real
 * `process.send`/`process.on("message")`/`process.exit` adapters.
 */
export interface AgentHostChildPort {
  post(message: AgentHostChildMessage): void;
  onParentMessage(handler: (raw: unknown) => void): void;
  onDisconnect(handler: () => void): void;
  exit(code: number): void;
}

/** The @cursor/sdk surface the child drives. Injected for the same reason. */
export interface AgentHostChildSdk {
  create(opts: AgentOptions): Promise<SDKAgent>;
  resume(agentId: string, opts: Partial<AgentOptions>): Promise<SDKAgent>;
}

const createOpts = (msg: AgentHostStartMessage): AgentOptions => {
  const opts: AgentOptions = {
    apiKey: msg.apiKey,
    local: {
      cwd: msg.cwd,
      sandboxOptions: { enabled: msg.sandbox },
      // ambient setting layers (their MCP servers) the agent loads — cloud is
      // not a thing here, so the knob is always local
      ...(msg.settingSources?.length ? { settingSources: msg.settingSources } : {}),
    },
  };
  if (msg.name) opts.name = msg.name;
  if (msg.mode) opts.mode = msg.mode;
  if (msg.model) opts.model = msg.model;
  return opts;
};

const resumeOpts = (msg: AgentHostStartMessage): Partial<AgentOptions> => {
  const opts: Partial<AgentOptions> = {
    apiKey: msg.apiKey,
    local: {
      cwd: msg.cwd,
      // settingSources must be re-passed on resume — inline/file-based MCP
      // context isn't persisted on the agent (see the SDK's resume docs)
      ...(msg.settingSources?.length ? { settingSources: msg.settingSources } : {}),
    },
  };
  if (msg.model) opts.model = msg.model;
  return opts;
};

const sendOpts = (msg: AgentHostStartMessage) => ({
  ...(msg.mode ? { mode: msg.mode } : {}),
  ...(msg.model ? { model: msg.model } : {}),
  ...(msg.force ? { local: { force: true } } : {}),
});

/**
 * The agent host child's run loop (docs/local-agents-in-worker-plan.md): one
 * child process per local run. On `start` it creates (or resumes) the SDK
 * agent, issues the first send, posts `started` BEFORE consuming the run's
 * stream (the ordering the parent's per-run buffer relies on), forwards every
 * SDK message as an `event`, posts the terminal `result`, closes the agent,
 * and exits. Failures post `error` — before `started` that rejects the
 * parent's createRun, after it the parent's streamRun. On `cancel` it cancels
 * the SDK run; on `disconnect` (the parent died) it cancels and exits so no
 * orphaned agent keeps editing files.
 */
export const runAgentHostChild = (port: AgentHostChildPort, sdk: AgentHostChildSdk): void => {
  let activeRun: Run | null = null;

  // one child = one run: every dispatched SDK message becomes one IPC event
  const callbacks: StreamCallbacks = {
    onStatus: (status) =>
      port.post({ kind: AGENT_HOST_MESSAGE_KINDS.EVENT, event: { type: "status", status } }),
    onAssistant: (text) =>
      port.post({ kind: AGENT_HOST_MESSAGE_KINDS.EVENT, event: { type: "assistant", text } }),
    onThinking: (text) =>
      port.post({ kind: AGENT_HOST_MESSAGE_KINDS.EVENT, event: { type: "thinking", text } }),
    onTool: (name, status, args, callId, extra) =>
      port.post({
        kind: AGENT_HOST_MESSAGE_KINDS.EVENT,
        event: { type: "tool", name, status, args, callId, result: extra?.result, truncated: extra?.truncated },
      }),
  };

  const handleStart = async (msg: AgentHostStartMessage): Promise<void> => {
    let exitCode = 1;
    try {
      if (!fs.existsSync(msg.cwd)) {
        throw new Error(`Local path for this repo does not exist: ${msg.cwd}. Fix it on the Settings page.`);
      }
      const agent = msg.resumeAgentId
        ? await sdk.resume(msg.resumeAgentId, resumeOpts(msg))
        : await sdk.create(createOpts(msg));
      try {
        const run = await agent.send(msg.prompt, sendOpts(msg));
        activeRun = run;
        port.post({ kind: AGENT_HOST_MESSAGE_KINDS.STARTED, agentId: agent.agentId, runId: run.id });
        const done = run.wait();
        try {
          callbacks.onStatus?.("RUNNING");
          for await (const m of run.stream()) {
            dispatchSdkMessage(m, callbacks);
          }
          port.post({ kind: AGENT_HOST_MESSAGE_KINDS.RESULT, result: await done });
          exitCode = 0;
        } finally {
          // observe the wait promise so a late rejection after a stream error
          // can't surface as an unhandled rejection — attach only, never
          // await: wait() may legitimately never settle after a stream failure
          done.catch(() => {});
        }
      } finally {
        activeRun = null;
        agent.close();
      }
    } catch (e) {
      // before `started` this rejects the parent's createRun; after it, the
      // parent's streamRun
      port.post({ kind: AGENT_HOST_MESSAGE_KINDS.ERROR, message: errorMessage(e) });
      exitCode = 1;
    }
    port.exit(exitCode);
  };

  port.onParentMessage((raw) => {
    let msg: AgentHostParentMessage;
    try {
      msg = parseAgentHostParentMessage(raw);
    } catch (e) {
      port.post({ kind: AGENT_HOST_MESSAGE_KINDS.ERROR, message: errorMessage(e) });
      port.exit(1);
      return;
    }
    if (msg.kind === AGENT_HOST_MESSAGE_KINDS.START) {
      if (activeRun) {
        port.post({ kind: AGENT_HOST_MESSAGE_KINDS.ERROR, message: "start received while a run is already active" });
        port.exit(1);
        return;
      }
      void handleStart(msg);
    } else if (activeRun) {
      void activeRun.cancel().catch(() => {});
    }
  });

  port.onDisconnect(() => {
    // the parent died — cancel the in-flight run (bounded) and exit so no
    // orphaned agent keeps editing files
    const cancel = activeRun ? activeRun.cancel().catch(() => {}) : Promise.resolve();
    void Promise.race([cancel, sleep(DISCONNECT_EXIT_MS)]).finally(() => port.exit(0));
  });
};
