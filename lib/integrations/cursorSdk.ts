import "server-only";

import {
  Agent,
  Cursor,
  type AgentOptions,
  type ModelSelection,
  type Run as SdkRun,
  type RunResult as SdkRunResult,
  type SDKAgent,
  type SDKModel,
  type SettingSource as SdkSettingSource,
  type TokenUsage,
} from "@cursor/sdk";
import fs from "fs";
import { FAST_OFF, FAST_ON, FAST_PARAM } from "../../constants/models";
import { pinnedProcessService } from "../composition/processServices";
import { cursorCredentials } from "./cursor/credentials";
import { AgentRunLookupError } from "../engine/ports/agentErrors";
import type { AgentRunQuery } from "../engine/ports/agentPort";
import { dispatchSdkMessage, type StreamCallbacks } from "./utils/sdkMessageDispatch";

// ── shared vocabulary (SDK-native shapes, re-exported for the engine) ───────
export type { TokenUsage };
export type { ModelSelection };
/**
 * The SDK's `SettingSource` (`local.settingSources`) — the ambient config
 * layers (and their MCP servers) a local agent may load. The engine mirrors
 * the same string union in `lib/engine/templates/node-config.ts` (`SETTING_SOURCES`):
 * both are compile-checked string literals, so adding a source means touching
 * both. Kept SDK-shaped in this file, engine-shaped there.
 */
export type SDKSettingSource = SdkSettingSource;

/** App-wide run result = the SDK's RunResult verbatim. */
export type AgentRunResult = SdkRunResult;
/** Live SDK run handle. */
export type Run = SdkRun;

export interface CreateRunInput {
  prompt: string;
  mode?: "agent" | "plan";
  name?: string;
  model?: ModelSelection;
  repos?: { url: string; startingRef?: string }[];
  autoCreatePR?: boolean;
  customSubagents?: { name: string; instructions: string }[];
  // cloud runtime — per-run env vars injected into the agent's shell (step 08:
  // the agent-tools capability token). SDK `cloud.envVars` — encrypted at
  // rest, deleted with the agent.
  envVars?: Record<string, string>;
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
 * Cloud Cursor agent integration: one service over the @cursor/sdk `Agent`
 * cloud runtime. It also carries the shared, shell-free surfaces every port
 * needs — the model catalog (with fast-mode pinning), Node/key availability,
 * the persisted local-session probe (`inspectLocalRun`) for local-run
 * recovery, and usage reporting.
 *
 * Cloud run handles are kept in-process keyed by runId so the engine can
 * stream and cancel. Local runs are NOT started here — they run one agent
 * host child process per run (`lib/integrations/localAgent/host/`), and
 * their recovery reads the SDK's persisted local store via `inspectLocalRun`.
 */
export class CursorAgentService {
  private runs = new Map<string, StartedRun>();

  /** Catalog cache TTL — fresh enough for param changes, rare enough to be cheap. */
  private static readonly MODEL_TTL_MS = 10 * 60 * 1000;
  private modelCache: { at: number; models: SDKModel[] } | null = null;

  /** The stored Cursor API key — public so the local path can hand it to its child process. */
  async apiKey(): Promise<string> {
    const key = await cursorCredentials.apiKey();
    if (!key) throw new Error("Cursor API key not set — add it in Settings → Integrations → Harness");
    return key;
  }

  /** True when the SDK can run at all (Node >= 22.13 and an API key is set). */
  async available(): Promise<boolean> {
    const [maj, min] = process.versions.node
      .split(".")
      .map((n) => parseInt(n, 10));
    const nodeOk = maj > 22 || (maj === 22 && min >= 13);
    return nodeOk && (await cursorCredentials.isStored());
  }

  /** Models available to the authenticated account (null when unavailable). */
  async listModels(): Promise<string[] | null> {
    const catalog = await this.listCatalog();
    if (!catalog) return null;
    const ids = catalog.map((m) => m.id).filter(Boolean);
    return ids.length ? ids : null;
  }

