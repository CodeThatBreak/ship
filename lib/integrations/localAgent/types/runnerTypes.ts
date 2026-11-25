import "server-only";

import type { AgentRunResult, SDKSettingSource } from "../../cursorSdk";
import type { RunnerUsage } from "../utils/runnerUsage";

/** Everything needed to start (or resume) a local agent run in the host. */
export interface RunnerStartInput {
  prompt: string;
  /** local repo path (the flow's registered checkout) */
  workspace: string;
  /** worktree override (defaults to workspace) */
  cwd?: string;
  mode?: "agent" | "plan";
  /** raw model spec (`"<id>[param=value,…]"`) */
  model?: string;
  sandbox?: boolean;
  force?: boolean;
  /** resume a previous local agent (follow-up run) */
  resumeAgentId?: string;
  /** ambient setting layers supplying MCP servers */
  settingSources?: SDKSettingSource[];
}

/** A streamed local run: the SDK result plus its follow-up handle and usage. */
export interface RunnerStreamResult {
  result: AgentRunResult;
  sessionId: string | null;
  usage: RunnerUsage | null;
}
