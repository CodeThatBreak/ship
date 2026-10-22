import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { CursorRunResult } from "../../../integrations/cursor";
import { localGit } from "../../../git/local";
import { prompts } from "../../prompts";
import { planSteps } from "../../steps";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import { branchStore } from "./branch-store";
import { BuildInput, BuildOutput, type BuildBranchInfo } from "./schema";

export class BuildNode extends NodeDefinition<BuildInput, BuildOutput> {
  readonly key = NODE_KEYS.BUILD;
  readonly label = "Build";
  readonly promptKeys = [NODE_KEYS.BUILD, "build_refine"] as const;
  readonly order = 20;
  readonly edges = [[NODE_KEYS.PIPELINE, "next"]] as const;

  readonly inputSchema = BuildInput;
  readonly outputSchema = BuildOutput;

  async run(ctx: FlowCtx, input: BuildInput): Promise<RunOutcome> {
    // Chat refine on an existing build agent is a different path
    if (input.feedback) return this.refine(ctx, input.feedback, input.prompt, input.model);

    const node = this.node(ctx);
    const plan = input.plan;
    if (!plan) throw new Error("plan is required for a build");
    const mode = this.ctxHelper.execMode(ctx);
    const branchSuffix = input.branchInfo?.name;
    const branch = this.ctxHelper.buildBranch(ctx, branchSuffix);
    const label = input.branchInfo ? `build (${input.branchInfo.name})` : "build";

    // scope the prompt to this branch of the plan (multi-branch builds)
    let scopedPlan = plan;
    if (input.branchInfo?.scope) {
      scopedPlan = `Branch scope: ${input.branchInfo.scope}\n\n${plan}`;
    }

    const instructions = mode === "local"
      ? `Implement the following approved plan for a Jira ticket. First create and check out a new git branch named "${branch}" (from the repo's default branch), then make the code changes, commit them, and push the branch to origin. Do NOT open a merge request.`
      : `Implement the following approved plan for a Jira ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;

    // pending checklist steps for this branch + the progress-report contract
    const checklistRows = planSteps.markdown(ctx.flow.id, input.branchInfo?.name ?? null);
    const checklist = checklistRows
      ? [
          `## Plan checklist`,
          `Work through these steps (ids in brackets):`,
          checklistRows,
          ``,
          `When you finish, end your response with a \`\`\`json build-progress\`\`\` block listing the ids of the steps you fully completed:`,
          `\`\`\`json build-progress`,
          `{"completed":["s1","s2"]}`,
          `\`\`\``,
        ].join("\n")
      : "";

    const prompt = prompts.resolve(NODE_KEYS.BUILD,
      { ticket: this.ctxHelper.ticketContext(ctx), branch, mode },
      { instructions, plan: scopedPlan, checklist },
      input.prompt,
    );

