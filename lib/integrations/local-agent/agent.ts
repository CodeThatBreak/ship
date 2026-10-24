import { execFile } from "child_process";
import { promisify } from "util";
import {
  cursorAgent,
  type AgentRunResult,
  type StreamCallbacks,
  type TokenUsage,
} from "../cursorSdk";
import { parseModelSpec } from "../../modelSpec";
import { db } from "../../db";
import { processSingleton } from "../../singleton";
// db is used for settings defaults (local_agent.*) below.

const exec = promisify(execFile);

export interface LocalAgentInput {
  prompt: string;
  workspace: string; // local repo path
  mode?: "agent" | "plan";
  model?: string;
  branch?: string; // best-effort checkout before starting
  sessionId?: string; // resume a previous local agent (follow-ups)
  cwd?: string; // worktree override (defaults to workspace)
}

export interface LocalEvent {
  kind: "assistant" | "thinking" | "tool" | "status";
  text?: string;
  name?: string;
  status?: string;
  args?: unknown;
  callId?: string;
  result?: string;
}

/**
 * Token usage for a local run. The SDK surfaces real per-run token counts on
 * the run result (unlike ACP, which reported none), so these are populated
 * whenever the runtime reports usage. Fields stay optional so consumers keep
 * one code path with cloud runs.
 */
export interface LocalUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  model?: string;
  raw?: unknown;
}

export interface LocalRunResult {
  result: AgentRunResult;
  /** the follow-up handle (the SDK agent id) to persist for refine/chat */
  sessionId: string | null;
  usage: LocalUsage | null;
}

export interface LocalSessionInspection {
  /** the last turn finished cleanly */
  completed: boolean;
  /** assistant text from the last turn ("" when the turn never produced any) */
  text: string;
}

/**
 * Local agent integration: drives local agent runs through the @cursor/sdk
 * local runtime (files stay on disk; the agent loop runs in-process) via the
 * unified CursorAgentService, plus branch checkout and settings.
 *
 * This adapter adds the local-only concerns (branch checkout, worktree cwd,
 * settings defaults) and maps SDK results into the LocalRunResult shape the
 * engine consumes.
 */
export class LocalAgentService {
  /** True if this server process still owns the given local run (false after restart). */
  hasActiveRun(runId: string): boolean {
    return cursorAgent.hasActiveRun(runId);
  }

  defaults() {
    return {
      force: db.getSetting<boolean>("local_agent.force", true),
      sandbox: db.getSetting<boolean>("local_agent.sandbox", false),
      timeoutMs: db.getSetting<number>(
        "local_agent.timeout_ms",
        30 * 60 * 1000,
      ),
    };
  }

  /**
   * Whether the local runtime is usable: the @cursor/sdk runs the agent loop
   * in-process (Node >= 22.13) and authenticates with CURSOR_API_KEY, so the
   * cursor-agent CLI is no longer required.
   */
  async cliAvailable(): Promise<boolean> {
    return cursorAgent.available();
  }

  /**
   * Models available to the authenticated account (Cursor.models.list).
   * Returns null when the catalog is unreachable — callers fall back to
   * FALLBACK_MODELS.
   */
  async listModels(): Promise<string[] | null> {
    return cursorAgent.listModels();
  }

  /** Full catalog (with parameters/variants for fast mode + effort UI). */
  async listCatalog() {
    return cursorAgent.listCatalog();
  }

  /** Best-effort: make sure the workspace is on the requested branch. */
  private async ensureBranch(workspace: string, branch: string): Promise<void> {
    const git = ["-C", workspace];
    await exec("git", [...git, "fetch", "origin", branch], {
      maxBuffer: 10 << 20,
    }).catch(() => {});
    const { stdout: cur } = await exec("git", [
      ...git,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    if (cur.trim() === branch) return;
    await exec("git", [...git, "checkout", branch], {
      maxBuffer: 10 << 20,
    }).catch(async () => {
      await exec(
        "git",
        [...git, "checkout", "-b", branch, `origin/${branch}`],
        { maxBuffer: 10 << 20 },
      );
    });
  }

  /**
   * Split a model spec into a ModelSelection: "composer-2.5[fast=false]" →
   * { id: "composer-2.5", params: [{ id: "fast", value: "false" }] }.
   */
  private modelSelection(raw: string | undefined) {
    return parseModelSpec(raw);
  }

  /**
   * Spawn a local agent run on the SDK runtime.
   *
   * Performs branch checkout, creates/resumes the agent, and issues the first
   * send before returning so agentId/runId are real. Consume events and the
   * final result via streamRun(runId, callbacks).
   */
  async createRun(
    input: LocalAgentInput,
  ): Promise<{ agentId: string; runId: string }> {
    if (!cursorAgent.available()) {
      throw new Error(
        "Local agent runs require Node 22.13+ and CURSOR_API_KEY. Set the key on the Settings page.",
      );
    }
    const opts = this.defaults();
    if (input.branch && input.mode !== "plan") {
      await this.ensureBranch(input.workspace, input.branch).catch(() => {});
    }

    const runCwd = input.cwd ?? input.workspace;
    return cursorAgent.createRun({
      prompt: input.prompt,
      cloud: false,
      cwd: runCwd,
      mode: input.mode,
      model: this.modelSelection(input.model),
      sandbox: opts.sandbox,
      force: opts.force,
      resumeAgentId: input.sessionId,
    });
  }

  /**
   * Stop an in-process local run (cancels the SDK run). The run's streamRun
   * rejects, so any executor awaiting it marks its node failed (retryable).
   * No-op after restart (handle gone) — reconcile handles orphaned nodes.
   */
  cancelRun(runId: string): boolean {
    return cursorAgent.cancelRun(runId);
  }

  /**
   * Read a local run's persisted state from the SDK store and reconstruct its
   * last turn. Used by reconcile after a server restart. Returns null when
   * the run can't be loaded — callers should fail the node.
   */
  async inspectSession(
    sessionId: string,
    runId: string,
    workspace: string,
  ): Promise<LocalSessionInspection | null> {
    return cursorAgent.inspectLocalRun(sessionId, runId, workspace);
  }

  /** Stream events of a local run to completion. */
  async streamRun(
    runId: string,
    cb: StreamCallbacks = {},
  ): Promise<LocalRunResult> {
    const { result, agentId } = await cursorAgent.streamRun(runId, cb);
    // agentId is the follow-up handle persisted as the run's session id.
    return {
      result,
      sessionId: agentId,
      usage: usageFromResult(result),
    };
  }
}

/** Map an SDK TokenUsage into the engine's LocalUsage shape. */
function usageFromResult(result: AgentRunResult): LocalUsage | null {
  const u: TokenUsage | undefined = result.usage;
  const model = result.model?.id;
  if (!u && result.durationMs == null && !model) return null;
  return {
    inputTokens: u?.inputTokens,
    outputTokens: u?.outputTokens,
    cacheReadTokens: u?.cacheReadTokens,
    cacheWriteTokens: u?.cacheWriteTokens,
    durationMs: result.durationMs,
    model,
    raw: u,
  };
}

export const localAgent = processSingleton(
  "localAgent",
  () => new LocalAgentService(),
);
