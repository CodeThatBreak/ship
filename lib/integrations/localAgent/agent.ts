import "server-only";

import type { SDKSettingSource } from "../cursorSdk";
import type { AgentRunResult } from "../../engine/ports/agentPort/types/agentPort";
import { db, type Database } from "../../db/app";
import { pinnedProcessService } from "../../composition/processServices";
import { SETTINGS_KEYS } from "@/constants/settings";
import { settingBoolean, settingNumber } from "../../schemas/settingValues";
import { GIT_FETCH_TIMEOUT_MS, runGit } from "../../git/boundedExec";
import { assertValidBranchName } from "../../git/branchName";
import { AgentRunTimeoutError } from "../../engine/ports/agentErrors";
import { localAgentHost } from "./host/hostPin";
import type { HostStreamEvent } from "./host/protocol";

export interface LocalAgentInput {
  prompt: string;
  workspace: string; // local repo path
  mode?: "agent" | "plan";
  model?: string;
  branch?: string; // best-effort checkout before starting
  sessionId?: string; // resume a previous local agent (follow-ups)
  cwd?: string; // worktree override (defaults to workspace)
  /** ambient setting layers supplying MCP servers (Cursor local.settingSources) */
  settingSources?: SDKSettingSource[];
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
 * Local agent integration (web side).
 *
 * Runs do NOT execute in this process: the @cursor/sdk local runtime builds its
 * shell environment from the hosting process's `process.env`, and a Next server
 * pins `NODE_ENV=production` for itself, so an in-process local run would hand
 * every agent shell a production marker (see `host/protocol.ts`). This facade
 * therefore owns the local-only policy — branch checkout, worktree cwd, the run
 * timeout, settings defaults — and delegates the SDK work to the local-agent
 * host process via {@link localAgentHost}.
 *
 * Must never: import `cursorSdk` directly (that would pull run handles back
 * into a process whose env is wrong), or let a timeout leave the host's run
 * alive — `streamRun` always cancels on expiry.
 */
export class LocalAgentService {
  constructor(private readonly database: Pick<Database, "getSetting">) {}

  /** True if the host still owns the given local run (false after a restart). */
  hasActiveRun(runId: string): boolean {
    return localAgentHost.hasActiveRun(runId);
  }

  async defaults(): Promise<{
    force: boolean;
    sandbox: boolean;
    timeoutMs: number;
  }> {
    return {
      force: await this.database.getSetting(SETTINGS_KEYS.LOCAL_AGENT_FORCE, settingBoolean, true),
      sandbox: await this.database.getSetting(SETTINGS_KEYS.LOCAL_AGENT_SANDBOX, settingBoolean, false),
      timeoutMs: await this.database.getSetting(SETTINGS_KEYS.LOCAL_AGENT_TIMEOUT_MS, settingNumber, 30 * 60 * 1000),
    };
  }

  /**
   * Whether the local runtime is usable: the @cursor/sdk runs the agent loop
   * with Node >= 22.13 and authenticates with a stored Cursor API key, so the
   * cursor-agent CLI is no longer required.
   */
  async cliAvailable(): Promise<boolean> {
    return localAgentHost.available();
  }

  /**
   * Models available to the authenticated account (Cursor.models.list).
   * Returns null when the catalog is unreachable — callers fall back to
   * FALLBACK_MODELS.
   */
  async listModels(): Promise<string[] | null> {
    const catalog = await this.listCatalog();
    if (!catalog) return null;
    const ids = catalog.map((m) => m.id).filter(Boolean);
    return ids.length ? ids : null;
  }

  /** Full catalog (with parameters/variants for fast mode + effort UI). */
  async listCatalog() {
    return localAgentHost.catalog();
  }

