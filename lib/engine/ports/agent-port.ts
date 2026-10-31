import "server-only";

/**
 * Agent-runner port — the neutral surface engine + API code drives agents
 * through (cloud agent VMs, local in-process agent loops, future vendors).
 *
 * Concrete runtimes implement `AgentPort` in `lib/integrations/<vendor>/` and
 * register themselves in `agentPortRegistry` (composition point — the one
 * place concrete integrations are named on the engine side). The engine
 * selects the port by the flow's execution mode ("cloud" | "local"),
 * preferring the port of the configured default harness when several ports
 * share that mode.
 *
 * Both today's runtimes share one SDK runtime (lib/integrations/cursorSdk.ts),
 * so the normalized shapes below mirror what the SDK already emits:
 * statuses are "finished" | "error" | "cancelled"; usage carries token counts
 * and the billed cost when the runtime reports one.
 */
import { db } from "../../db";
import { settingString } from "../../schemas/setting-values";
import { CursorCloudAgentPort } from "../../integrations/cursor/agent-port";
import { CursorLocalAgentPort } from "../../integrations/local-agent/agent-port";
import type { AgentRunLookupError } from "./agent-errors";
export type { AgentRunLookupError, AgentRunTimeoutError, AgentRunWorkspaceError } from "./agent-errors";
import type { CatalogModel } from "../../modelSpec";
import type { SettingSource } from "../templates/node-config";

export type { SettingSource };

export type { CatalogModel };

/** Stream/event callbacks a run's consumer receives (SDK message shapes). */
export interface AgentStreamCallbacks {
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

/** Per-run token usage + billed cost, normalized. All fields optional. */
export interface AgentRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cost?: { rawCostCents?: number; chargedCents?: number };
  model?: string;
}

/** A terminal (or probeable) run result, normalized. */
export interface AgentRunResult {
  /** "finished" | "error" | "cancelled" */
  status: string;
  result?: string;
  /** the follow-up handle (local agent session id) */
  sessionId?: string | null;
  durationMs?: number;
  model?: { id: string } | null;
  usage?: AgentRunUsage | null;
  /** host-native id where the runtime carries one */
  id?: string;
  /** git facts reported by the runtime (branches pushed, repo info) */
  git?: { branches?: { branch?: string }[] } | null;
}

/** A started run: the durable ids the engine persists on the run row. */
export interface AgentStarted {
  agentId: string;
  runId: string;
}

/** Where a run's events/results are addressed — durable across restarts (cloud). */
export interface AgentRunHandle {
  /** durable agent/conversation id (cloud agent id / local session id) */
  agentId?: string | null;
  runId: string;
}

/**
 * Start-a-run spec, normalized (ports use the fields relevant to them).
 * Model resolution (per-run → settings default → DEFAULT_MODEL) stays
 * engine-side; the port receives the resolved id/spec string.
 */
export interface AgentStartSpec {
  prompt: string;
  /** "agent" = full run, "plan" = read-only planning run */
  mode?: "agent" | "plan";
  name: string;
  /** resolved model id/spec — null/undefined = the runtime's default */
  model?: string | null;
  /** agent/session id to continue (follow-up run) */
  followUpOn?: string | null;
  /** branch/ref to start from (cloud repo startingRef / local checkout) */
  startingRef?: string;
  // cloud-shaped inputs
  repos?: { url: string; startingRef?: string }[];
  autoCreatePR?: boolean;
  customSubagents?: { name: string; instructions: string }[];
  // local-shaped inputs
  /** local workspace root (the flow's registered local path) */
  workspace?: string;
  /** local worktree/cwd override */
  cwd?: string;
  /**
   * MCP/setting layers the local runtime loads ambient MCP servers from
   * (Cursor SDK `local.settingSources`). Empty/undefined = the SDK default
   * (inline servers only). Local-run only — cloud runtimes always load
   * project/team/plugins plus dashboard servers.
   */
  settingSources?: SettingSource[];
}

/** A streamed-to-completion run: result plus the local follow-up handle. */
export interface AgentStreamOutcome {
  result: AgentRunResult;
  /** the follow-up handle to persist (local session id) */
  sessionId?: string | null;
}

/** Outcome of probing a durable run (cloud reconcile / stream fallback). */
export type AgentRunQuery =
  | { state: "running" }
  | { state: "terminal"; result: AgentRunResult }
  | { state: "unavailable"; error: AgentRunLookupError };

/** A single rate-card entry: USD per million tokens (token-cost estimates). */
export interface PricingEntry {
  input_per_mtok?: number;
  output_per_mtok?: number;
  cache_read_per_mtok?: number;
  cache_write_per_mtok?: number;
}

