import "server-only";

import type { ModelSelection, RunResult, SettingSource } from "@cursor/sdk";

/**
 * The agent host IPC protocol (docs/local-agents-in-worker-plan.md): the
 * typed messages exchanged between the web/worker process (`LocalAgentHost`)
 * and the per-run child process (`worker/agentHost/main.ts`). Runtime shapes
 * are validated by the Zod schemas in `../agentHostMessages.ts` at each
 * boundary — these interfaces are the shared contract.
 */

/** One streamed run event, as the child forwards SDK messages to the parent. */
export type AgentHostEvent =
  | { type: "status"; status: string }
  | { type: "assistant"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      name: string;
      status: string;
      args?: unknown;
      callId?: string;
      result?: unknown;
      truncated?: unknown;
    };

/** Parent → child: start (or resume) one agent run in this child. */
export interface AgentHostStartMessage {
  kind: "start";
  apiKey: string;
  cwd: string;
  prompt: string;
  mode?: "agent" | "plan";
  name?: string;
  /** already fast-pinned by the parent (`CursorAgentService.resolveModel`) */
  model?: ModelSelection;
  sandbox: boolean;
  force: boolean;
  /** resume an existing agent conversation (follow-up) */
  resumeAgentId?: string;
  /** ambient Cursor settings layers (their MCP servers) the agent loads */
  settingSources?: SettingSource[];
}

/** Parent → child: cancel the in-flight run. */
export interface AgentHostCancelMessage {
  kind: "cancel";
}

export type AgentHostParentMessage = AgentHostStartMessage | AgentHostCancelMessage;

/**
 * Child → parent: the run started (its first send was issued). Always the
 * first child→parent message of a run — see the ordering note in
 * `constants/agentHostMessageKinds.ts`.
 */
export interface AgentHostStartedMessage {
  kind: "started";
  agentId: string;
  runId: string;
}

/** Child → parent: one streamed run event. */
export interface AgentHostEventMessage {
  kind: "event";
  event: AgentHostEvent;
}

/**
 * Child → parent: the SDK's terminal RunResult, posted verbatim (the Zod
 * layer validates the load-bearing fields the engine consumes).
 */
export interface AgentHostResultMessage {
  kind: "result";
  result: RunResult;
}

/** Child → parent: the run (or start) failed. */
export interface AgentHostErrorMessage {
  kind: "error";
  message: string;
}

export type AgentHostChildMessage =
  | AgentHostStartedMessage
  | AgentHostEventMessage
  | AgentHostResultMessage
  | AgentHostErrorMessage;