  /**
   * Full model catalog (id, displayName, parameters, variants) with the raw
   * names for UI grouping. Cached for MODEL_TTL_MS so hot paths (chat panel
   * mount, settings page, polling loops) don't hit Cursor.models.list
   * repeatedly; on errors the last known catalog is served until it expires.
   */
  async listCatalog(): Promise<SDKModel[] | null> {
    const now = Date.now();
    if (
      this.modelCache &&
      now - this.modelCache.at < CursorAgentService.MODEL_TTL_MS
    ) {
      return this.modelCache.models;
    }
    try {
      const models = await Cursor.models.list({ apiKey: await this.apiKey() });
      if (models?.length) {
        this.modelCache = { at: now, models };
        return models;
      }
    } catch {
      /* fall through to cache/fallback */
    }

    return this.modelCache?.models ?? null;
  }

  /** True if this server process still owns the given run (false after restart). */
  hasActiveRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  // ── run lifecycle ─────────────────────────────────────────────────────────

  /**
   * Resolve a model selection with fast mode pinned OFF on a model the
   * catalog declares as fast-capable — public so the local agent path can
   * resolve the selection in the parent before handing it to its child.
   *
   * The SDK passes ModelSelection params verbatim — an unstated `fast` falls
   * through to the account's default variant, which is fast=true for composer
   * models. An explicit fast value already on the selection wins (fast=true
   * stays an opt-in, fast=false is already the pick); a malformed fast value
   * (valueless `composer-2.5[fast]`, unknown value) is swept and replaced.
   * The pin only applies when the catalog confirms the parameter — an unknown
   * param fails the SDK's local model validation — and is skipped when the
   * catalog is unreachable, passing the selection through rather than failing
   * the run.
   */
  async resolveModel(model: ModelSelection): Promise<ModelSelection> {
    const fastValue = model.params?.find((p) => p.id.trim() === FAST_PARAM)?.value.trim();
    if (fastValue === FAST_ON || fastValue === FAST_OFF) return model;
    const catalog = await this.listCatalog();
    const entry = catalog?.find(
      (m) => m.id === model.id || (m.aliases ?? []).includes(model.id),
    );
    const declaresFast = !!entry && (
      Boolean(entry.parameters?.some((p) => p.id.trim() === FAST_PARAM)) ||
      (entry.variants ?? []).some((v) => v.params.some((p) => p.id.trim() === FAST_PARAM))
    );
    if (!declaresFast) return model;
    return {
      ...model,
      params: [
        ...(model.params ?? []).filter((p) => p.id.trim() !== FAST_PARAM),
        { id: FAST_PARAM, value: FAST_OFF },
      ],
    };
  }

  /**
   * Start (or resume) a CLOUD agent run. For runs the returned agentId is
   * `bc-<uuid>`. The run's first `send()` is issued before returning, and the
   * in-process handle is registered so streamRun/cancelRun can reach it.
   * Local runs live behind the per-run agent host child process instead
   * (`lib/integrations/localAgent/host/localAgentHost.ts`).
   */
  async createRun(
    input: CreateRunInput,
  ): Promise<{ agentId: string; runId: string }> {
    const apiKey = await this.apiKey();
    // fast mode defaults OFF — pinned before the selection reaches the
    // runtime (the SDK would otherwise fall through to the fast variant)
    const model = input.model ? await this.resolveModel(input.model) : undefined;

    let agent: SDKAgent;
    if (input.resumeAgentId) {
      // follow-up: resume the existing agent conversation, then send the prompt
      const resumeOpts: Partial<AgentOptions> = { apiKey };
      if (model) resumeOpts.model = model;
      agent = await Agent.resume(input.resumeAgentId, resumeOpts);
    } else {
      const opts: AgentOptions = { apiKey };
      if (input.name) opts.name = input.name;
      if (input.mode) opts.mode = input.mode;
      if (model) opts.model = model;
      opts.cloud = {
        repos: input.repos?.length ? input.repos : [],
        autoCreatePR: input.autoCreatePR ?? false,
        // per-run env vars (step 08: the agent-tools capability token) —
        // SDK cloud.envVars; omitted when unset so default runs are unchanged
        ...(input.envVars && Object.keys(input.envVars).length ? { envVars: input.envVars } : {}),
      };
      if (input.customSubagents?.length) {
        opts.agents = Object.fromEntries(
          input.customSubagents
            .slice(0, 20)
            .map((s) => [
              s.name,
              { description: s.instructions, prompt: s.instructions },
            ]),
        );
      }
      agent = await Agent.create(opts);
    }

    const run = await agent.send(input.prompt, {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(model ? { model } : {}),
    });

    const started: StartedRun = {
      agentId: agent.agentId,
      runId: run.id,
      agent,
      run,
    };
    this.runs.set(run.id, started);
    return { agentId: agent.agentId, runId: run.id };
  }

