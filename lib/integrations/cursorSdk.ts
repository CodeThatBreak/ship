import {
  Agent,
  Cursor,
  type AgentOptions,
  type ModelSelection,
  type Run as SdkRun,
  type RunResult as SdkRunResult,
  type SDKAgent,
  type SDKMessage,
  type TokenUsage,
} from "@cursor/sdk";
import fs from "fs";
import { config } from "../config";
import { processSingleton } from "../singleton";

// ── shared vocabulary (SDK-native shapes, re-exported for the engine) ───────
export type { TokenUsage };
export type { ModelSelection };

/** App-wide run result = the SDK's RunResult verbatim. */
export type AgentRunResult = SdkRunResult;
/** Live SDK run handle. */
export type Run = SdkRun;

export interface StreamCallbacks {
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

export interface CreateRunInput {
  prompt: string;
  mode?: "agent" | "plan";
  name?: string;
  model?: ModelSelection;
  // local runtime
  cwd?: string; // local working dir (workspace or worktree override)
  sandbox?: boolean;
  force?: boolean;
  // cloud runtime
  cloud?: boolean;
  repos?: { url: string; startingRef?: string }[];
  autoCreatePR?: boolean;
  customSubagents?: { name: string; instructions: string }[];
  // resume an existing agent conversation (follow-up)
  resumeAgentId?: string;
}

/** A started run: durable ids plus the in-process streaming handle. */
export interface StartedRun {
  agentId: string;
  runId: string;
  agent: SDKAgent;
  run: Run;
}

const TERMINAL_STATUSES = new Set(["finished", "error", "cancelled"]);

/**
 * Unified Cursor agent integration: one service over the @cursor/sdk `Agent`
 * runtime that drives both local (in-process agent loop, files from disk) and
 * cloud (Cursor-hosted VM) runs behind a single streaming/usage/result path.
 *
 * Run handles are kept in-process keyed by runId so the engine can stream and
 * cancel. Run state after a restart comes from the SDK itself — cloud runs
 * are durable by id, local runs are re-read from the persisted local store.
 */
export class CursorAgentService {
  private runs = new Map<string, StartedRun>();

  private apiKey(): string {
    const key = config.cursor.apiKey();
    if (!key) throw new Error("CURSOR_API_KEY not set");
    return key;
  }

  /** True when the SDK can run at all (Node >= 22.13 and an API key is set). */
  available(): boolean {
    const [maj, min] = process.versions.node.split(".").map((n) => parseInt(n, 10));
    const nodeOk = maj > 22 || (maj === 22 && min >= 13);
    return nodeOk && Boolean(config.cursor.apiKey());
  }

  /** Models available to the authenticated account (null when unavailable). */
  async listModels(): Promise<string[] | null> {
    try {
      const models = await Cursor.models.list({ apiKey: this.apiKey() });
      const ids = models.map((m) => m.id).filter(Boolean);
      return ids.length ? ids : null;
    } catch {
      return null;
    }
  }

  /** True if this server process still owns the given run (false after restart). */
  hasActiveRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  // ── run lifecycle ─────────────────────────────────────────────────────────

  /**
   * Start (or resume) an agent run on the configured runtime. For local runs
   * the returned agentId is `agent-<uuid>`; for cloud runs `bc-<uuid>`.
   * The run's first `send()` is issued before returning, and the in-process
   * handle is registered so streamRun/cancelRun can reach it.
   */
  async createRun(
    input: CreateRunInput,
  ): Promise<{ agentId: string; runId: string }> {
    const apiKey = this.apiKey();
    const isCloud = input.cloud === true;

    if (!isCloud && input.cwd && !fs.existsSync(input.cwd)) {
      throw new Error(
        `Local path for this repo does not exist: ${input.cwd}. Fix it on the Settings page.`,
      );
    }

    let agent: SDKAgent;
    if (input.resumeAgentId) {
      // follow-up: resume the existing agent conversation, then send the prompt
      const resumeOpts: Partial<AgentOptions> = { apiKey };
      if (!isCloud && input.cwd) resumeOpts.local = { cwd: input.cwd };
      if (input.model) resumeOpts.model = input.model;
      agent = await Agent.resume(input.resumeAgentId, resumeOpts);
    } else {
      const opts: AgentOptions = { apiKey };
      if (input.name) opts.name = input.name;
      if (input.mode) opts.mode = input.mode;
      if (input.model) opts.model = input.model;
      if (isCloud) {
        opts.cloud = {
          repos: input.repos?.length ? input.repos : [],
          autoCreatePR: input.autoCreatePR ?? false,
        };
        if (input.customSubagents?.length) {
          opts.agents = Object.fromEntries(
            input.customSubagents
              .slice(0, 20)
              .map((s) => [s.name, { description: s.instructions, prompt: s.instructions }]),
          );
        }
      } else {
        opts.local = {
          cwd: input.cwd ?? process.cwd(),
          sandboxOptions: { enabled: input.sandbox ?? false },
        };
      }
      agent = await Agent.create(opts);
    }

    const run = await agent.send(input.prompt, {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(!isCloud && input.force ? { local: { force: true } } : {}),
    });

    const started: StartedRun = { agentId: agent.agentId, runId: run.id, agent, run };
    this.runs.set(run.id, started);
    return { agentId: agent.agentId, runId: run.id };
  }