/** One agent runtime. */
export interface AgentPort {
  /** stable registry key, e.g. "cursor-cloud" */
  readonly kind: string;
  /** UI label, e.g. "Cursor cloud" */
  readonly label: string;
  /** the flow execution mode this port runs */
  readonly execMode: "cloud" | "local";
  /**
   * the product surface that owns this port, e.g. "cursor" — the key
   * `forMode` matches against the `default_harness` selection within a mode
   */
  readonly harness: string;
  /** model ids used when the catalog is unreachable (empty for cloud) */
  readonly fallbackModels: readonly string[];
  /**
   * Fraction off the rate card's list prices that this vendor's billing
   * agreement applies (e.g. an enterprise-plan discount) — the engine's
   * token-based cost estimate multiplies by (1 - this). 0 = list price.
   * Billed charges from getUsage are used as-is, never discounted.
   */
  readonly listDiscount: number;
  /**
   * This vendor's rate-card corrections that the public pricing source
   * (PricingSource) doesn't track — keyed by model id. Undefined = none.
   * The cost estimator merges them over the fetched table (overrides win).
   */
  readonly rateOverrides?: Record<string, PricingEntry>;

  start(spec: AgentStartSpec): Promise<AgentStarted>;
  /** Stream a run to completion (re-attaching after a restart when durable). */
  stream(handle: AgentRunHandle, callbacks?: AgentStreamCallbacks): Promise<AgentStreamOutcome>;
  /** Probe a durable run: in flight, terminal, or failed lookup. */
  getRun(handle: AgentRunHandle): Promise<AgentRunQuery>;
  /** Stop an in-flight run (true when cancel was issued). */
  cancel(handle: AgentRunHandle): Promise<boolean>;
  /** True when this process owns the given in-flight run (false after restart). */
  hasActiveRun(runId: string): boolean;
  /** Drop an in-process handle without streaming (leak guard when start() never streams). */
  releaseActiveRun(runId: string): void;
  /** Billed per-run usage — null when the runtime doesn't report one. */
  getUsage(handle: AgentRunHandle): Promise<AgentRunUsage | null>;
  /**
   * Restart-recovery probe from persisted state (local runtimes): whether the
   * last turn finished and its assistant text. Null when it can't be loaded.
   */
  inspectSession(sessionId: string, runId: string, workspace: string): Promise<{ completed: boolean; text: string } | null>;
  /** Model catalog (structured) or null when unreachable. */
  listCatalog(): Promise<CatalogModel[] | null>;
  /** Settings-page status: is this runtime usable at all? */
  status(): Promise<{ configured: boolean; detail?: string }>;
}

/** The user-selected default harness (the `default_harness` setting), or
 *  null — unset/empty means "no preference" and {@link AgentPortRegistry.forMode}
 *  falls back to the first port registered for the mode. Read per selection so
 *  a settings change takes effect without a restart. */
function defaultHarnessSetting(): string | null {
  return db.getSetting("default_harness", settingString, "") || null;
}

/**
 * The agent-port registry — mirrors `GitHostRegistry` (lib/engine/ports/
 * git-host.ts): adding a runtime = one adapter file + one `register()` line.
 * Several ports may share an execution mode (one per harness): selection
 * prefers the port of the harness chosen on the Settings page
 * (`default_harness`), so a later-integrated harness takes over a mode
 * without touching the engine.
 */
export class AgentPortRegistry {
  private readonly registry = new Map<string, AgentPort>();
  private builtinsReady = false;

  constructor(
    /**
     * Resolves the configured default harness key, or null for "no
     * preference". Tests inject their own (and disable the builtins) to keep
     * the DB isolated.
     */
    private readonly resolveDefaultHarness: () => string | null = defaultHarnessSetting,
    private readonly withBuiltins = true,
  ) {}

  private ensureBuiltins(): void {
    if (!this.withBuiltins || this.builtinsReady) return;
    this.builtinsReady = true;
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.register(new CursorCloudAgentPort());
    this.register(new CursorLocalAgentPort());
  }

  register(port: AgentPort): void {
    if (this.registry.has(port.kind)) {
      throw new Error(`duplicate agent port kind: ${port.kind}`);
    }
    this.registry.set(port.kind, port);
  }

  /** Get a port by kind, or throw. */
  get(kind: string): AgentPort {
    this.ensureBuiltins();
    const p = this.registry.get(kind);
    if (!p) throw new Error(`unknown agent port kind: ${kind}`);
    return p;
  }

  /** Get a port by kind, or undefined. */
  maybe(kind: string): AgentPort | undefined {
    this.ensureBuiltins();
    return this.registry.get(kind);
  }

  /** All registered ports (registration order). */
  list(): AgentPort[] {
    this.ensureBuiltins();
    return [...this.registry.values()];
  }

  /**
   * The port backing a flow execution mode. When the configured default
   * harness (`default_harness`) registers a port for the mode, that port
   * wins; otherwise the first registered port for the mode (today's
   * single-harness installs see no change). Unknown/unregistered keys fall
   * back too, so a stale setting can never hard-fail a run.
   */
  forMode(mode: "cloud" | "local"): AgentPort {
    this.ensureBuiltins();
    const harness = this.resolveDefaultHarness();
    const chosen = (harness
      ? this.list().find((x) => x.harness === harness && x.execMode === mode)
      : undefined) ?? this.list().find((x) => x.execMode === mode);
    if (!chosen) {
      throw new Error(`no agent runner configured for execution mode "${mode}"`);
    }
    return chosen;
  }
}

/** The engine's agent-runtime seam. */
export const agentPortRegistry = new AgentPortRegistry();