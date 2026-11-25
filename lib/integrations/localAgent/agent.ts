import "server-only";

import {
  cursorAgent,
  type AgentRunResult,
  type ModelSelection,
  type SDKSettingSource,
  type TokenUsage,
} from "../cursorSdk";
import type { StreamCallbacks } from "../utils/sdkMessageDispatch";
import { parseModelSpec } from "../../modelSpec";
import { db, type Database } from "../../db/app";
import { pinnedProcessService } from "../../composition/processServices";
import { SETTINGS_KEYS } from "@/constants/settings";
import { settingBoolean, settingNumber } from "../../schemas/settingValues";
import { GIT_FETCH_TIMEOUT_MS, runGit } from "../../git/boundedExec";
import { assertValidBranchName } from "../../git/branchName";
import { AgentRunTimeoutError } from "../../engine/ports/agentErrors";
import { LocalAgentHost } from "./host/localAgentHost";
import type { LocalAgentHostRunInput } from "./host/types/localAgentHostTypes";

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
  /**
   * Per-run env vars injected into the agent's shell (`AgentStartSpec.env` —
   * declared secrets and the agent-tools capability token). Merged over the
   * scrubbed server env inside the agent host child.
   */
  env?: Record<string, string>;
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
 * Local agent integration: drives local agent runs through the per-run agent
 * host child process (`LocalAgentHost` forks `worker/agentHost/main.ts` for
 * every run, so the agent loop — and every shell it spawns — runs in a
 * scrubbed environment instead of inheriting the server's). This adapter adds
 * the local-only concerns (branch checkout, worktree cwd, settings defaults)
 * and maps the host's results into the LocalRunResult shape the engine
 * consumes. Model resolution, the key check and the persisted-session probe
 * stay in-process in the parent (`cursorAgent`): they spawn no shells.
 */
export class LocalAgentService {
  constructor(private readonly database: Pick<Database, "getSetting">) {}

  /** True if this server process still owns the given local run (false after restart). */
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
   * Whether the local runtime is usable: the agent host children run the
   * @cursor/sdk agent loop (Node >= 22.13) and authenticate with the stored
   * Cursor API key.
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
   * Parse the raw model spec and pin fast mode off in the parent — the child
   * receives the resolved ModelSelection and passes it to the SDK verbatim.
   */
  private async resolveRunModel(raw: string | undefined): Promise<ModelSelection | undefined> {
    const parsed = parseModelSpec(raw);
    return parsed ? await cursorAgent.resolveModel(parsed) : undefined;
  }

  /**
   * Spawn a local agent run in its own agent host child process.
   *
   * Performs branch checkout, resolves the model and API key in-process, and
   * forks the child whose first send is issued before returning so
   * agentId/runId are real. Consume events and the final result via
   * streamRun(runId, callbacks).
   */
  async createRun(
    input: LocalAgentInput,
  ): Promise<{ agentId: string; runId: string }> {
    if (!(await cursorAgent.available())) {
      throw new Error(
        "Local agent runs require Node 22.13+ and the Cursor API key. Set the key in Settings → Integrations → Harness.",
      );
    }
    const opts = await this.defaults();
    if (input.branch && input.mode !== "plan") {
      await this.ensureBranch(input.workspace, input.branch).catch(() => {});
    }

    const run: LocalAgentHostRunInput = {
      prompt: input.prompt,
      cwd: input.cwd ?? input.workspace,
      ...(input.mode ? { mode: input.mode } : {}),
      model: await this.resolveRunModel(input.model),
      sandbox: opts.sandbox,
      force: opts.force,
      ...(input.sessionId ? { resumeAgentId: input.sessionId } : {}),
      ...(input.settingSources?.length ? { settingSources: input.settingSources } : {}),
      ...(input.env ? { env: input.env } : {}),
      apiKey: await cursorAgent.apiKey(),
    };
    return localAgentHost.createRun(run);
  }

  /**
   * Stop an in-flight local run (cancels the SDK run in the child). The run's
   * streamRun rejects, so any executor awaiting it marks its node failed
   * (retryable). No-op after restart (handle gone) — reconcile handles
   * orphaned nodes.
   */
  cancelRun(runId: string): Promise<boolean> {
    return localAgentHost.cancelRun(runId);
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
    const { timeoutMs } = await this.defaults();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void this.cancelRun(runId);
        reject(new AgentRunTimeoutError(runId, timeoutMs));
      }, timeoutMs);
    });
    try {
      const { result, agentId } = await Promise.race([
        localAgentHost.streamRun(runId, cb),
        onTimeout,
      ]);
      return {
        result,
        sessionId: agentId,
        usage: usageFromResult(result),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  releaseRun(runId: string): void {
    localAgentHost.releaseRun(runId);
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

/**
 * Shared local agent host — process-pinned via the process-services
 * container (decision Q9): it holds live child-process handles, so it must be
 * the one instance per process that the run registry lives in. Pinned here
 * (not next to the class) because class files stay pure (target-architecture
 * §12, enforced by tests/architecture/classFilePurity.test.ts).
 */
export const localAgentHost = pinnedProcessService(
  "localAgentHost",
  () => new LocalAgentHost(),
);

/**
 * Shared local-agent service — process-pinned via the process-services
 * container (decision Q9): it drives {@link localAgentHost}'s live child
 * handles (stream/cancel/timeout), so it must be the same one instance per
 * process the run registry lives in.
 */
export const localAgent = pinnedProcessService(
  "localAgent",
  () => new LocalAgentService(db),
);
