import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { CursorRunResult } from "../../../integrations/cursor";
import { agentRunner, type AgentRunner, type AgentStartInput } from "./agent-runner";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./flow-context";
import { nodeSupport, type NodeSupport } from "./node-support";

/**
 * What a node stores in its `output` column when it finishes a run.
 * Each node narrows this with its own schema.
 */
export interface RunOutcome {
  output: Record<string, unknown>;
  /** final node status, e.g. awaiting_approval | done */
  status: "awaiting_approval" | "done";
  /** artifact to save (kind + content + meta); nodes may save more themselves */
  artifact?: { kind: string; content: string; meta?: unknown };
  /** lifecycle event message */
  event: string;
  eventData?: Record<string, unknown>;
  /** text returned to chat callers */
  reply: string;
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
  abstract run(ctx: FlowCtx, input: I): Promise<RunOutcome>;

  /**
   * Chat follow-up on this node's agent. Default: not supported.
   */
  async chat(ctx: FlowCtx, content: string): Promise<string> {
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
      (nodeId) =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: "plan",
          name: `${this.label} chat ${ctx.ticket.key}`,
          followUpOn: agentId,
          nodeId,
        }),
      `${this.label} chat`,
    );
    return result.text ?? "Done.";
  }

  /**
   * Finish a run that completed while the server was down.
   * Return true when the node was recovered, false to have it failed for retry.
   */
  abstract recover(ctx: FlowCtx, node: NodeRow, result: CursorRunResult, note: string): Promise<boolean>;

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
      finalize: (result: CursorRunResult) => Promise<RunOutcome>;
    }
  ): Promise<RunOutcome> {
    const node = this.node(ctx);
    this.support.setNode(node.id, {
      status: "running",
      prompt_override: opts.promptOverride ?? null,
      input: JSON.stringify(opts.input),
    });
    const start = (nodeId: string) =>
      this.runner.startAgent(ctx, { ...opts.agent, prompt: opts.prompt, nodeId });
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

  async makeDiff(ctx: FlowCtx, branch: string) {
    return this.ctxHelper.makeDiff(ctx, branch);
  }
}
