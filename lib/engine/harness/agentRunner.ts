import "server-only";

import { config } from "../../config";
import type { Database } from "../../db/app";
import { db } from "../../db/app";
import { resolveAgentRunModel } from "../../modelSpec";
import { settingString } from "../../schemas/settingValues";
import {
  agentPortRegistry,
  type AgentPort,
  type AgentRunResult,
  type AgentStartSpec,
  type SettingSource,
} from "../ports/agentPort";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "../nodes/shared/runContext";
import { worktreeManager, type WorktreeManager } from "../runtime/worktreeLifecycle";
import type { NodeSupport } from "../nodes/shared/nodeSupport";
import { nodeSupport, engineParts } from "@/lib/composition/container";
import { StreamBuffer } from "./streamBuffer";
import { ToolPairer, type ToolEmitFn } from "./toolPairer";
import { usageTracker, type RunCostSummary, type UsageTracker } from "./usageTracker";
import { RunSupersededError } from "../errors/runSupersededError";
import { EVENT_KIND, RUN_STATUS, SETTING_KEY } from "../constants/vocabulary";
import { NODE_LEASE_HEARTBEAT_MS } from "../constants/leases";

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

type AgentRunnerDatabase = Pick<Database, "get" | "run" | "now" | "emitEvent" | "getSetting">;
type AgentPortRegistry = Pick<typeof agentPortRegistry, "forMode">;
type AppConfig = Pick<typeof config, "defaultModel">;
type WorktreeRunManager = Pick<WorktreeManager, "ensureForRun">;

/**
 * Starts and supervises agent runs on the flow's configured runtime (a vendor
 * `AgentPort` resolved from the port registry): model resolution, run-row
 * persistence, event streaming (buffered), and usage/cost capture.
 */
export class AgentRunner {
  constructor(
    private readonly ctxHelper: FlowContextHelper,
    protected readonly support: NodeSupport,
    private readonly usage: UsageTracker,
    private readonly database: AgentRunnerDatabase,
    private readonly appConfig: AppConfig,
    private readonly ports: AgentPortRegistry,
    private readonly worktrees: WorktreeRunManager,
  ) {}

  /** Start an agent run on the flow's configured runtime (port by exec mode). */
  async startAgent(ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    const mode = this.ctxHelper.execMode(ctx);
    const port = await this.ports.forMode(mode);
    // Model resolution: per-run → settings → env; local runs always pin a concrete id.
    const model = resolveAgentRunModel(
      input.model,
      await this.database.getSetting(SETTING_KEY.DEFAULT_MODEL, settingString, ""),
      this.appConfig.defaultModel(),
      mode,
      port.fallbackModels,
    );
    const spec: AgentStartSpec = {
      prompt: input.prompt,
      mode: input.mode,
      name: input.name,
      model: model ?? null,
      followUpOn: input.followUpOn ?? null,
      startingRef: input.startingRef,
      autoCreatePR: input.autoCreatePR,
      customSubagents: input.customSubagents,
      settingSources: input.settingSources?.length ? input.settingSources : undefined,
      env: input.env,
    };
    if (port.execMode === "local") {
      // worktree-aware cwd: the flow's worktree when it has one, else the
      // registered checkout (the hub). Nodes pass input.cwd to pin a
      // freshly-created worktree before the flow row read would see it.
      spec.workspace = this.ctxHelper.requireRunCwd(ctx);
      // Option B: an unpinned MUTATING run is ensured into the flow worktree —
      // the node pin (input.cwd) always wins; plan runs stay on the hub.
      const ensured = await this.worktrees.ensureForRun(ctx, {
        mode: input.mode,
        cwd: input.cwd,
        nodeId: input.nodeId ?? null,
        defaultBranch: this.ctxHelper.buildBranch(ctx),
      });
      spec.cwd = input.cwd ?? ensured.cwd;
      if (!input.cwd && ensured.setupNote) {
        // same contract as build/resolve: one advisory line, agent self-repairs
        spec.prompt += `\n${ensured.setupNote} If the changes need dependencies, run the repo's dependency setup yourself before building/testing.`;
      }
    } else {
      spec.repos = ctx.flow.repoUrl
        ? [{ url: ctx.flow.repoUrl, startingRef: input.startingRef ?? ctx.repo?.defaultBranch ?? "main" }]
        : undefined;
    }
    return port.start(spec);
  }

