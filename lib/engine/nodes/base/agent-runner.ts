import { config } from "../../../config";
import { db } from "../../../db";
import { cursorClient, type CursorRunResult } from "../../../integrations/cursor";
import { localAgent } from "../../../integrations/localAgent";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./flow-context";
import { nodeSupport, type NodeSupport } from "./node-support";
import { StreamBuffer } from "./stream-buffer";
import { ToolPairer, type ToolEmitFn } from "./tool-pairer";
import { usageTracker, type RunCostSummary, type UsageTracker } from "./usage-tracker";

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
}

/**
 * Starts and supervises agent runs on the configured runtime (Cursor cloud VM
 * or local in-process agent loop, both via the unified CursorAgentService over
 * @cursor/sdk): model resolution, run-row persistence, event streaming
 * (buffered), and usage/cost capture.
 */
export class AgentRunner {
  constructor(
    private readonly ctxHelper: FlowContextHelper,
    private readonly support: NodeSupport,
    private readonly usage: UsageTracker
  ) {}

  /** Start an agent run on the configured runtime (cloud VM or local agent loop). */
  async startAgent(ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    const mode = this.ctxHelper.execMode(ctx);
    // Model resolution: per-run selection → Settings default → DEFAULT_MODEL env.
    const requested =
      input.model?.trim() ||
      db.getSetting<string>("default_model", "") ||
      config.cursor.defaultModel();
    const model = requested && requested !== "auto" ? requested : undefined;
    if (mode === "local") {
      const workspace = input.cwd ?? this.ctxHelper.requireLocalPath(ctx);
      return localAgent.createRun({
        prompt: input.prompt,
        workspace,
        mode: input.mode,
        sessionId: input.followUpOn ?? undefined,
        branch: input.startingRef,
        model,
      });
    }
    if (input.followUpOn) {
      // Cloud follow-up runs inherit the agent's model.
      const r = await cursorClient.followUp(input.followUpOn, input.prompt, input.mode);
      return { agentId: input.followUpOn, runId: r.run.id as string };
    }
    const repos = ctx.flow.repo_url
      ? [{ url: ctx.flow.repo_url, startingRef: input.startingRef ?? ctx.repo?.default_branch ?? "main" }]
      : undefined;
    const created = await cursorClient.createAgent({
      prompt: input.prompt,
      mode: input.mode,
      repos,
      autoCreatePR: input.autoCreatePR ?? false,
      name: input.name,
      customSubagents: input.customSubagents,
      model,
    });
    return { agentId: created.agent.id as string, runId: created.run.id as string };
  }

  /**
   * Run an agent to completion: persist the run row, stream events, capture
   * usage/cost, and throw on a non-FINISHED terminal status.
   */
  async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string
  ): Promise<CursorRunResult> {
    const { flow } = ctx;
    const mode = this.ctxHelper.execMode(ctx);
    const startedAt = Date.now();
    const { agentId, runId } = await start();
    this.support.persistRun(flow.id, nodeId, agentId, runId);
    const runRowId = db.get<{ id: string }>(`SELECT id FROM runs WHERE cursor_run_id=?`, runId)?.id as string;
    db.emitEvent(flow.id, nodeId, "lifecycle", `${label} started (${mode})`, { agentId, runId, run_id: runId, mode });

    const stream = new StreamBuffer(flow.id, nodeId, runId);
    const emitTool: ToolEmitFn = (name, status, callId, args, result, startedAtMs) =>
      db.emitEvent(flow.id, nodeId, "tool", `${name}: ${status}`, {
        run_id: runId, callId, name, status,
        args: args != null ? JSON.stringify(args) : undefined,
        result,
        durationMs: startedAtMs != null ? Date.now() - startedAtMs : undefined,
      });
    const pairTool = new ToolPairer(emitTool);

    let result: CursorRunResult;
    let costSummary: RunCostSummary = {};
    // One streaming path for both runtimes: the SDK emits the same SDKMessage
    // events whether the agent runs locally or in a Cursor VM. Tool events go
    // through the pairer (local) so start/end are matched by callId; cloud tool
    // events arrive already paired, so they emit directly.
    const callbacks = {
      onStatus: (s: string) => db.emitEvent(flow.id, nodeId, "status", `run ${s}`, { run_id: runId }),
      onAssistant: (t: string) => stream.push("assistant", t),
      onThinking: (t: string) => stream.push("thinking", t),
      onTool: (name: string, status: string, args: unknown, callId: string | undefined, extra: { result?: unknown } | undefined) =>
        mode === "local"
          ? pairTool.handle(name, status, args, callId, extra)
          : emitTool(name, status, callId ?? `${name}_${Date.now().toString(36)}`, args,
              extra?.result == null ? undefined : typeof extra.result === "string" ? extra.result : JSON.stringify(extra.result)),
    };
    try {
      if (mode === "local") {
        const out = await localAgent.streamRun(runId, callbacks);
        result = out.result;
        if (out.sessionId) this.support.setRunAgentId(runId, out.sessionId);
      } else {
        result = await cursorClient.streamRun(agentId, runId, callbacks);
      }
      costSummary = await this.usage.captureRunUsage({
        runRowId,
        result,
        runId,
        cloudAgentId: mode === "cloud" ? agentId : undefined,
      });
    } finally {
      stream.flushAll();
    }

    const durationMs = costSummary.durationMs ?? result.durationMs ?? Date.now() - startedAt;
    if (costSummary.durationMs == null) {
      this.usage.persistUsage(runRowId, { durationMs });
    }

    db.run(`UPDATE runs SET status=?, updated_at=? WHERE cursor_run_id=?`,
      result.status === "finished" ? "finished" : "error", db.now(), runId);

    // Late-write guard: if the node was already moved out of `running` while
    // this run was in flight (reconcile failed it, user cancelled/retried),
    // don't let the run's completion resurrect the node or stamp a duplicate
    // artifact on top of the newer attempt. The run row is closed above; the
    // event explains why nothing else changed.
    const nodeNow = db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, nodeId);
    if (nodeNow?.status !== "running") {
      db.emitEvent(flow.id, nodeId, "lifecycle",
        `${label} result arrived after the node was already ${nodeNow?.status ?? "unknown"} — ignoring`,
        { run_id: runId });
      return result;
    }

    if (result.status !== "finished") {
      db.emitEvent(flow.id, nodeId, "error", `${label} ended with ${result.status}`, { run_id: runId });
      throw new Error(`${label} ended with status ${result.status}`);
    }
    db.emitEvent(flow.id, nodeId, "lifecycle", `${label} finished`, {
      run_id: runId,
      durationMs,
      tokens: costSummary.tokens,
      cost: costSummary.costCents != null ? Math.round(costSummary.costCents) / 100 : undefined,
      costCents: costSummary.costCents != null ? Math.round(costSummary.costCents) : undefined,
      estimated: costSummary.estimated || undefined,
      model: costSummary.model,
    });
    return result;
  }
}

export const agentRunner = new AgentRunner(flowCtxHelper, nodeSupport, usageTracker);
