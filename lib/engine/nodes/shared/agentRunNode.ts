import "server-only";

import { config } from "../../../config";
import type { AgentRunResult } from "../../ports/agentPort";
import { agentRunner, type AgentRunner, type AgentStartInput } from "../../harness/harnessExports";
import { flowCtxHelper, type FlowContextHelper, type FlowCtx } from "./runContext";
import type { NodeSupport } from "./nodeSupport";
import { nodeSupport, engineParts } from "@/lib/composition/container";
import { NodeDefinition, type RunOutcome } from "./nodeDefinition";
import type { ChatTurnOpts } from "./nodeRoles";
import { AGENT_TOKEN_ENV, AGENT_TOOL_SETS } from "../../agentTools/constants/agentTools";
import type { ToolDescriptor } from "../../agentTools/types/tools";
import { agentToolsBlock, redactCapabilityToken } from "../../agentTools/utils/toolsPromptBlock";
import type { NodeRunStatus } from "../../../../constants/flow";
import { FLOW_STATUS } from "../../../../constants/flow";
import type { NodeRow } from "../../../db/rows";
import { RunSupersededError } from "../../errors/runSupersededError";

/** Metadata from {@link AgentRunner.executeRun} passed into finalize hooks. */
export interface ExecuteRunMeta {
  runRowId: string;
}

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

  /** Step 08 (Invariant 10) — the agent-run tier's default toolset: every
   *  kind that runs an agent gets live flow state + the bounded
   *  self-failure; build/step-build override with the checklist-claim tool.
   *  Non-agent kinds (start/http/script) keep the base `[]` default. */
  override agentTools(): ToolDescriptor[] {
    return [...AGENT_TOOL_SETS.readAndReport];
  }

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
  async turn(
    ctx: FlowCtx,
    content: string,
    opts?: ChatTurnOpts,
  ): Promise<string> {
    return this.chat(ctx, content, opts?.model);
  }

  /**
   * A chat turn before the node's first run carries the prompt body, not
   * feedback: the composer's first message IS the node's prompt (the same
   * shape the retired prompt modal recorded — plan's precedent). Once the
   * node has published an output, turns are refine feedback on that output.
   * A failed node with no output is still a first turn (the retry is a
   * fresh run).
   */
  protected isFirstTurn(node: NodeRow): boolean {
    return (
      node.output == null &&
      (node.status === FLOW_STATUS.PENDING || node.status === FLOW_STATUS.FAILED)
    );
  }

  async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const outcome = await this.run(
      ctx,
      this.inputSchema.parse(this.chatInput(content, model)) as I,
      await this.nodeConfig(ctx),
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
    const node = await this.node(ctx);
    const agentId = await this.support.lastAgentId(node.id);
    if (!agentId) {
      return `There's no ${this.label} agent to chat with yet — run the step first (or switch on refine mode), then ask me anything.`;
    }
    const prompt =
      `${content}\n\n` +
      `— Respond conversationally and concisely. This is a question about your work, ` +
      `not a request to redo it: do not produce a new plan, diff, or plan-meta block, ` +
      `and do not modify any files.`;
    const run = await this.runner.executeRun(
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
      { ownsNodeStatus: false },
    );
    return run.result.result ?? "Done.";
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
      finalize: (result: AgentRunResult, _meta: ExecuteRunMeta) => Promise<RunOutcome>;
    }
  ): Promise<RunOutcome> {
    const node = await this.node(ctx);
    const attemptId = node.attemptId;
    // Step 08 (Invariant 10): the running agent's tools ride the prompt as a
    // locked appended block — only when the endpoint is reachable
    // (SERVER_PUBLIC_URL) and the kind declares tools. Cloud runs get the
    // token injected into the run environment instead of prompt text; local
    // runs (no env channel) carry it inline in the block. The recorded input
    // blob always redacts the token (it is what the UI/retry record shows).
    const apiToken = attemptId != null ? (engineParts.attemptRegistry.apiTokenOf(node.id) ?? null) : null;
    const toolsBlock = agentToolsBlock({
      baseUrl: config.serverPublicUrl(),
      flowId: ctx.flow.id,
      nodeKey: node.nodeKey,
      token: apiToken,
      execMode: this.ctxHelper.execMode(ctx),
      tools: this.agentTools(),
    });
    const prompt = toolsBlock ? `${opts.prompt}\n\n${toolsBlock}` : opts.prompt;
    await this.support.setNode(node.id, {
      input: redactCapabilityToken(JSON.stringify(opts.input), apiToken),
    });
    const start = () =>
      this.runner.startAgent(ctx, {
        ...opts.agent,
        prompt,
        nodeId: node.id,
        env: apiToken ? { [AGENT_TOKEN_ENV]: apiToken } : undefined,
      });
    try {
      const { result, runRowId } = await this.runner.executeRun(ctx, node.id, start, opts.label, {
        attemptId: attemptId ?? undefined,
      });
      const outcome = await opts.finalize(result, { runRowId });
      return this.applyOutcome(ctx, outcome, {
        fenceSuperseded: Boolean(attemptId),
        attemptId,
      });
    } catch (e) {
      if (e instanceof RunSupersededError) {
        return await this.supersededOutcome(ctx, opts.label);
      }
      throw e;
    }
  }

  private async supersededOutcome(ctx: FlowCtx, label: string): Promise<RunOutcome> {
    const current = await this.node(ctx);
    const output =
      current.output && typeof current.output === "object" ? current.output : {};
    return {
      status: current.status as NodeRunStatus,
      output,
      event: `${label} superseded`,
      reply: "",
    };
  }
}