  /**
   * Run an agent to completion: persist the run row, stream events, capture
   * usage/cost, and throw on a non-FINISHED terminal status.
   */
  async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string,
    options?: ExecuteRunOptions,
  ): Promise<ExecuteRunResult> {
    const { flow } = ctx;
    const mode = this.ctxHelper.execMode(ctx);
    const port: AgentPort = await this.ports.forMode(mode);
    const ownsNodeStatus = options?.ownsNodeStatus !== false;
    const attemptAtStart =
      options?.attemptId
      ?? (await this.database.get<{ attemptId: string | null }>(`SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`, nodeId))?.attemptId;
    // step 08 (Invariant 10): the claim-minted capability token rides the
    // startup run row — durable truth the agent-tools endpoint validates
    // against (the in-process registry is only the claim→row carrier).
    const apiToken = ownsNodeStatus && attemptAtStart ? engineParts.attemptRegistry.apiTokenOf(nodeId) : null;
    if (ownsNodeStatus && attemptAtStart) {
      await this.support.registerStartupRun(flow.id, nodeId, attemptAtStart, apiToken);
    }
    const startedAt = Date.now();
    const { agentId, runId } = await start();
    try {
      await this.support.persistRun(flow.id, nodeId, agentId, runId, apiToken);
      const runRowId = (await this.database.get<{ id: string }>(`SELECT id FROM runs WHERE run_ref=$1`, runId))?.id;
      if (!runRowId) throw new Error(`run row missing after persist for ${runId}`);
    const startedWhileRunning = attemptAtStart != null;
    await this.database.emitEvent(flow.id, nodeId, EVENT_KIND.LIFECYCLE, `${label} started (${mode})`, { agentId, runId, run_id: runId, mode });

    // durable liveness (step 03): while the stream is pending, heartbeat the
    // node + run leases so a reconciler in another process (the worker) sees
    // this stage as alive — the loop below can legitimately run for minutes
    // between callbacks, so liveness cannot hang off stream events
    const leaseHeartbeat = setInterval(() => {
      void this.support.heartbeatLeases(nodeId, runId).catch(() => {});
    }, NODE_LEASE_HEARTBEAT_MS);

    const stream = new StreamBuffer(flow.id, nodeId, runId);
    const emitTool: ToolEmitFn = async (name, status, callId, args, result, startedAtMs) =>
      await this.database.emitEvent(flow.id, nodeId, EVENT_KIND.TOOL, `${name}: ${status}`, {
        run_id: runId, callId, name, status,
        args: args != null ? JSON.stringify(args) : undefined,
        result,
        durationMs: startedAtMs != null ? Date.now() - startedAtMs : undefined,
      });
    const pairTool = new ToolPairer(emitTool);

    let result: AgentRunResult | undefined;
    let costSummary: RunCostSummary = {};
    let streamError: unknown;
    const callbacks = {
      onStatus: async (s: string) => await this.database.emitEvent(flow.id, nodeId, EVENT_KIND.STATUS, `run ${s}`, { run_id: runId }),
      onAssistant: (t: string) => stream.push("assistant", t),
      onThinking: (t: string) => stream.push("thinking", t),
      onTool: (name: string, status: string, args: unknown, callId: string | undefined, extra: { result?: unknown } | undefined) => {
        stream.flushBeforeTool();
        return port.execMode === "local"
          ? pairTool.handle(name, status, args, callId, extra)
          : emitTool(name, status, callId ?? `${name}_${Date.now().toString(36)}`, args,
              extra?.result == null ? undefined : typeof extra.result === "string" ? extra.result : JSON.stringify(extra.result));
      },
    };
    try {
      try {
        const out = await port.stream({ agentId, runId }, callbacks);
        result = out.result;
        if (out.sessionId) await this.support.setRunAgentId(runId, out.sessionId);
        try {
          costSummary = await this.usage.captureRunUsage({
            runRowId,
            result,
            runId,
            port,
            cloudAgentId: port.execMode === "cloud" ? agentId : undefined,
          });
        } catch (usageErr) {
          console.error("[agent-runner] usage capture failed", usageErr);
        }
      } catch (e) {
        streamError = e;
      } finally {
        stream.flushAll();
      }
    } finally {
      clearInterval(leaseHeartbeat);
      const runRowStatus = result?.status === RUN_STATUS.FINISHED ? RUN_STATUS.FINISHED : RUN_STATUS.ERROR;
      // api_token cleared with the run close (step 08): the agent is done —
      // its capability token must not outlive the run it was minted for.
      await this.database.run(
        `UPDATE runs SET status=$1, lease_until=NULL, api_token=NULL, updated_at=$2 WHERE run_ref=$3`,
        runRowStatus,
        this.database.now(),
        runId,
      );
    }

    if (streamError) throw streamError;
    if (!result) {
      throw new Error(`${label} ended without a result`);
    }

    const durationMs = costSummary.durationMs ?? result.durationMs ?? Date.now() - startedAt;
    if (costSummary.durationMs == null) {
      await this.usage.persistUsage(runRowId, { durationMs });
    }

    if (result.status !== RUN_STATUS.FINISHED) {
      await this.database.emitEvent(flow.id, nodeId, EVENT_KIND.ERROR, `${label} ended with ${result.status}`, { run_id: runId });
      throw new Error(`${label} ended with status ${result.status}`);
    }

    const ownsNodeStatus = options?.ownsNodeStatus !== false;
    if (ownsNodeStatus && startedWhileRunning && attemptAtStart) {
      const nodeNow = await this.database.get<{ attemptId: string | null; status: string }>(
        `SELECT attempt_id AS "attemptId", status FROM nodes WHERE id=$1`,
        nodeId,
      );
      if (nodeNow?.attemptId !== attemptAtStart) {
        await this.database.emitEvent(
          flow.id,
          nodeId,
          EVENT_KIND.LIFECYCLE,
          `${label} result arrived after the node was already ${nodeNow?.status ?? "unknown"} — ignoring`,
          { run_id: runId },
        );
        throw new RunSupersededError(nodeId, nodeNow?.status ?? "unknown", runId);
      }
    }

    await this.database.emitEvent(flow.id, nodeId, EVENT_KIND.LIFECYCLE, `${label} finished`, {
      run_id: runId,
      durationMs,
      tokens: costSummary.tokens,
      cost: costSummary.costCents != null ? Math.round(costSummary.costCents) / 100 : undefined,
      costCents: costSummary.costCents != null ? Math.round(costSummary.costCents) : undefined,
      estimated: costSummary.estimated || undefined,
      model: costSummary.model,
    });
    return { result, runRowId };
    } finally {
      if (port.hasActiveRun(runId)) {
        port.releaseActiveRun(runId);
      }
    }
  }
}

export const agentRunner = new AgentRunner(
  flowCtxHelper,
  nodeSupport,
  usageTracker,
  db,
  config,
  agentPortRegistry,
  worktreeManager,
);
