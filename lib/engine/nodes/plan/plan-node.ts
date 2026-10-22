import { db } from "../../../db";
import type { CursorRunResult } from "../../../integrations/cursor";
import type { NodeRow } from "../../../db/rows";
import { prompts } from "../../prompts";
import { planSteps } from "../../steps";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import { PlanMetaParser } from "./plan-meta-parser";
import { PlanInput, PlanOutput, type PlanMeta } from "./schema";

export class PlanNode extends NodeDefinition<PlanInput, PlanOutput> {
  readonly key = NODE_KEYS.PLAN;
  readonly label = "Plan";
  readonly promptKeys = [NODE_KEYS.PLAN, "plan_refine"] as const;
  readonly order = 10;
  readonly edges = [[NODE_KEYS.BUILD, "next"]] as const;

  readonly inputSchema = PlanInput;
  readonly outputSchema = PlanOutput;

  private readonly metaParser = new PlanMetaParser();

  async run(ctx: FlowCtx, input: PlanInput): Promise<RunOutcome> {
    const node = this.node(ctx);
    this.support.setNode(node.id, { status: "running" });

    const prompt = this.buildPrompt(ctx, node, input);
    const customSubagents = this.decomposeSubagents(ctx, input);
    this.recordInput(node.id, { ...input, prompt }, input.prompt);

    const runOnce = (p: string, label: string, followUp: string | null) =>
      this.runAgent(ctx, node.id, input, customSubagents, p, label, followUp);

    const { text, planMeta } = await this.generatePlan(ctx, node, input, prompt, runOnce);
    const { art, stepCount } = this.persistPlan(ctx, node, input, text, planMeta);

    return this.finalizePlan(ctx, node, art, planMeta, stepCount, text);
  }

  /** Resolve the plan prompt: verbatim override, refine template, or base template + feedback. */
  private buildPrompt(ctx: FlowCtx, node: NodeRow, input: PlanInput): string {
    const hasAgent = Boolean(node.agent_id);
    const baseCtx = { ticket: this.ctxHelper.ticketContext(ctx) };

    let prompt: string;
    if (input.prompt) {
      prompt = input.promptIsBody
        ? `${input.prompt}\n\n${prompts.internalSuffix(NODE_KEYS.PLAN, baseCtx)}`
        : input.prompt;
    } else if (input.feedback && hasAgent) {
      prompt = prompts.resolve("plan_refine", baseCtx, {
        feedback: input.feedback,
      });
    } else {
      const base = prompts.resolve(NODE_KEYS.PLAN, baseCtx);
      prompt =
        base +
        (input.feedback
          ? `\n\nAdditional instructions from the developer:\n${input.feedback}`
          : "");
    }

    if (input.decompose) {
      prompt +=
        this.ctxHelper.execMode(ctx) === "local"
          ? "\n\nUse your built-in Task subagents to explore different areas of the repo in parallel, then merge the results into a single cohesive plan."
          : "\n\nDelegate exploration of different repo areas to sub-agents, then merge the results into a single cohesive plan.";
    }

    return prompt;
  }

  /** Custom sub-agents for decompose mode (cloud runs only). */
  private decomposeSubagents(ctx: FlowCtx, input: PlanInput) {
    return input.decompose && this.ctxHelper.execMode(ctx) === "cloud"
      ? [
          {
            name: "repo-explorer",
            instructions:
              "Explore the repository structure, identify key modules, and report back on architecture and dependencies.",
          },
        ]
      : undefined;
  }

