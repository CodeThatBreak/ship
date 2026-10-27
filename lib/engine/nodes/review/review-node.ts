import type { NodeRow } from "../../../db/rows";
import { z } from "zod";
import { gitHostRegistry } from "../../ports/git-host";
import { prompts } from "../../prompts/prompt-library";
import { AgentRunNode, nodeRoles, type FlowCtx, type NodePromptPreview, type PromptPreviewParams, type RunOutcome } from "../base";
import type { NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../templates/node-config";
import { configNumber, configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields } from "../../templates/node-config";
import { ReviewInput, ReviewOutput } from "./schema";

export class ReviewNode extends AgentRunNode<ReviewInput, ReviewOutput> {
  readonly key = NODE_KEYS.REVIEW;
  readonly label = "Review";
  /** §T4: chat messages refine the review — re-run with them as extra focus. */
  override readonly capabilities: NodeCapabilities = { panelTitle: "AI review", refinable: true };
  /** Engine-dispatch metadata (§T3): the review kind occupies the chain's review role. */
  override readonly chainRole = NODE_KEYS.REVIEW;
  readonly promptKeys = [NODE_KEYS.REVIEW] as const;
  readonly promptSections = [NODE_KEYS.REVIEW] as const;
  readonly order = 40;
  readonly edges = [[NODE_KEYS.RESOLVE, "next"]] as const;

  readonly inputSchema = ReviewInput;
  readonly outputSchema = ReviewOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** user rules appended after the prompt body, before the engine's locked blocks */
    prompt_rules: z.string().optional(),
    /** cap the number of posted comments (0 = unlimited) */
    max_comments: z.number().int().min(0).default(0),
    /** inline per-file comments (today) or a single summary note */
    comment_style: z.enum(["inline", "summary"]).default("inline"),
    /** ambient MCP servers for agent runs (Cursor local.settingSources) */
    mcp_sources: mcpSourcesSchema,
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "prompt_rules", label: "Your rules", type: "text", help: "Extra rules appended after the prompt body, before the engine's locked instructions (review contract, diff) — on every run of this node." },
    { key: "max_comments", label: "Max comments", type: "number", help: "Cap on posted comments (0 = unlimited)." },
    {
      key: "comment_style", label: "Comment style", type: "select",
      options: [{ value: "inline", label: "Inline" }, { value: "summary", label: "Summary" }],
      help: "Inline per-file comments or one summary note.",
    },
    ...mcpSourceConfigFields,
  ] as const satisfies readonly ConfigField[];

  /** Resolve the MR (iid + git branch) for this review — per-branch or flow-level. */
  resolveMr(ctx: FlowCtx, branchName?: string | null): { mrIid: number; mrBranch: string | null } {    if (branchName) {
      const mrIid = this.support.branchMrIid(ctx.flow.id, branchName);
      if (!mrIid) throw new Error(`no merge request for branch ${branchName} — approve the build first`);
      return { mrIid, mrBranch: this.ctxHelper.buildBranch(ctx, branchName) };
    }
    if (!ctx.flow.mr_iid) throw new Error("no merge request yet — approve the build to create one first");
    return { mrIid: ctx.flow.mr_iid, mrBranch: ctx.flow.mr_branch };
  }

  /**
   * Live prompt preview (verbatim from the route's former review case). The
   * diff is run data — fetched at run time, so the preview shows the
   * contract/rules + ticket context with an empty diff slot.
   */
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    const configBody = nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.REVIEW,
      {
        ticket_key: ctx.task.key,
        ticket_type: this.ctxHelper.taskLabel(ctx),
        ticket_summary: ctx.task.summary ?? "",
        ticket_prd: ctx.task.prdText?.slice(0, 4000) ?? "",
      },
      {
        instructions: params.instructions
          ? `Extra review focus from the developer: ${params.instructions}`
          : "",
      },
      { body: configBody, userRules: nodeRoles.previewRules(this, node) },
    );
    return { templateKey: NODE_KEYS.REVIEW, configBody, assembly: asm };
  }

  async run(ctx: FlowCtx, input: ReviewInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ReviewInput;
    }
    // the user's standing rules (prompt_rules knob) apply to every run
    const userRules = typeof config.prompt_rules === "string" ? config.prompt_rules : "";

    const { mrIid, mrBranch } = this.resolveMr(ctx, input.branchName);
    const repoUrl = ctx.flow.repo_url ?? "";
    const host = gitHostRegistry.forRepo(repoUrl);

    const changes = await host.getChanges(repoUrl, mrIid);
    const diffText = changes.changes
      .map((c) => `--- ${c.oldPath}\n+++ ${c.newPath}\n${c.diff}`)
      .join("\n")
      .slice(0, 60000);

    const instructions = input.instructions ? `Extra review focus from the developer: ${input.instructions}` : "";
    const label = input.branchName ? `review (${input.branchName})` : "review";
    // ticket_key/ticket_summary/ticket_prd are the PromptLibrary template
    // variables ({{ticket_key}} etc.) — legacy names, kept verbatim
    const reviewCtx = {
      ticket_key: ctx.task.key,
      ticket_type: this.ctxHelper.taskLabel(ctx),
      ticket_summary: ctx.task.summary,
      ticket_prd: ctx.task.prdText?.slice(0, 4000) ?? "",
    };

    // byte-parity rule (I7): the internal-block whitespace is normalized inside
    // PromptLibrary — no per-node collapse here, preview and run stay identical
    const prompt = input.prompt
      ? input.promptIsBody
        // user edited the body only — re-attach the internal instructions + diff
        ? prompts.assemblePrompt(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText }, { body: input.prompt, userRules }).final
        : input.prompt
      : prompts.resolve(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText }, undefined, { userRules });

    return this.execute(ctx, {
      input: { ...input, prompt },
      prompt,
      agent: {
        mode: "agent",
        name: `${label} ${ctx.task.key}`,
        startingRef: mrBranch ?? undefined,
        model: input.model,
        settingSources: mcpSourcesOf(config),
      },
      label,
      finalize: async (result) => {
        let comments: { file?: string; line?: number; body: string }[] = [];
        try {
          const m = (result.result ?? "").match(/\[[\s\S]*\]/);
          comments = m ? JSON.parse(m[0]) : [];
        } catch { comments = []; }

        let posted = 0;
        const maxComments = configNumber(config, "max_comments", 0);
        const effective = maxComments > 0 ? comments.slice(0, maxComments) : comments;
        if (configString(config, "comment_style") === "summary") {
          // single aggregated CR note instead of one comment per issue
          if (effective.length > 0) {
            const summary = effective
              .map((c) => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ""}\` — ` : ""}${c.body}`)
              .join("\n");
            await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${summary}`);
          }
          posted = effective.length;
        } else {
          for (const c of effective) {
            const body = c.file ? `**${c.file}${c.line ? `:${c.line}` : ""}** — ${c.body}` : c.body;
            await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${body}`);
            posted++;
          }
        }
        return {
          status: "done" as const,
          output: this.outputSchema.parse({ comments: posted, branchName: input.branchName ?? undefined }),
          artifact: { kind: "review", content: result.result ?? "", meta: { posted, branchName: input.branchName ?? undefined } },
          event: `review complete${input.branchName ? ` (${input.branchName})` : ""}: ${posted} comment(s) posted`,
          reply: result.result ?? `Posted ${posted} comment(s).`,
        };
      },
    });
  }

  /** Chat maps the message onto the node's guidance field (§T4b recipe). */
  protected override chatInput(content: string, model?: string): Record<string, unknown> {
    return { instructions: content, model: model ?? null };
  }

  // Review posts MR notes — don't replay after a restart; let the user retry.
  async recover(): Promise<boolean> {
    return false;
  }
}
