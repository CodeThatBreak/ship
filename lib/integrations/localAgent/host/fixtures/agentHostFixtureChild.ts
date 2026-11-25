/**
 * Test fixture for `localAgentHost.test.ts` — a protocol-speaking stand-in
 * for `worker/agentHost/main.ts`, forked by the real `LocalAgentHost`. The
 * start message's `name` field selects the scenario; every scenario posts
 * protocol-valid messages so the host's Zod layer exercises the real path.
 */
import "server-only";

import { AGENT_HOST_MESSAGE_KINDS } from "../constants/agentHostMessageKinds";
import type { AgentHostParentMessage, AgentHostStartMessage } from "../types/agentHostProtocol";

const AGENT_ID = "agent-fx";
const RUN_ID = "run-fx";

const post = (message: unknown): void => {
  process.send?.(message as never);
};

const started = (): void => {
  post({ kind: AGENT_HOST_MESSAGE_KINDS.STARTED, agentId: AGENT_ID, runId: RUN_ID });
};

const event = (e: unknown): void => {
  post({ kind: AGENT_HOST_MESSAGE_KINDS.EVENT, event: e });
};

const result = (r: Record<string, unknown>): void => {
  post({ kind: AGENT_HOST_MESSAGE_KINDS.RESULT, result: r });
};

/** Echo the start payload so tests can assert the host forwards it verbatim. */
const echoStart = (msg: AgentHostStartMessage): void => {
  event({
    type: "assistant",
    text: JSON.stringify({
      prompt: msg.prompt,
      mode: msg.mode ?? null,
      model: msg.model ?? null,
      sandbox: msg.sandbox,
      force: msg.force,
      resumeAgentId: msg.resumeAgentId ?? null,
      settingSources: msg.settingSources ?? null,
    }),
  });
};

const scenarios: Record<string, (msg: AgentHostStartMessage) => void> = {
  default: (msg) => {
    started();
    echoStart(msg);
    event({ type: "status", status: "RUNNING" });
    event({ type: "assistant", text: "hello from fixture" });
    result({
      id: RUN_ID,
      status: "finished",
      result: "default done",
      durationMs: 42,
      model: { id: "composer-2.5" },
    });
    process.exit(0);
  },
  // the whole run completes (and the child exits) BEFORE streamRun attaches —
  // exercises the host's event buffering + parked result
  "finish-fast": () => {
    started();
    event({ type: "assistant", text: "buffered before attach" });
    result({ id: RUN_ID, status: "finished", result: "fast done" });
    process.exit(0);
  },
  "crash-mid-run": () => {
    started();
    process.exit(3); // no result — surfaces as AgentHostExitError
  },
  "error-before-started": () => {
    post({ kind: AGENT_HOST_MESSAGE_KINDS.ERROR, message: "boom before start" });
    process.exit(1);
  },
  "env-report": () => {
    started();
    event({
      type: "assistant",
      text: JSON.stringify({
        NODE_ENV: process.env.NODE_ENV ?? null,
        DEVFLOW_AGENT_TOKEN: process.env.DEVFLOW_AGENT_TOKEN ?? null,
        DEVFLOW_SECRETS_KEY: process.env.DEVFLOW_SECRETS_KEY ?? null,
        TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH ?? null,
      }),
    });
    result({ id: RUN_ID, status: "finished", result: "env reported" });
    process.exit(0);
  },
  // waits for the parent's cancel, then finishes cancelled
  "wait-for-cancel": () => {
    started();
  },
};

process.on("message", (raw: unknown) => {
  const msg = raw as AgentHostParentMessage;
  if (msg.kind === AGENT_HOST_MESSAGE_KINDS.CANCEL) {
    result({ id: RUN_ID, status: "cancelled" });
    process.exit(0);
    return;
  }
  (scenarios[msg.name ?? "default"] ?? scenarios.default)(msg);
});

process.on("disconnect", () => process.exit(0));