  /** Execute a single plan-mode agent run. */
  private runAgent(
    ctx: FlowCtx,
    nodeId: string,
    input: PlanInput,
    customSubagents: ReturnType<PlanNode["decomposeSubagents"]>,
    prompt: string,
    label: string,
    followUp: string | null,
  ) {
    return this.runner.executeRun(
      ctx,
      nodeId,
      () =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: "plan",
          name: `${label} ${ctx.ticket.key}`,
          followUpOn: followUp,
          customSubagents,
          model: input.model,
        }),
      label,
    );
  }

  /** Run the plan agent, retrying once when the plan-meta block is invalid. */
  private async generatePlan(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    prompt: string,
    runOnce: (p: string, label: string, followUp: string | null) => Promise<CursorRunResult>,
  ): Promise<{ text: string; planMeta: PlanMeta | null }> {
    const hasAgent = Boolean(node.agent_id);
    let result = await runOnce(
      prompt,
      input.feedback ? "plan refine" : "plan",
      input.feedback && hasAgent ? node.agent_id : null,
    );
    let text = result.result ?? "";

    let planMeta = this.metaParser.parse(text);
    if (planMeta || !text.includes("plan-meta")) return { text, planMeta };

    db.emitEvent(
      ctx.flow.id,
      node.id,
      "lifecycle",
      "plan-meta validation failed — retrying with feedback",
    );
    const retryPrompt = `Your previous response included a plan-meta block, but it was invalid. Re-emit the plan with a corrected plan-meta block: "steps" must be a non-empty array of {id, title, detail, files, branch} with unique ids; branch names must be lowercase alphanumeric + hyphens, unique, and dependsOn must reference valid branch names.`;
    result = await runOnce(
      retryPrompt,
      "plan meta retry",
      this.support.lastAgentId(node.id),
    );
    text = result.result ?? "";
    planMeta = this.metaParser.parse(text);
    return { text, planMeta };
  }

  /** Save the plan artifact and sync the editable step checklist from it. */
  private persistPlan(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    text: string,
    planMeta: PlanMeta | null,
  ) {
    const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", text, {
      feedback: input.feedback,
      branches: planMeta?.branches ?? undefined,
      steps: planMeta?.steps ?? undefined,
    });

    // sync the editable checklist from this plan version (merge by meta id)
    const stepCount = planMeta?.steps?.length
      ? planSteps.syncFromPlan(ctx.flow.id, art.id, planMeta.steps)
      : 0;

    return { art, stepCount };
  }

  /** Persist output/status, emit the lifecycle event, and build the outcome. */
  private finalizePlan(
    ctx: FlowCtx,
    node: NodeRow,
    art: { id: string; version: number },
    planMeta: PlanMeta | null,
    stepCount: number,
    text: string,
  ): RunOutcome {
    const branchNote = planMeta?.branches?.length
      ? ` (${planMeta.branches.length} branch${planMeta.branches.length > 1 ? "es" : ""})`
      : "";
    const stepNote = stepCount ? ` · ${stepCount} steps` : "";

    const output = this.outputSchema.parse({
      latestArtifact: art.id,
      version: art.version,
      branches: planMeta?.branches ?? undefined,
      steps: planMeta?.steps ?? undefined,
    });
    this.support.setNode(node.id, {
      status: "awaiting_approval",
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(output),
    });
    const event = `plan v${art.version} ready for review${branchNote}${stepNote}`;
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", event);

    return { status: "awaiting_approval", output, event, reply: text };
  }

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(
      ctx,
      this.inputSchema.parse({ feedback: content }),
    );
    return outcome.reply;
  }

  async recover(
    ctx: FlowCtx,
    node: NodeRow,
    result: CursorRunResult,
    note: string,
  ): Promise<boolean> {
    if (result.status !== "finished") return false;
    const art = this.support.saveArtifact(
      node.id,
      ctx.flow.id,
      "plan",
      result.result ?? "(no plan text)",
      { recovered: true },
    );
    this.support.setNode(node.id, {
      status: "awaiting_approval",
      output: JSON.stringify(
        this.outputSchema.parse({
          latestArtifact: art.id,
          version: art.version,
        }),
      ),
    });
    db.emitEvent(
      ctx.flow.id,
      node.id,
      "lifecycle",
      `plan recovered (${note}) — ready for review`,
    );
    return true;
  }

  /** Convenience for the prompt-preview route: the plan prompt as it would be sent. */
  previewPrompt(ctx: FlowCtx, feedback?: string): string {
    const node = this.support.nodeByKey(ctx.flow.id, NODE_KEYS.PLAN);
    const hasAgent = Boolean(node.agent_id);
    if (feedback && hasAgent) {
      return prompts.resolve(
        "plan_refine",
        { ticket: this.ctxHelper.ticketContext(ctx) },
        { feedback },
      );
    }
    const base = prompts.resolve(NODE_KEYS.PLAN, {
      ticket: this.ctxHelper.ticketContext(ctx),
    });
    return (
      base +
      (feedback
        ? `\n\nAdditional instructions from the developer:\n${feedback}`
        : "")
    );
  }
}
