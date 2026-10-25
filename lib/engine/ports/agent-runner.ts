/**
 * Agent-runner port — the neutral surface engine + API code drives agents
 * through (cloud agent VMs, local in-process agent loops, future vendors).
 *
 * Concrete runtimes implement `AgentPort` in `lib/integrations/<vendor>/` and
 * register themselves in `agentPortRegistry` (composition point — the one
 * place concrete integrations are named on the engine side). The engine
 * selects the port by the flow's execution mode ("cloud" | "local").
 *
 * Both today's runtimes share one SDK runtime (lib/integrations/cursorSdk.ts),
 * so the normalized shapes below mirror what the SDK already emits:
 * statuses are "finished" | "error" | "cancelled"; usage carries token counts
 * and the billed cost when the runtime reports one.
 */
import { CursorCloudAgentPort } from "../../integrations/cursor/agent-port";
import { CursorLocalAgentPort } from "../../integrations/local-agent/agent-port";
import type { CatalogModel } from "../../modelSpec";

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
}

/** A streamed-to-completion run: result plus the local follow-up handle. */
export interface AgentStreamOutcome {
  result: AgentRunResult;
  /** the follow-up handle to persist (local session id) */
  sessionId?: string | null;
}

/** One agent runtime. */
export interface AgentPort {
  /** stable registry key, e.g. "cursor-cloud" */
  readonly kind: string;
  /** UI label, e.g. "Cursor cloud" */
  readonly label: string;
  /** the flow execution mode this port runs */
  readonly execMode: "cloud" | "local";
  /** the product surface that owns this port, e.g. "cursor" */
  readonly harness: string;
  /** model ids used when the catalog is unreachable (empty for cloud) */
  readonly fallbackModels: readonly string[];

  start(spec: AgentStartSpec): Promise<AgentStarted>;
  /** Stream a run to completion (re-attaching after a restart when durable). */
  stream(handle: AgentRunHandle, callbacks?: AgentStreamCallbacks): Promise<AgentStreamOutcome>;
  /** Terminal result for a run, or null while still in flight / unreachable. */
  getRun(handle: AgentRunHandle): Promise<AgentRunResult | null>;
  /** Stop an in-flight run (true when this process owned it). */
  cancel(handle: AgentRunHandle): Promise<boolean>;
  /** True when this process owns the given in-flight run (false after restart). */
  hasActiveRun(runId: string): boolean;
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

/**
 * The agent-port registry — mirrors `GitHostRegistry` (lib/engine/ports/
 * git-host.ts): adding a runtime = one adapter file + one `register()` line.
 */
export class AgentPortRegistry {
  private readonly registry = new Map<string, AgentPort>();

  constructor() {
    // Composition point: built-in adapters register here.
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
    const p = this.registry.get(kind);
    if (!p) throw new Error(`unknown agent port kind: ${kind}`);
    return p;
  }

  /** Get a port by kind, or undefined. */
  maybe(kind: string): AgentPort | undefined {
    return this.registry.get(kind);
  }

  /** All registered ports (registration order). */
  list(): AgentPort[] {
    return [...this.registry.values()];
  }

  /** The port backing a flow execution mode, or throw. */
  forMode(mode: "cloud" | "local"): AgentPort {
    const p = this.list().find((x) => x.execMode === mode);
    if (!p) throw new Error(`no agent runner configured for execution mode "${mode}"`);
    return p;
  }
}

/** The engine's agent-runtime seam. */
export const agentPortRegistry = new AgentPortRegistry();