import type { AgentRunResult } from "../../ports/agent-runner";
import { agentRunner, type AgentRunner, type AgentStartInput } from "./agent-runner";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./flow-context";
import { nodeSupport, type NodeSupport } from "./node-support";
import { NodeDefinition, type RunOutcome } from "./node-definition";

/**
 * The middle tier of the node family (§T4b): a run here goes through the
 * agent runner. The membership test is behavioral, not a name list — "does
 * run() (or its handlers) ever start an agent?" — which picks plan, build,
 * pipeline, review and resolve in, keeps start / http / script out, and lets
 * future kinds classify themselves by extending this tier.
 *
 * It owns the pieces of the agent lifecycle every member genuinely shares,
 * moved down from the root class one level:
 *
 *  - `execute()` — the run lifecycle (running status, recorded input blob,
 *    runner execution, outcome application through the one persistence path),
 *  - `converse()` — the lightweight "just chat" follow-up (no node state
 *    changes),
 *  - the default `chat()` — the rerun-with-feedback recipe plan/build share:
 *    a chat message re-asks this node's run with the message mapped into its
 *    feedback field (`chatInput()`; defs whose contract names the guidance
 *    field differently — review/resolve `instructions` — override it, and the
 *    bespoke orchestration (pipeline's gate rerun, agent kinds' follow-up
 *    render) overrides `chat()` whole).
 */
export abstract class AgentRunNode<
  I = unknown,
  O extends Record<string, unknown> = Record<string, unknown>,
> extends NodeDefinition<I, O> {
  /** The agent runner — constructor-injected, the singleton is the default. */
  protected readonly runner: AgentRunner;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    super(support, ctxHelper);
    this.runner = runner;
  }

  /**
   * The run input a chat message maps into: `{ feedback, model }` by default
   * — the field plan/build consume. Overrides re-map the message onto the
   * node's own guidance field without duplicating the recipe.
   */
  protected chatInput(content: string, model?: string): Record<string, unknown> {
    return { feedback: content, model: model ?? null };
  }

  /**
   * Chat follow-up on this node's agent: re-run it with the message as
   * feedback. `model` is the per-run override the developer picked in the
   * chat panel.
   */
  async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const outcome = await this.run(
      ctx,
      this.inputSchema.parse(this.chatInput(content, model)) as I,
      this.nodeConfig(ctx),
    );
    return outcome.reply;
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
   * Full run lifecycle: mark running, persist the input blob (whose recorded
   * `prompt` field is the exact final prompt), execute through the runner, then
   * apply the outcome (artifact, output, status, event). Returns the outcome
   * so run() can hand it back to the orchestrator.
   */
  protected async execute(
    ctx: FlowCtx,
    opts: {
      input: Record<string, unknown>;
      prompt: string;
      agent: Omit<AgentStartInput, "prompt">;
      label: string;
      finalize: (result: AgentRunResult) => Promise<RunOutcome>;
    }
  ): Promise<RunOutcome> {
    const node = this.node(ctx);
    this.support.setNode(node.id, {
      status: "running",
      // the run's input blob is the per-run record: `input.prompt` carries the
      // exact final prompt the agent receives — the only truthful prompt state
      input: JSON.stringify(opts.input),
    });
    const start = () =>
      this.runner.startAgent(ctx, { ...opts.agent, prompt: opts.prompt, nodeId: node.id });
    const result = await this.runner.executeRun(ctx, node.id, start, opts.label);
    const outcome = await opts.finalize(result);
    return this.applyOutcome(ctx, outcome);
  }
}