    return this.execute(ctx, {
      input: { ...input, prompt, branch: input.branchInfo?.name ?? null },
      prompt,
      promptOverride: input.prompt,
      agent: {
        mode: "agent",
        name: input.branchInfo ? `build ${ctx.ticket.key} (${input.branchInfo.name})` : `build ${ctx.ticket.key}`,
        autoCreatePR: false,
        startingRef: ctx.repo?.default_branch ?? "main",
        model: input.model,
      },
      label,
      finalize: (result) => this.finalizeBuild(ctx, result, branch, input.branchInfo, node.id),
    });
  }

  private async finalizeBuild(
    ctx: FlowCtx,
    result: CursorRunResult,
    branch: string,
    branchInfo: BuildBranchInfo | null,
    nodeId: string,
  ): Promise<RunOutcome> {
    // apply the build agent's structured progress report to the plan checklist
    planSteps.markDone(ctx.flow.id, nodeId, planSteps.parseBuildProgress(result.result ?? ""));

    const resultBranch =
      this.ctxHelper.execMode(ctx) === "local"
        ? (await localGit.currentBranch(this.ctxHelper.requireLocalPath(ctx))) ?? branch
        : result.git?.branches?.[0]?.branch ?? branch;
    if (!resultBranch) throw new Error("build finished but no branch was pushed");

    db.run(`UPDATE flows SET mr_branch=? WHERE id=?`, resultBranch, ctx.flow.id);
    ctx.flow.mr_branch = resultBranch;

    if (branchInfo) {
      const branchRowId = branchStore.upsert(ctx.flow.id, branchInfo.name, {
        title: branchInfo.title,
        status: "building",
      });
      branchStore.tagLatestRun(nodeId, branchRowId);
    }

    const diff = await this.makeDiff(ctx, resultBranch);
    const art = this.support.saveArtifact(
      nodeId, ctx.flow.id, "diff",
      diff ? diff.raw : "(diff unavailable — fetch from GitLab)",
      { branch: resultBranch, stat: diff?.stat ?? "", branchName: branchInfo?.name ?? undefined }
    );

    return {
      status: "awaiting_approval",
      output: this.outputSchema.parse({
        branch: resultBranch,
        latestArtifact: art.id,
        branchName: branchInfo?.name ?? undefined,
      }),
      event: `build pushed branch ${resultBranch}; diff ready for review`,
      eventData: { stat: diff?.stat },
      reply: result.result ?? "",
    };
  }

  /** Chat-driven changes: follow up on the build agent, regenerate the diff. */
  private async refine(ctx: FlowCtx, feedback: string, promptOverride?: string | null, model?: string | null): Promise<RunOutcome> {
    const node = this.node(ctx);
    if (!node.agent_id) {
      // no build agent yet — treat as a full build with the latest plan + note
      const plan = db.get<{ content: string }>(
        `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
         WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, ctx.flow.id);
      return this.run(ctx, this.inputSchema.parse({
        plan: (plan?.content ?? "") + `\n\nDeveloper note: ${feedback}`,
        model: model ?? null,
      }));
    }

    const prompt = promptOverride ?? prompts.resolve("build_refine", {}, { feedback });
    const outcome = await this.execute(ctx, {
      input: { feedback, prompt: promptOverride ?? null, model: model ?? null },
      prompt,
      promptOverride,
      agent: {
        mode: "agent",
        name: `build refine ${ctx.ticket.key}`,
        followUpOn: node.agent_id,
        startingRef: ctx.flow.mr_branch ?? undefined,
        model,
      },
      label: "build refine",
      finalize: async (result) => {
        const branch =
          ctx.flow.mr_branch ??
          (this.ctxHelper.execMode(ctx) === "local"
            ? (await localGit.currentBranch(this.ctxHelper.requireLocalPath(ctx)))
            : result.git?.branches?.[0]?.branch);
        const diff = branch ? await this.makeDiff(ctx, branch) : null;
        const art = this.support.saveArtifact(
          node.id, ctx.flow.id, "diff",
          diff ? diff.raw : (result.result ?? ""),
          { branch, stat: diff?.stat ?? "", feedback }
        );
        return {
          status: "awaiting_approval" as const,
          output: this.outputSchema.parse({ branch: branch ?? "", latestArtifact: art.id }),
          event: `build updated per feedback; new diff ready`,
          reply: result.result ?? "Done.",
        };
      },
    });
    return outcome;
  }

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(ctx, this.inputSchema.parse({ feedback: content }));
    return outcome.reply;
  }

  /**
   * Complete a build whose agent run was orphaned (server restarted mid-run)
   * but left commits on the build branch.
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: CursorRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    const branch = result.git?.branches?.[0]?.branch ?? ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    await this.recoverBranch(ctx, node, branch, note);
    return true;
  }

  /** Recover an orphaned build from a known branch (reconcile calls this too). */
  async recoverBranch(ctx: FlowCtx, node: NodeRow, branch: string, note: string): Promise<void> {
    // idempotent: a concurrent reconcile may have already recovered this node
    if (node.status !== "running") return;
    db.run(`UPDATE flows SET mr_branch=? WHERE id=?`, branch, ctx.flow.id);
    ctx.flow.mr_branch = branch;
    const diff = await this.makeDiff(ctx, branch);
    const art = this.support.saveArtifact(
      node.id, ctx.flow.id, "diff",
      diff ? diff.raw : "(diff unavailable — fetch from GitLab)",
      { branch, stat: diff?.stat ?? "", recovered: true }
    );
    this.support.setNode(node.id, {
      status: "awaiting_approval",
      output: JSON.stringify(this.outputSchema.parse({ branch, latestArtifact: art.id })),
    });
    db.emitEvent(ctx.flow.id, node.id, "lifecycle",
      `build recovered on branch ${branch}; diff ready for review (${note})`,
      { stat: diff?.stat, recovered: true });
  }
}