  /** Cancel a live in-process run. No-op after restart (handle gone). */
  cancelRun(runId: string): boolean {
    const r = this.runs.get(runId);
    if (!r) return false;
    r.run.cancel().catch(() => {});
    return true;
  }

  /** Stream a run to completion, invoking callbacks per SDKMessage. */
  async streamRun(
    runId: string,
    cb: StreamCallbacks = {},
  ): Promise<{ result: AgentRunResult; agentId: string }> {
    const started = this.runs.get(runId);
    if (!started) throw new Error(`unknown run ${runId} (server restarted?)`);
    try {
      const result = await this.pumpRun(started.run, cb);
      return { result, agentId: started.agentId };
    } finally {
      this.runs.delete(runId);
      started.agent.close();
    }
  }

  /**
   * Stream an externally-obtained run handle (e.g. reconcile's re-attach) to
   * completion. Does not touch the in-process registry.
   */
  async pumpRun(run: Run, cb: StreamCallbacks = {}): Promise<AgentRunResult> {
    cb.onStatus?.("RUNNING");
    const done = run.wait();
    for await (const msg of run.stream()) {
      this.dispatch(msg, cb);
    }
    const result = await done;
    return result;
  }

  /** Map one SDKMessage onto the engine's stream callbacks. */
  private dispatch(msg: SDKMessage, cb: StreamCallbacks): void {
    switch (msg.type) {
      case "assistant":
        for (const block of msg.message.content) {
          if (block.type === "text") cb.onAssistant?.(block.text);
        }
        break;
      case "thinking":
        if (msg.text) cb.onThinking?.(msg.text);
        break;
      case "tool_call":
        cb.onTool?.(msg.name, msg.status, msg.args, msg.call_id, {
          result: msg.result,
          truncated: msg.truncated,
        });
        break;
      case "status":
        cb.onStatus?.(msg.status);
        break;
      default:
        // system / user / task / request / usage — not feed-worthy
        break;
    }
  }

  // ── inspection & recovery (reconcile) ─────────────────────────────────────

  /** Fetch a run's terminal result without streaming (cloud or local). */
  async getRun(agentId: string, runId: string, cwd?: string): Promise<AgentRunResult | null> {
    try {
      if (agentId.startsWith("bc-")) {
        const run = await Agent.getRun(runId, { runtime: "cloud", agentId, apiKey: this.apiKey() });
        if (run.status === "running") return null; // still going
        return await run.wait();
      }
      const run = await Agent.getRun(runId, { runtime: "local", cwd });
      if (run.status === "running") return null;
      return await run.wait();
    } catch {
      return null;
    }
  }

  /**
   * Re-attach to a run that is still in flight (cloud re-stream after restart),
   * or null when it already reached a terminal state. The returned handle can
   * be pumped via pumpRun.
   */
  async reattachRun(agentId: string, runId: string, cwd?: string): Promise<Run | null> {
    try {
      if (agentId.startsWith("bc-")) {
        const run = await Agent.getRun(runId, { runtime: "cloud", agentId, apiKey: this.apiKey() });
        return run.status === "running" ? run : null;
      }
      const run = await Agent.getRun(runId, { runtime: "local", cwd });
      return run.status === "running" && run.supports("stream") ? run : null;
    } catch {
      return null;
    }
  }

  /**
   * Reconstruct whether a finished local agent's last turn completed, and its
   * final assistant text, from the persisted store. Used by reconcile after a
   * server restart to recover orphaned local nodes. Returns null when the
   * agent/run can't be loaded.
   */
  async inspectLocalRun(
    agentId: string,
    runId: string,
    cwd: string,
  ): Promise<{ completed: boolean; text: string } | null> {
    if (!fs.existsSync(cwd)) return null;
    try {
      const run = await Agent.getRun(runId, { runtime: "local", cwd });
      if (run.status === "running") return { completed: false, text: "" };
      if (!TERMINAL_STATUSES.has(run.status)) return null;
      const result = await run.wait();
      return {
        completed: run.status === "finished",
        text: result.result ?? "",
      };
    } catch {
      return null;
    }
  }

  // ── usage / cost ──────────────────────────────────────────────────────────

  /**
   * Billed token usage + cost for a single run. Cloud agents only (the backend
   * keys usage by `run-<uuid>`); local runs report token counts on the run
   * result instead. Returns null when unavailable.
   */
  async getRunUsage(
    agentId: string,
    runId: string,
  ): Promise<{ usage: TokenUsage; cost?: { rawCostCents: number; chargedCents: number } } | null> {
    try {
      const res = await Agent.getUsage(agentId, { apiKey: this.apiKey(), runId });
      const entry = res.runs.find((r) => r.runId === runId) ?? res.runs[0];
      if (!entry) return res.usage ? { usage: res.usage, cost: res.cost } : null;
      return { usage: entry.usage, cost: entry.cost ?? res.cost };
    } catch {
      return null;
    }
  }
}

export const cursorAgent = processSingleton(
  "cursorAgent",
  () => new CursorAgentService(),
);
