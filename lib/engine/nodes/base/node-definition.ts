import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agent-runner";
import { agentRunner, type AgentRunner, type AgentStartInput } from "./agent-runner";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./flow-context";
import { nodeSupport, type NodeSupport } from "./node-support";
import type { ConfigField } from "../../node-config";
import { appLayerConfig, mergeConfigLayers } from "../../node-config";

/**
 * What a node stores in its `output` column when it finishes a run.
 * Each node narrows this with its own schema.
 */
export interface RunOutcome {
  output: Record<string, unknown>;
  /** final node status, e.g. awaiting_approval | done | failed */
  status: "awaiting_approval" | "done" | "failed";
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
 * input/output schemas, prompt building, the run itself, chat follow-ups,
 * and restart recovery. The orchestrator (flow.ts) only knows the registry.
 *
 * Shared infrastructure (row persistence, run execution, context facts) is
 * injected as services — override them in tests by subclassing.
 */
export abstract class NodeDefinition<I = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  /** stable node key, e.g. "plan" */
  abstract readonly key: string;
  /** UI label, e.g. "Plan" */
  abstract readonly label: string;
  /** prompt template keys this node uses (main first) */
  abstract readonly promptKeys: readonly string[];
  /** position in the workflow graph (ascending) */
  abstract readonly order: number;
  /** graph edges originating at this node: [target, kind] */
  readonly edges: readonly (readonly [string, "next" | "loop"])[] = [];

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

  /** Shared services (singletons by default). */
  protected readonly support: NodeSupport = nodeSupport;
  protected readonly runner: AgentRunner = agentRunner;
  protected readonly ctxHelper: FlowContextHelper = flowCtxHelper;

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
   * Effective config knobs for this node's handlers that don't receive a
   * config from the engine (chat follow-ups). Merges class defaults ←
   * app-settings layer ← the config snapshot from the flow's node row.
   */
  protected nodeConfig(ctx: FlowCtx): Record<string, unknown> {
    const node = this.node(ctx);
    return mergeConfigLayers(this.defaultConfig(), appLayerConfig(this.key), node.config);
  }

  /**
   * Chat follow-up on this node's agent. Default: not supported.
   * `model` is the per-run model override the developer picked in the chat panel.
   */
  async chat(ctx: FlowCtx, content: string, _model?: string): Promise<string> {
    return "This node doesn't accept chat input.";
  }

  /**
   * Lightweight conversational follow-up ("just chat" mode): a question to the
   * node's existing agent that must NOT change node status, artifacts, or
   * checklists — it only answers. Never starts a node run: without an agent
   * there is nothing to converse with.
   */
  async converse(ctx: FlowCtx, content: string): Promise<string> {
    const node = this.node(ctx);
    const agentId = this.support.lastAgentId(node.id);
    if (!agentId) {
      return `There's no ${this.label} agent to chat with yet — run the step first (or switch on refine mode), then ask me anything.`;
    }
    const prompt =
      `${content}\n\n` +
      `— Respond conversationally and concisely. This is a question about your work, ` +
      `not a request to redo it: do not produce a new plan, diff, or plan-meta block, ` +
      `and do not modify any files.`;
    const result = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: "plan",
          name: `${this.label} chat ${ctx.task.key}`,
          followUpOn: agentId,
        }),
      `${this.label} chat`,
    );
    return result.result ?? "Done.";
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
   * Full run lifecycle: mark running, persist input/prompt, execute, then
   * apply the outcome (artifact, output, status, event). Returns the outcome
   * so run() can hand it back to the orchestrator.
   */
  protected async execute(
    ctx: FlowCtx,
    opts: {
      input: Record<string, unknown>;
      prompt: string;
      promptOverride?: string | null;
      agent: Omit<AgentStartInput, "prompt">;
      label: string;
      finalize: (result: AgentRunResult) => Promise<RunOutcome>;
    }
  ): Promise<RunOutcome> {
    const node = this.node(ctx);
    this.support.setNode(node.id, {
      status: "running",
      prompt_override: opts.promptOverride ?? null,
      input: JSON.stringify(opts.input),
    });
    const start = () =>
      this.runner.startAgent(ctx, { ...opts.agent, prompt: opts.prompt });
    const result = await this.runner.executeRun(ctx, node.id, start, opts.label);
    const outcome = await opts.finalize(result);
    if (outcome.artifact) {
      this.support.saveArtifact(node.id, ctx.flow.id, outcome.artifact.kind, outcome.artifact.content, outcome.artifact.meta);
    }
    const validatedOutput = this.outputSchema.parse(outcome.output);
    this.support.setNode(node.id, {
      status: outcome.status,
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(validatedOutput),
    });
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", outcome.event, outcome.eventData);
    return { ...outcome, output: validatedOutput as Record<string, unknown> };
  }

  /** Persist a prompt override + full input blob (audit / retry fidelity). */
  protected recordInput(nodeId: string, input: Record<string, unknown>, promptOverride?: string | null): void {
    this.support.setNode(nodeId, { prompt_override: promptOverride ?? null, input: JSON.stringify(input) });
  }

  /**
   * Apply a run outcome the same way `execute()`'s tail does — artifact,
   * validated output, status, lifecycle event. Nodes whose run() produces an
   * outcome without an agent run (decision manual/expression picks, http
   * calls, script runs) call this so every node kind finishes through the
   * one persistence path.
   */
  protected applyOutcome(ctx: FlowCtx, outcome: RunOutcome): RunOutcome {
    const node = this.node(ctx);
    if (outcome.artifact) {
      this.support.saveArtifact(node.id, ctx.flow.id, outcome.artifact.kind, outcome.artifact.content, outcome.artifact.meta);
    }
    const validatedOutput = this.outputSchema.parse(outcome.output);
    this.support.setNode(node.id, {
      status: outcome.status,
      output: JSON.stringify(validatedOutput),
    });
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", outcome.event, outcome.eventData);
    return { ...outcome, output: validatedOutput as Record<string, unknown> };
  }

  async makeDiff(ctx: FlowCtx, branch: string) {
    return this.ctxHelper.makeDiff(ctx, branch);
  }
}
