import { z } from "zod";
import type { NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agent-runner";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./flow-context";
import { nodeSupport, type NodeSupport } from "./node-support";
import type { NodeCapabilities } from "./capabilities";
import type { ConfigField } from "../../node-config";
import { appLayerConfig, mergeConfigLayers } from "../../node-config";
import type { NodeRunStatus } from "../../../../constants/flow";

/** A role in the SDLC builtin chain (plan → build → review → resolve). */
export type ChainRole = "plan" | "build" | "review" | "resolve";

/**
 * What a node stores in its `output` column when it finishes a run.
 * Each node narrows this with its own schema.
 */
export interface RunOutcome {
  output: Record<string, unknown>;
  /** final node status — the closed set in `NODE_RUN_STATUS` (§2.7) */
  status: NodeRunStatus;
  /** artifact to save (kind + content + meta); nodes may save more themselves */
  artifact?: { kind: string; content: string; meta?: unknown };
  /** lifecycle event message */
  event: string;
  eventData?: Record<string, unknown>;
  /** text returned to chat callers */
  reply: string;
}

/**
 * One run inside an engine-triggered bundle (a single trigger may start
 * several runs — e.g. the sequential multi-branch build). Input is
 * parseInput-validated by the engine; before/after own the surrounding wiring.
 */
export interface NodeTriggerRun {
  input: unknown;
  /** runs before the node run (e.g. branch row → building) */
  before?: () => void;
  /** runs after the node run succeeded (e.g. branch row → awaiting_approval) */
  after?: () => void;
}

/**
 * A workflow node type. The class owns everything specific to the node:
 * input/output schemas, prompt building, the run itself, and restart
 * recovery. The orchestrator (flow.ts) only knows the registry.
 *
 * Shared infrastructure (row persistence, context facts) is injected as
 * services — pass your own instances to the constructor in tests. The agent
 * runner and the chat/preview affordances live on the roles/tier (§T4/T4b):
 * `AgentRunNode` for the run lifecycle, `base/node-roles.ts` for the role
 * interfaces they dispatch through.
 */
export abstract class NodeDefinition<I = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  /** stable node key, e.g. "plan" */
  abstract readonly key: string;
  /** UI label, e.g. "Plan" */
  abstract readonly label: string;
  /** prompt template keys this node uses (main first) */
  abstract readonly promptKeys: readonly string[];
  /**
   * The top-level, user-editable prompt sections this def owns — shown on
   * the settings page. Sub-keys consumed at run time (`plan_refine`, …)
   * live in `promptKeys` only.
   */
  readonly promptSections: readonly string[] = [];
  /** position in the workflow graph (ascending) */
  abstract readonly order: number;
  /** graph edges originating at this node: [target, kind] */
  readonly edges: readonly (readonly [string, "next" | "loop"])[] = [];
  /**
   * This kind opens a flow: it carries the template's start contract (what the
   * trigger payload must provide) and holds for the user when its contract has
   * fields. Engine code keys off this metadata, never the literal key.
   */
  readonly isEntry: boolean = false;

  /**
   * What the UI may do with this node (§3.2): chat refine support, the prompt
   * preview target, the panel title. Empty for nodes with no chat or
   * bespoke-panel affordances.
   */
  readonly capabilities: NodeCapabilities = {};

  // ── engine-dispatch metadata (§T3) — call sites key off these flags, never
  //    a literal built-in def key ────────────────────────────────────────────

  /**
   * This def's approval is NOT a generic `approveNode` action: plan refine and
   * build approval are built-in flow actions the UI routes to their own
   * endpoints (§T3/F2). Default false — a declarative node's hold IS the
   * generic approval.
   */
  readonly builtinApproval: boolean = false;

  /**
   * The role this def's kind occupies in the SDLC builtin chain (plan → build
   * → review → resolve) — the catalog handle engine lookups route through
   * instead of a literal def key (§T3/F1/F4). Null for defs with no chain role.
   */
  readonly chainRole: ChainRole | null = null;

  /**
   * Artifact kinds this def publishes that are first-class engine resources —
   * the plan document the plan editor and approvals consume (§T3/F3). The
   * engine scopes its resource queries through this instead of SQL-matching a
   * literal kind.
   */
  readonly resourceArtifacts: readonly string[] = [];

  /**
   * The event source this def's consumers wait on — the CI gate node's
   * trigger `wait_for` points at the pipeline source (§T3/F1). Null for defs
   * nothing waits on.
   */
  readonly waitForKind: string | null = null;

  /**
   * The addressable output fields (the configurator's Contract tab). Built-ins
   * publish their typed output schema; declarative kinds override with their
   * config-derived contract — the merged instance config participates, since
   * instance overrides add fields the catalog def lacks (§5).
   */
  outputContract(_def?: Record<string, unknown>): unknown {
    return z.toJSONSchema(this.outputSchema);
  }

  /**
   * A decision kind's choices ({label, description?, condition?}) for the
   * configurator / decision card — null for non-decision kinds.
   */
  choices(_def?: Record<string, unknown>): { label: string; description?: string; condition?: string }[] | null {
    return null;
  }

  /** strict schema for everything needed to execute a run */
  abstract readonly inputSchema: z.ZodType<I>;
  /** strict schema for the node's persisted `output` column */
  abstract readonly outputSchema: z.ZodType<O>;

  /** typed config knobs — `configFields` drives the auto-generated form (Phase 2) */
  readonly configFields: readonly ConfigField[] = [];
  /**
   * Declarative nodes declare no input contract: the run input is inherited
   * from the previous node's output (§3 — the flow's parent chain). The
   * engine seeds the auto-start input with the upstream `next`-edge sources'
   * merged outputs; `input_map` overlays explicit mappings on top.
   */
  readonly inheritsParentInput: boolean = false;
  /** typed config schema: `.parse({})` yields the class-layer defaults. Every knob's default equals today's behavior. */
  readonly configSchema: z.ZodTypeAny = z.object({}).strict();

  /** Whether this node can be retried from its recorded input. */
  readonly retryable: boolean = true;

  /** Shared services (constructor-injected; the singletons are the defaults).
   *  Tests override them by passing their own instances to the constructor.
   *  The agent runner is NOT here (§T4b): kinds whose runs go through it
   *  extend `AgentRunNode`, which owns the runner. */
  protected readonly support: NodeSupport;
  protected readonly ctxHelper: FlowContextHelper;

  constructor(
    support: NodeSupport = nodeSupport,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    this.support = support;
    this.ctxHelper = ctxHelper;
  }

  /**
   * Build the input for a run. `raw` comes from the orchestrator (UI action,
   * webhook, retry). Must be validated against inputSchema by the caller or
   * here — the base provides `parseInput`.
   */
  abstract run(ctx: FlowCtx, input: I, config: Record<string, unknown>): Promise<RunOutcome>;

  /** Class-layer config defaults (configSchema.parse({})). */
  defaultConfig(): Record<string, unknown> {
    try {
      const parsed = this.configSchema.safeParse({});
      return parsed.success ? (parsed.data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** The input used when the engine auto-starts a run (join satisfied / direct
   * trigger without an explicit payload). Default: `{}` — the node's input
   * schema fills in defaults. Nodes whose auto-run needs flow state (e.g. the
   * build pulls the approved plan) override this; those internals stay in the
   * node class, never in the engine. Nodes that start more than one run from a
   * single trigger (the multi-branch build) override `triggerRuns` instead.
   */
  triggerInput(ctx: FlowCtx): unknown {
    return {};
  }

  /**
   * The runs the engine performs when this node is auto-started. Default:
   * one run with `triggerInput`. Each run's input is `parseInput`-validated
   * by the engine; `before`/`after` hooks own the surrounding wiring (e.g.
   * branch-row status transitions).
   */
  triggerRuns(ctx: FlowCtx): NodeTriggerRun[] {
    return [{ input: this.triggerInput(ctx) }];
  }

  /**
   * Fan-out (§5): the child template id this def fans out to by default, or
   * null — the def auto-wraps itself ("a fallback default, not a hard
   * binding — every other node auto-wraps itself", spec §1). The fan-out
   * manager consults this instead of comparing the parent's def key to a
   * literal (§T3/F5).
   */
  childTemplateId(): string | null {
    return null;
  }

  /**
   * Effective config knobs for this node's handlers that don't receive a
   * config from the engine (chat follow-ups). Merges class defaults ←
   * app-settings layer ← the config snapshot from the flow's node row.
   */
  protected nodeConfig(ctx: FlowCtx): Record<string, unknown> {
    const node = this.node(ctx);
    return mergeConfigLayers(this.defaultConfig(), appLayerConfig(this.key), node.config);
  }

  /**
   * Finish a run that completed while the server was down.
   * Return true when the node was recovered, false to have it failed for retry.
   */
  abstract recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean>;

  // ── shared helpers available to subclasses ──────────────────────────────

  parseInput(raw: unknown): I {
    return this.inputSchema.parse(raw);
  }

  parseOutput(raw: unknown): O {
    return this.outputSchema.parse(raw);
  }

  node(ctx: FlowCtx): NodeRow {
    return this.support.nodeByKey(ctx.flow.id, this.key);
  }

  /**
   * Persist a run's full input blob. Retry fidelity: `retryNode` re-runs
   * `def.run()` from this record, and its recorded `prompt` field carries the
   * exact final prompt the run sent.
   */
  protected recordInput(nodeId: string, input: Record<string, unknown>): void {
    this.support.setNode(nodeId, { input: JSON.stringify(input) });
  }

  /**
   * THE one persistence path for a finished run: artifact, validated output,
   * final status + agent cursor, lifecycle event. Three callers finish through
   * this door so a node kind can never drift between them (§F8):
   *   - execute()'s tail (a normal in-process run),
   *   - no-run outcomes (decision manual/expression picks, http calls, script
   *     runs — they call this directly),
   *   - restart recover() impls (via the optional `note`, appended to the
   *     event so the trail explains the recovery).
   * A recovered finish therefore persists byte-identical node/artifact rows
   * to a normal finish — only the event message carries the recovery note.
   */
  protected applyOutcome(ctx: FlowCtx, outcome: RunOutcome, opts?: { note?: string }): RunOutcome {
    const node = this.node(ctx);
    if (outcome.artifact) {
      this.support.saveArtifact(node.id, ctx.flow.id, outcome.artifact.kind, outcome.artifact.content, outcome.artifact.meta);
    }
    const validatedOutput = this.outputSchema.parse(outcome.output);
    this.support.setNode(node.id, {
      status: outcome.status,
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(validatedOutput),
    });
    this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      opts?.note ? `${outcome.event} (${opts.note})` : outcome.event,
      outcome.eventData,
    );
    return { ...outcome, output: validatedOutput as Record<string, unknown> };
  }

  async makeDiff(ctx: FlowCtx, branch: string) {
    return this.ctxHelper.makeDiff(ctx, branch);
  }
}