  /** Best-effort: make sure the workspace is on the requested branch. */
  private async ensureBranch(workspace: string, branch: string): Promise<void> {
    await assertValidBranchName(branch);
    const prefix = ["-C", workspace];
    await runGit([...prefix, "fetch", "origin", "--end-of-options", branch], {
      timeout: GIT_FETCH_TIMEOUT_MS,
    }).catch(() => {});
    const { stdout: cur } = await runGit([...prefix, "rev-parse", "--abbrev-ref", "HEAD"]);
    if (cur.trim() === branch) return;
    await runGit([...prefix, "checkout", "--end-of-options", branch]).catch(async () => {
      await runGit([...prefix, "checkout", "-b", branch, "--end-of-options", `origin/${branch}`]);
    });
  }

  /**
   * Spawn a local agent run in the host process.
   *
   * Performs branch checkout, then creates (or resumes) the agent and issues
   * the first send, so agentId/runId are real before returning. Consume events
   * and the final result via streamRun.
   */
  async createRun(
    input: LocalAgentInput,
  ): Promise<{ agentId: string; runId: string }> {
    const opts = await this.defaults();
    if (input.branch && input.mode !== "plan") {
      await this.ensureBranch(input.workspace, input.branch).catch(() => {});
    }

    return localAgentHost.start({
      prompt: input.prompt,
      workspace: input.workspace,
      cwd: input.cwd,
      mode: input.mode,
      model: input.model,
      sandbox: opts.sandbox,
      force: opts.force,
      resumeAgentId: input.sessionId,
      settingSources: input.settingSources,
    });
  }

  /**
   * Stop an in-flight local run. The host's streamRun rejects, so any executor
   * awaiting it marks its node failed (retryable). No-op for unknown runs.
   */
  cancelRun(runId: string): Promise<boolean> {
    return localAgentHost.cancel(runId);
  }

  /**
   * Read a local run's persisted state from the SDK store and reconstruct its
   * last turn. Used by reconcile after a restart. Returns null when the run
   * can't be loaded — callers should fail the node.
   */
  async inspectSession(
    sessionId: string,
    runId: string,
    workspace: string,
  ): Promise<LocalSessionInspection | null> {
    return localAgentHost.inspect(sessionId, runId, workspace);
  }

  /** Stream events of a local run to completion, enforcing the run timeout. */
  async streamRun(
    runId: string,
    cb: StreamCallbacksLike = {},
  ): Promise<LocalRunResult> {
    const { timeoutMs } = await this.defaults();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void this.cancelRun(runId);
        reject(new AgentRunTimeoutError(runId, timeoutMs));
      }, timeoutMs);
    });
    try {
      const out = await Promise.race([
        localAgentHost.stream(runId, (event) => dispatchHostEvent(event, cb)),
        onTimeout,
      ]);
      return {
        result: out.result,
        sessionId: out.agentId || null,
        usage: out.usage,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  releaseRun(runId: string): void {
    localAgentHost.release(runId);
  }
}

/** The stream callbacks consumers pass (mirrors the SDK shape, engine-neutral). */
export interface StreamCallbacksLike {
  onStatus?: (s: string) => void;
  onAssistant?: (text: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (
    name: string,
    status: string,
    args?: unknown,
    callId?: string,
    extra?: { result?: unknown; truncated?: unknown },
  ) => void;
}

/** Fan one host stream event out to the caller's callbacks. */
const dispatchHostEvent = (event: HostStreamEvent, cb: StreamCallbacksLike): void => {
  switch (event.kind) {
    case "status":
      cb.onStatus?.(event.status);
      return;
    case "assistant":
      cb.onAssistant?.(event.text);
      return;
    case "thinking":
      cb.onThinking?.(event.text);
      return;
    case "tool":
      cb.onTool?.(event.name, event.status, event.args, event.callId, {
        result: event.result,
        truncated: event.truncated,
      });
      return;
  }
};

/**
 * Shared local-agent service — process-pinned via the process-services
 * container (decision Q9). The facade is stateless over the pinned host client
 * (which owns the pending-call map and the single child process).
 */
export const localAgent = pinnedProcessService(
  "localAgent",
  () => new LocalAgentService(db),
);
