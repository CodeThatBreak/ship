import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agentPort";
import { flowCtxHelper } from "./runContext";
import type { FlowContextHelper } from "./runContext/flowContextHelper";
import type { FlowCtx } from "./runContext/types/flowContext";
import type { NodeSupport } from "./nodeSupport";
import { nodeSupport } from "@/lib/composition/container";import type { SplitUnit } from "./split";
import type { NodeCapabilities } from "./capabilities";
import type { ConfigField } from "../../templates/nodeConfig";
import { appLayerConfig, mergeConfigLayers, parseConfigSnapshot } from "../../templates/nodeConfig";
import { NODE_RUN_STATUS } from "../../../../constants/flow";
import { EVENT_KIND } from "../../constants/vocabulary";
import { NODE_DEFINITION_BRAND } from "./nodeDefinitionGuard";
import { RunSupersededError } from "../../errors/runSupersededError";
import type { RecoveryResult } from "./types/recovery";
import type { ToolDescriptor } from "../../agentTools/types/tools";
import { formatZodConfigError } from "./utils/formatZodConfigError";
import type { ChainRole } from "./types/chainRole";
import type { RunOutcome } from "./types/runOutcome";
import type { NodeTriggerRun } from "./types/nodeTriggerRun";
import { persistRunFacts } from "./nodeOutcomeFacts";

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
  /**
   * HMR-stable brand (value from `nodeDefinitionGuard.ts`). `instanceof`
   * cannot be trusted across dev-server module-graph re-evaluations (a
   * hot-reloaded route gets a fresh class copy, while the `globalThis`-pinned
   * kind registry still holds instances built by the previous copy) —
   * cross-boundary checks use `isNodeDefinition`, which compares this brand.
   */
  static readonly IS_NODE_DEFINITION = NODE_DEFINITION_BRAND;
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

  /** The tools this kind's agent may call (step 08, Invariant 10) — the
   *  allowlist the service enforces and the prompt tools block's source. */
  agentTools(): ToolDescriptor[] {
    return [];
  }

  /**
   * The node's own declared engine-tool set (task 13, Invariant 10) — the
   * per-node `agent_tools` config the service intersects with `agentTools()`.
   * Null = the kind has no per-node tool config, so the kind's allowlist
   * governs alone (today's behavior, byte-for-byte). A declared set can only
   * NARROW the kind's allowlist — the service enforces the intersection.
   */
  declaredAgentTools(): readonly ToolDescriptor["name"][] | null {
    return null;
  }

  /**
   * The addressable output fields (the configurator's Contract tab). Built-ins
   * publish their typed output schema; declarative kinds override with their
   * config-derived contract — the merged instance config participates, since
   * instance overrides add fields the catalog def lacks (§5).
   */
  outputContract(_def?: Record<string, unknown>): unknown {
    void _def;
    return z.toJSONSchema(this.outputSchema);
  }

  /**
   * A decision kind's choices ({label, description?, condition?}) for the
   * configurator / decision card — null for non-decision kinds.
   */
  choices(_def?: Record<string, unknown>): { label: string; description?: string; condition?: string }[] | null {
    void _def;
    return null;
  }

  /** strict schema for everything needed to execute a run */
  abstract readonly inputSchema: z.ZodType<I>;
  /** strict schema for the node's persisted `output` column */
  abstract readonly outputSchema: z.ZodType<O>;

  /** The upstream fields this node needs in its materialized stage-start input
   *  (Invariant 5): the ContractPipeline validates the materialized input at
   *  stage start; failure ⇒ typed `input_contract_violation` naming the field
   *  and the producing node. Default empty; declarative kinds declare their
   *  needs through the template node's `input_map` targets (same seam). */
  readonly consumes: z.ZodType<Record<string, unknown>> = z.object({});

  /** typed config knobs — `configFields` drives the auto-generated form (Phase 2) */
  readonly configFields: readonly ConfigField[] = [];
  /** Declarative nodes declare no input contract: the run input is inherited
   *  from the previous node's output (§3); the engine seeds the auto-start
   *  input with the upstream `next`-edge sources' merged outputs, `input_map`
   *  overlays explicit mappings. */
  readonly inheritsParentInput: boolean = false;
  /** typed config schema: `.parse({})` yields the class-layer defaults. Every knob's default equals today's behavior. */
  readonly configSchema: z.ZodTypeAny = z.object({}).strict();

  /** Whether this node can be retried from its recorded input. */
  readonly retryable: boolean = true;

  /** The bounded feedback-retry budget the agent-output pipeline spends on
   *  retryable contract misses (`no_json` / `schema_mismatch`) — step 05,
   *  Invariant 6. 0 = validation-only: the first miss is terminal (the kind
   *  maps it to a failed outcome itself; there is no feedback turn). */
  readonly retryBudget: number = 1;

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
  triggerInput(_ctx: FlowCtx): unknown {
    void _ctx;
    return {};
  }

  /**
   * The runs the engine performs when this node is auto-started. Default:
   * one run with `triggerInput`. Each run's input is `parseInput`-validated
   * by the engine; `before`/`after` hooks own the surrounding wiring (e.g.
   * branch-row status transitions).
   */
  async triggerRuns(ctx: FlowCtx): Promise<NodeTriggerRun[]> {
    return [{ input: this.triggerInput(ctx) }];
  }

  // ── split source port (agent-node split plan §2.1) — default null = the
  //    node is not a split source; zero behavior change until a def overrides ──

  /**
   * The units this node's run publishes from its output, or null when the
   * node is not a split source. The producer only answers "here are my
   * units" — it never spawns anything (§2.1); the split runtime (Phase 2)
   * owns expansion/scheduling/join.
   */
  async splitUnits(_ctx: FlowCtx): Promise<SplitUnit[] | null> {
    void _ctx;
    return null;
  }

  /**
   * The source's published resolution recommendation, honored only by
   * consumers whose `split_consume` knob is `source` (§2.4). Null = no
   * recommendation (a `source` consumer then falls back to `whole`).
   */
  async splitResolution(_ctx: FlowCtx): Promise<"whole" | "per-unit" | null> {
    void _ctx;
    return null;
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
  protected async nodeConfig(ctx: FlowCtx): Promise<Record<string, unknown>> {
    const node = await this.node(ctx);
    // `nodeByKey` returns the RAW row (db.get does not map): the `config`
    // column is the JSON TEXT blob here, not the mapped NodeRow shape —
    // parse the snapshot before merging (merging it raw spread char-index
    // keys over the config and silently lost every snapshot knob).
    const raw: unknown = node.config;
    const snapshot = typeof raw === "string"
      ? parseConfigSnapshot(raw)
      : parseConfigSnapshot(JSON.stringify(raw ?? null));
    return mergeConfigLayers(this.defaultConfig(), await appLayerConfig(this.key), snapshot);
  }

  /**
   * Finish a run that completed while the server was down — the fixed
   * recovery ABI (Invariant 4, step 05): `{ kind: "recovered" }` after a
   * terminal outcome (the impl builds a {@link RunOutcome} and the base
   * applies it via {@link applyOutcome}), `{ kind: "manual", reason }` when
   * recovery is impossible (the seam fails the node for retry, reason in the
   * trail). NEVER throws — a throw is caught once at the recovery seam and
   * mapped to `manual` + event. Must not mutate node status or emit terminal
   * events when returning `manual`.
   */
  abstract recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult>;

  // ── shared helpers available to subclasses ──────────────────────────────

  parseInput(raw: unknown): I {
    return this.inputSchema.parse(raw);
  }

  parseOutput(raw: unknown): O {
    return this.outputSchema.parse(raw);
  }

  /** Validate the engine's merged config (class ← app ← flow snapshot) before
   *  a run or after a set_node_config patch. Declarative kinds override to
   *  use their declarative schema instead of `configSchema`. */
  parseRunConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = this.configSchema.safeParse(config);
    if (!parsed.success) {
      throw formatZodConfigError(this.key, parsed.error);
    }
    return parsed.data as Record<string, unknown>;
  }
  async node(ctx: FlowCtx): Promise<NodeRow> {
    return this.support.nodeByKey(ctx.flow.id, this.key);
  }

  /** Persist a run's full input blob — retry fidelity: `retryNode` re-runs
   *  `def.run()` from this record; the recorded `prompt` carries the exact
   *  final prompt the run sent. */
  protected async recordInput(nodeId: string, input: Record<string, unknown>): Promise<void> {
    await this.support.setNode(nodeId, { input: JSON.stringify(input) });
  }

  /** Persist a run's input blob — the engine's claim already holds the node
   *  `running`; this records the input (liveness for long-lived waits that
   *  touch `updated_at` separately). */
  protected async markRunning(ctx: FlowCtx, input: Record<string, unknown>): Promise<void> {
    const node = await this.node(ctx);
    await this.support.setNode(node.id, { input: JSON.stringify(input) });
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
   * The terminal write itself is the transition authority's
   * `publishOutcome`: status + validated output in ONE attempt-fenced
   * statement (step 02, Invariant 1 — never a raw status write).
   */
  protected async applyOutcome(ctx: FlowCtx, outcome: RunOutcome, opts?: { note?: string; fenceSuperseded?: boolean; attemptId?: string | null }): Promise<RunOutcome> {
    const node = await this.node(ctx);
    const attemptId = opts?.attemptId ?? node.attemptId;
    if (opts?.fenceSuperseded && attemptId) {
      if (node.attemptId !== attemptId) {
        throw new RunSupersededError(node.id, node.status, attemptId);
      }
    } else if (opts?.fenceSuperseded && node.status !== "running") {
      throw new RunSupersededError(node.id, node.status, "applyOutcome");
    }
    // validation stays OUTSIDE the transaction (pure — nothing to batch)
    let validatedOutput: O;
    try {
      validatedOutput = this.outputSchema.parse(outcome.output);
    } catch (e: unknown) {
      if (e instanceof z.ZodError) {
        // Invariant 5: nothing is published unvalidated — a contract-violating
        // outcome maps to a failed node with a typed event (retriable), never
        // to the requested success terminal.
        return await this.failOutputContract(ctx, node, e.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`), { ...opts, attemptId });
      }
      throw e;
    }
    // The completion batch (step 06, Invariant 7): artifact + facts + terminal
    // + lifecycle event in ONE pure-DB transaction — a crash leaves no partial
    // state (the fact side-channel rides the same batch, Invariant F2).
    await this.support.transaction(async (tx) => {
      if (outcome.artifact) {
        await this.support.saveArtifact(node.id, ctx.flow.id, outcome.artifact.kind, outcome.artifact.content, outcome.artifact.meta, undefined, tx);
      }
      await persistRunFacts(ctx.flow.id, node.id, outcome, tx);
      await this.support.publishOutcome({
        flowId: ctx.flow.id,
        nodeKey: node.nodeKey,
        nodeId: node.id,
        attemptId: opts?.fenceSuperseded && attemptId ? attemptId : undefined,
        outcome: {
          status: outcome.status,
          output: validatedOutput,
          agentId: await this.support.lastAgentId(node.id, tx),
        },
        tx,
      });
      await this.support.emitLifecycle(ctx.flow.id, node.id,
        opts?.note ? `${outcome.event} (${opts.note})` : outcome.event, outcome.eventData, tx);
    });
    return { ...outcome, output: validatedOutput as Record<string, unknown> };
  }

  /**
   * The typed terminal for an outcome that violated `outputSchema` (step 04):
   * a typed `output_contract_violation` event with the per-path issues, then
   * the failed terminal (failed writes carry no payload data — the violation
   * detail lives in the event). Retriable like any other failed node.
   */
  private async failOutputContract(ctx: FlowCtx, node: NodeRow, issues: string[], opts?: { attemptId?: string | null; fenceSuperseded?: boolean }): Promise<RunOutcome> {
    const message = `${node.nodeKey}: output contract violation — ${issues[0] ?? "the output did not satisfy its schema"}`;
    const failed: RunOutcome = {
      status: NODE_RUN_STATUS.FAILED,
      output: {},
      event: `${node.nodeKey} failed — output contract violation`,
      eventData: { error: message, issues },
      reply: message,
    };
    // the violation batch (step 06, Invariant 7): typed event + failed terminal + lifecycle in one tx
    await this.support.transaction(async (tx) => {
      await this.support.emit(ctx.flow.id, node.id, EVENT_KIND.OUTPUT_CONTRACT_VIOLATION, message, { nodeKey: node.nodeKey, issues }, tx);
      await this.support.publishOutcome({
        flowId: ctx.flow.id, nodeKey: node.nodeKey, nodeId: node.id,
        attemptId: opts?.fenceSuperseded ? opts.attemptId ?? undefined : undefined,
        outcome: { status: failed.status, output: failed.output, agentId: await this.support.lastAgentId(node.id, tx) },
        tx,
      });
      await this.support.emitLifecycle(ctx.flow.id, node.id, failed.event, failed.eventData, tx);
    });
    return failed;
  }

  async makeDiff(ctx: FlowCtx, branch: string, opts: { baseSha?: string | null } = {}) {
    return this.ctxHelper.makeDiff(ctx, branch, opts);
  }
}