  /** Cancel a live in-process run, or a cloud run after restart (by durable id). */
  async cancelRun(runId: string, agentId?: string): Promise<boolean> {
    const r = this.runs.get(runId);
    if (r) {
      await r.run.cancel().catch(() => {});
      this.releaseRun(runId);
      return true;
    }
    if (!agentId?.startsWith("bc-")) return false;
    try {
      const run = await Agent.getRun(runId, {
        runtime: "cloud",
        agentId,
        apiKey: await this.apiKey(),
      });
      if (run.status !== "running") return false;
      await run.cancel();
      return true;
    } catch {
      return false;
    }
  }

  /** Drop an in-process handle and close the SDK agent (idempotent). */
  releaseRun(runId: string): void {
    const started = this.runs.get(runId);
    if (!started) return;
    this.runs.delete(runId);
    started.agent.close();
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
      this.releaseRun(runId);
    }
  }

  /**
   * Stream an externally-obtained run handle (e.g. reconcile's re-attach) to
   * completion. Does not touch the in-process registry.
   */
  async pumpRun(run: Run, cb: StreamCallbacks = {}): Promise<AgentRunResult> {
    cb.onStatus?.("RUNNING");
    const done = run.wait();
    try {
      for await (const msg of run.stream()) {
        dispatchSdkMessage(msg, cb);
      }
      return await done;
    } finally {
      await done.catch(() => {});
    }
  }

  // ── inspection & recovery (reconcile) ─────────────────────────────────────

  /** Fetch a run's terminal result without streaming (cloud or local). */
  async getRun(
    agentId: string,
    runId: string,
    cwd?: string,
  ): Promise<AgentRunQuery> {
    try {
      if (agentId.startsWith("bc-")) {
        const run = await Agent.getRun(runId, {
          runtime: "cloud",
          agentId,
          apiKey: await this.apiKey(),
        });
        if (run.status === "running") return { state: "running" };
        return { state: "terminal", result: await run.wait() };
      }
      const run = await Agent.getRun(runId, { runtime: "local", cwd });
      if (run.status === "running") return { state: "running" };
      return { state: "terminal", result: await run.wait() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        state: "unavailable",
        error: new AgentRunLookupError(
          `Could not load run ${runId}: ${message}`,
          runId,
          agentId,
        ),
      };
    }
  }

  /**
   * Re-attach to a run that is still in flight (cloud re-stream after restart),
   * or null when it already reached a terminal state. The returned handle can
   * be pumped via pumpRun.
   */
  async reattachRun(
    agentId: string,
    runId: string,
    cwd?: string,
  ): Promise<Run | null> {
    try {
      if (agentId.startsWith("bc-")) {
        const run = await Agent.getRun(runId, {
          runtime: "cloud",
          agentId,
          apiKey: await this.apiKey(),
        });
        return run.status === "running" ? run : null;
      }
      const run = await Agent.getRun(runId, { runtime: "local", cwd });
      return run.status === "running" && run.supports("stream") ? run : null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new AgentRunLookupError(
        `Could not re-attach to run ${runId}: ${message}`,
        runId,
        agentId,
      );
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
  ): Promise<{
    usage: TokenUsage;
    cost?: { rawCostCents: number; chargedCents: number };
  } | null> {
    try {
      const res = await Agent.getUsage(agentId, {
        apiKey: await this.apiKey(),
        runId,
      });
      const entry = res.runs.find((r) => r.runId === runId) ?? res.runs[0];
      if (!entry)
        return res.usage ? { usage: res.usage, cost: res.cost } : null;
      return { usage: entry.usage, cost: entry.cost ?? res.cost };
    } catch {
      return null;
    }
  }

}

/**
 * Shared agent service — process-pinned via the process-services container
 * (decision Q9): `runs` holds the live in-process run handles the engine
 * streams and cancels against; per-module-graph copies would disagree about
 * which runs this process still owns.
 */
export const cursorAgent = pinnedProcessService(
  "cursorAgent",
  () => new CursorAgentService(),
);
