/**
 * Wire protocol between the web process and the local-agent host process.
 *
 * The host exists because `@cursor/sdk`'s local runtime builds its shell
 * environment from the host process's own `process.env`, with no per-run
 * override (`LocalAgentOptions` has no `env`; only cloud `envVars`). Running
 * the agent loop inside the Next server therefore hands every agent shell the
 * server's `NODE_ENV=production` — which makes repo hooks and installs take
 * their CI/production branches against a developer's checkout. The host is
 * spawned with `childProcessEnv()` instead, so agent shells see no NODE_ENV.
 *
 * Shapes here are plain JSON — they cross a process boundary.
 */
import "server-only";

import type { AgentRunResult } from "../../../engine/ports/agentPort/types/agentPort";
import type { CatalogModel } from "../../../modelSpec";
import type { SettingSource } from "../../../engine/templates/schemas/mcpSources";

/** One assistant/tool/status delta as it crosses the boundary. */
export type HostStreamEvent =
  | { kind: "status"; status: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      name: string;
      status: string;
      args?: unknown;
      callId?: string;
      result?: unknown;
      truncated?: unknown;
    };

/** Everything the host needs to start (or resume) a local run. */
export interface HostStartParams {
  prompt: string;
  workspace: string;
  cwd?: string;
  mode?: "agent" | "plan";
  /** raw model spec (`"<id>[param=value,…]"`), parsed host-side. */
  model?: string;
  sandbox?: boolean;
  force?: boolean;
  resumeAgentId?: string;
  settingSources?: SettingSource[];
}

/** Token usage as the host reports it (SDK result, normalized by the child). */
export interface HostUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  model?: string;
}

export interface HostStreamResult {
  result: AgentRunResult;
  agentId: string;
  usage: HostUsage | null;
}

export type HostMethod =
  | "start"
  | "stream"
  | "cancel"
  | "release"
  | "inspect"
  | "catalog"
  | "available";

export interface HostRequestMap {
  start: { params: HostStartParams; result: { agentId: string; runId: string } };
  stream: {
    params: { runId: string };
    result: HostStreamResult;
  };
  cancel: { params: { runId: string }; result: boolean };
  release: { params: { runId: string }; result: null };
  inspect: {
    params: { sessionId: string; runId: string; workspace: string };
    result: { completed: boolean; text: string } | null;
  };
  catalog: { params: Record<string, never>; result: CatalogModel[] | null };
  available: { params: Record<string, never>; result: boolean };
}

/** A request from the web process to the host. */
export type HostRequest = {
  [M in HostMethod]: { type: "request"; id: number; method: M; params: HostRequestMap[M]["params"] };
}[HostMethod];

/** A stream delta emitted while a `stream` request is in flight. */
export interface HostEventMessage {
  type: "event";
  id: number;
  event: HostStreamEvent;
}

/** The terminal answer to a request (success or typed failure). */
export type HostResponseMessage =
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string };

export type HostOutbound = HostEventMessage | HostResponseMessage;
