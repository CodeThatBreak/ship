import "server-only";

import { config } from "../../../config";
import type { Database } from "../../../db/app";
import type { AgentRunResult, SettingSource } from "../../ports/agentPort";
import type { WorktreeManager } from "../../runtime/worktreeLifecycle/worktreeManager";
import type { TranscriptPayload } from "../../transcript/transcriptPayload";
import type { RunCostSummary } from "./runCostSummary";

export interface ExecuteRunOptions {
  /** When false, skip the late-write guard (chat-only turns that do not own node status). */
  ownsNodeStatus?: boolean;
  /** Attempt token stamped when the node was claimed; fences late results. */
  attemptId?: string;
}

/** Agent result plus the persisted runs-row id (for post-run attribution such as branch_id). */
export interface ExecuteRunResult {
  result: AgentRunResult;
  runRowId: string;
  /** the run's captured usage/cost summary (Task 21) — the outcome side-channel
   *  persists it as a `usage` artifact inside the terminal batch */
  usage?: RunCostSummary;
  /** the run's capped tool-call log (task 22) — the outcome side-channel
   *  persists it as a `transcript` artifact inside the terminal batch; absent
   *  when the run made no tool calls */
  transcript?: TranscriptPayload;
}

// ── agent run machinery ──────────────────────────────────────────────────────
export interface Started {
  agentId: string;
  runId: string;
  sessionId?: string | null;
}

export interface AgentStartInput {
  prompt: string;
  mode?: "agent" | "plan";
  name: string;
  startingRef?: string;
  followUpOn?: string | null; // cloud agent id / local session id to continue
  autoCreatePR?: boolean;
  customSubagents?: { name: string; instructions: string }[];
  cwd?: string; // local worktree override
  model?: string | null; // per-run model override
  nodeId?: string | null; // lifecycle-event attribution for engine-side ensures
  /** MCP/setting layers the local runtime loads MCP servers from (see AgentStartSpec) */
  settingSources?: SettingSource[];
  /** Per-run env vars for the agent's shell (step 08: the agent-tools
   *  capability token rides `DEVFLOW_AGENT_TOKEN`). Cloud runtimes inject
   *  them natively (SDK `cloud.envVars`); local runs have no env channel and
   *  receive the token through the prompt's tools block instead. */
  env?: Record<string, string>;
}

export type AgentRunnerDatabase = Pick<Database, "prisma" | "now" | "emitEvent" | "getSetting">;
export type AgentPortRegistry = Pick<typeof import("../../ports/agentPort").agentPortRegistry, "forMode">;
export type AppConfig = Pick<typeof config, "defaultModel">;
export type WorktreeRunManager = Pick<WorktreeManager, "ensureForRun">;
