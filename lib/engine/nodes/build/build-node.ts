import { db } from "../../../db";
import { z } from "zod";
import { rows, NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agent-runner";
import { localGit } from "../../../git/local";
import { prompts } from "../../prompts";
import { planSteps } from "../../steps";
import { NodeDefinition, type FlowCtx, type NodePromptPreview, type NodeTriggerRun, type PromptPreviewParams, type RunOutcome } from "../base";
import { DEFAULT_FANOUT_OUTPUT, type NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { DEFAULT_MCP_SOURCES, configString, fanoutConfigFields, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields } from "../../node-config";
import { branchStore } from "./branch-store";
import { BuildInput, BuildOutput, type BuildBranchInfo } from "./schema";
import { type PlanBranch } from "../plan/schema";
import { worktreeManager } from "../../worktree-lifecycle";

export class BuildNode extends NodeDefinition<BuildInput, BuildOutput> {
  // widened (string / readonly string[]): the step_build child def subclasses
  // and re-labels itself — see step-build-node.ts
  readonly key: string = NODE_KEYS.BUILD;
  readonly label: string = "Build";
  readonly capabilities: NodeCapabilities = { panelTitle: "Code changes", fanoutOutput: DEFAULT_FANOUT_OUTPUT };
  readonly promptKeys: readonly string[] = [NODE_KEYS.BUILD, "build_refine"];
  readonly promptSections: readonly string[] = [NODE_KEYS.BUILD];
  readonly order = 20;
  readonly edges = [[NODE_KEYS.PIPELINE, "next"]] as const;

  readonly inputSchema = BuildInput; // includes the optional fan-out `step` (see schema.ts)
  readonly outputSchema = BuildOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** user rules appended after the prompt body / override */
    prompt_rules: z.string().optional(),
    /** custom branch naming, e.g. "bugfix/{ticket}-{id}"; empty = built-in pattern */
    branch_pattern: z.string().default(""),
    /** commit-fix agent attempts when the push is rejected during MR creation (engine-consumed) */
    max_commit_fix_attempts: z.number().int().min(1).default(2),
    /**
     * merge-fix agent attempts when a fan-out step branch conflicts with (or
     * is stale against) the integration branch at merge-back — Phase 2A, read
     * from the PARENT fan-out node's config by the StepFlowManager
     */
    max_merge_fix_attempts: z.number().int().min(1).default(2),
    // plan fan-out knob (flat keys — fanoutOf reads nested `fanout` objects too)
    fanout_mode: z.enum(["whole", "steps", "from-plan"]).default("whole"),
    fanout_child: z.string().nullable().default(null),
    fanout_parallel_max: z.number().int().min(1).default(1),
    /** ambient MCP servers for build/refine agent runs — defaults to ALL sources enabled */
    mcp_sources: mcpSourcesSchema.default(DEFAULT_MCP_SOURCES),
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body for build runs." },
    { key: "prompt_rules", label: "Your rules", type: "text", help: "Extra rules appended after the prompt body / override on every build or build-refine run. E.g. \"run npm run lint before pushing\"." },
    { key: "branch_pattern", label: "Branch pattern", type: "string", help: "Tokens: {prefix} {slug} {ticket} {id} {suffix}. Empty = built-in bugfix/feature pattern." },
    { key: "max_commit_fix_attempts", label: "Max commit-fix attempts", type: "number", help: "Commit-fix agent runs when the push is rejected while creating the MR." },
    { key: "max_merge_fix_attempts", label: "Max merge-fix attempts", type: "number", help: "Merge-fix agent runs per step child when its branch conflicts with (or is stale against) the integration branch at merge-back. Exhaustion fails the step visibly." },
    // the fan-out section: plan-downstream-capable built-ins carry one shared field set
    ...fanoutConfigFields,
    ...mcpSourceConfigFields,
  ] as const satisfies readonly ConfigField[];

  /**
   * Engine-triggered runs (the plan → build edge activation when the plan is
   * approved): the approved plan artifact + branch decomposition from the plan
   * meta + the model picked for the plan run. Plan-meta parsing is a built-in
   * internal — it lives in the node class, never in the engine. Multi-branch
   * plans come back as sequential runs.
   */
  override triggerRuns(ctx: FlowCtx): NodeTriggerRun[] {
    const plan = db.get<{ id: string; content: string; meta: string | null }>(
      `SELECT a.id, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND n.type=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`,
      ctx.flow.id, NODE_KEYS.PLAN
    );
    if (!plan) throw new Error("no plan to build — approve the plan first");

    // carry the model selected for the plan run into the build
    const planNode = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND type=?`, ctx.flow.id, NODE_KEYS.PLAN);
    const planModel = (planNode?.input as { model?: string } | null)?.model ?? undefined;

    // structured branches from the plan-meta (validated by the plan node at save time)
    let branches: PlanBranch[] | null = null;
    try {
      const meta = plan.meta ? JSON.parse(plan.meta) : null;
      if (Array.isArray(meta?.branches) && meta.branches.length > 0) branches = meta.branches;
    } catch { /* single-branch fallback */ }

    if (branches && branches.length > 1) {
      const sorted = BuildNode.topoSortBranches(branches);
      // branch rows first (pending) — today's approvePlan behavior
      sorted.forEach((b, i) => branchStore.upsert(ctx.flow.id, b.name, { title: b.title, order: i, status: "pending" }));
      db.emitEvent(ctx.flow.id, null, "lifecycle", `plan approved with ${branches.length} branches — building sequentially`,
        { nodeKey: planNode?.node_key ?? NODE_KEYS.PLAN });
      return sorted.map((b) => ({
        input: {
          plan: plan.content, prompt: null,
          branchInfo: { name: b.name, title: b.title, scope: b.scope },
          feedback: null, model: planModel ?? null,
        },
        before: () => branchStore.upsert(ctx.flow.id, b.name, { status: "building" }),
        after: () => branchStore.upsert(ctx.flow.id, b.name, { status: "awaiting_approval" }),
      }));
    }

    // single-branch fast path
    return [{
      input: { plan: plan.content, prompt: null, branchInfo: null, feedback: null, model: planModel ?? null },
    }];
  }

  /** Topologically sort branches by dependsOn. Simple DFS — safe for small N. */
  static topoSortBranches(branches: PlanBranch[]): PlanBranch[] {
    const byName = new Map(branches.map((b) => [b.name, b]));
    const visited = new Set<string>();
    const result: PlanBranch[] = [];
    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const b = byName.get(name);
      if (!b) return;
      for (const dep of b.dependsOn ?? []) visit(dep);
      result.push(b);
    };
    for (const b of branches) visit(b.name);
    return result;
  }

  /** Branch name from the `branch_pattern` knob (empty = built-in pattern). */
  private branchName(ctx: FlowCtx, config: Record<string, unknown>, suffix?: string): string {
    const pattern = configString(config, "branch_pattern");
    if (!pattern?.trim()) return this.ctxHelper.buildBranch(ctx, suffix);
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    return pattern
      .trim()
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{slug\}/g, slug)
      .replace(/\{ticket\}/g, String(ctx.task.key ?? "task"))
      .replace(/\{id\}/g, ctx.flow.id.slice(-6))
      .replace(/\{suffix\}/g, suffix ?? "");
  }

  async run(ctx: FlowCtx, input: BuildInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the user's standing rules (prompt_rules knob) apply to every run
    const userRules = configString(config, "prompt_rules") ?? "";
    // Chat refine on an existing build agent is a different path
    if (input.feedback) return this.refine(ctx, input.feedback, input.prompt, input.model, userRules);

    const node = this.node(ctx);
    const plan = input.plan;
    if (!plan) throw new Error("plan is required for a build");

    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body } as BuildInput;
    }

    const mode = this.ctxHelper.execMode(ctx);
    const branchSuffix = input.branchInfo?.name;
    const branch = this.branchName(ctx, config, branchSuffix);
    const label = input.branchInfo ? `build (${input.branchInfo.name})` : "build";

    // scope the prompt to this branch of the plan (multi-branch builds)
    let scopedPlan = plan;
    if (input.branchInfo?.scope) {
      scopedPlan = `Branch scope: ${input.branchInfo.scope}\n\n${plan}`;
    }

    const ticketType = this.ctxHelper.taskLabel(ctx);

    // Worktree mode (Phase 1): local builds run in a per-flow git worktree
    // created once at build start — the registered checkout (hub) is never
    // checked out or mutated. Creation failure fails the node (no hub
    // fallback); deps-setup failure is non-fatal (setupNote on the prompt).
    let worktree: string | null = null;
    let setupNote: string | null = null;
    if (mode === "local") {
      const binding = await worktreeManager.ensureFlowWorktree(ctx, branch, { nodeId: node.id });
      worktree = binding.dir;
      setupNote = binding.setupNote;
    }

    let instructions = mode === "local"
      ? `Implement the following approved plan for a ${ticketType} ticket. Your working directory is a git worktree already checked out on branch "${branch}" (fresh off the repo's default branch). Make the code changes, commit them to that branch, and push the branch to origin. Do NOT open a merge request, do not switch branches, and do not touch any checkout outside this directory.`
      : `Implement the following approved plan for a ${ticketType} ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;
    // non-fatal worktree deps setup: one line in the run prompt — the agent
    // can self-repair by running the repo's dependency setup itself
    if (setupNote) instructions += `\n${setupNote} If the build needs dependencies, run the repo's dependency setup yourself before building/testing.`;

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
      { ticket: this.ctxHelper.taskContext(ctx), branch, mode },
      { instructions, plan: scopedPlan, checklist },
      input.prompt,
      { userRules },
    );

    return this.execute(ctx, {
      input: { ...input, prompt, branch: input.branchInfo?.name ?? null },
      prompt,
      agent: {
        mode: "agent",
        name: input.branchInfo ? `build ${ctx.task.key} (${input.branchInfo.name})` : `build ${ctx.task.key}`,
        autoCreatePR: false,
        // worktree mode: the branch already exists (created with the worktree);
        // cloud mode: the agent branches off the default ref itself
        startingRef: mode === "local" ? branch : (ctx.repo?.default_branch ?? "main"),
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources: mcpSourcesOf(config),
      },
      label,
      finalize: (result) => this.finalizeBuild(ctx, result, branch, input.branchInfo, node.id),
    });
  }

  private async finalizeBuild(
    ctx: FlowCtx,
    result: AgentRunResult,
    branch: string,
    branchInfo: BuildBranchInfo | null,
    nodeId: string,
  ): Promise<RunOutcome> {
    // apply the build agent's structured progress report to the plan checklist
    planSteps.markDone(ctx.flow.id, nodeId, planSteps.parseBuildProgress(result.result ?? ""));

    const resultBranch =
      this.ctxHelper.execMode(ctx) === "local"
        // branch detection reads the worktree when the flow has one — the
        // hub's HEAD is the developer's own checkout and must not be read
        ? (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx))) ?? branch
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
  private async refine(ctx: FlowCtx, feedback: string, promptOverride?: string | null, model?: string | null, userRules?: string): Promise<RunOutcome> {
    const node = this.node(ctx);
    if (!node.agent_id) {
      // no build agent yet — treat as a full build with the latest plan + note
      const plan = db.get<{ content: string }>(
        `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
         WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, ctx.flow.id);
      return this.run(ctx, this.inputSchema.parse({
        plan: (plan?.content ?? "") + `\n\nDeveloper note: ${feedback}`,
        model: model ?? null,
      }), this.nodeConfig(ctx));
    }

    let prompt = prompts.resolve("build_refine", {}, { feedback }, promptOverride, { userRules });
    // follow-ups run in the same worktree the build used (ensure creates it
    // when the flow predates worktrees or the tree was swept)
    let worktree: string | null = null;
    let setupNote: string | null = null;
    if (this.ctxHelper.execMode(ctx) === "local") {
      const binding = await worktreeManager.ensureFlowWorktree(
        ctx, ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx), { nodeId: node.id });
      worktree = binding.dir;
      setupNote = binding.setupNote;
      if (setupNote) prompt += `\n${setupNote} If the changes need dependencies, run the repo's dependency setup yourself before building/testing.`;
    }
    const outcome = await this.execute(ctx, {
      input: { feedback, prompt: promptOverride ?? null, model: model ?? null },
      prompt,
      agent: {
        mode: "agent",
        name: `build refine ${ctx.task.key}`,
        followUpOn: node.agent_id,
        startingRef: ctx.flow.mr_branch ?? undefined,
        cwd: worktree ?? undefined,
        model,
        settingSources: mcpSourcesOf(this.nodeConfig(ctx)),
      },
      label: "build refine",
      finalize: async (result) => {
        const branch =
          ctx.flow.mr_branch ??
          (this.ctxHelper.execMode(ctx) === "local"
            ? (await localGit.currentBranch(this.ctxHelper.requireRunCwd(ctx)))
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
    const outcome = await this.run(ctx, this.inputSchema.parse({ feedback: content }), this.nodeConfig(ctx));
    return outcome.reply;
  }

  /**
   * Live prompt preview (verbatim from the route's former build case): the
   * body knob is a verbatim prompt override for build (I3 — unified in a later
   * phase); the default preview resolves the full template (plan +
   * instructions are the body). The checklist the run appends is Phase-2
   * preview work (I6).
   */
  override previewPrompt(ctx: FlowCtx, node: NodeRow | null, _params: PromptPreviewParams): NodePromptPreview | null {
    const config = this.previewConfig(node);
    const branch = ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    const mode = this.ctxHelper.execMode(ctx);
    const planRow = db.all<{ content: string }>(
      `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, ctx.flow.id)[0];
    const planContent = planRow?.content ?? "(no plan yet)";
    const instr = mode === "local"
      ? `Implement the following approved plan for a ${this.ctxHelper.taskLabel(ctx)} ticket. First create and check out a new git branch named "${branch}" (from the repo's default branch), then make the code changes, commit them, and push the branch to origin. Do NOT open a merge request.`
      : `Implement the following approved plan for a ${this.ctxHelper.taskLabel(ctx)} ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;
    const configBody = configString(config, "prompt_body") ?? null;
    // build's body knob is a verbatim prompt override; the default preview
    // resolves the full template (plan + checklist are the body here)
    const body = configBody ??
      prompts.resolve(NODE_KEYS.BUILD, { ticket: this.ctxHelper.taskContext(ctx), branch, mode }, { instructions: instr, plan: planContent });
    const asm = prompts.assemblePrompt(
      NODE_KEYS.BUILD, {}, undefined, { body, userRules: this.previewRules(node) },
    );
    return { templateKey: NODE_KEYS.BUILD, configBody, assembly: asm };
  }

  /**
   * Complete a build whose agent run was orphaned (server restarted mid-run)
   * but left commits on the build branch.
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
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
