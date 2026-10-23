import { db } from "../../../db";
import { z } from "zod";
import { gitLab } from "../../../integrations/gitlab";
import { prompts } from "../../prompts";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { configNumber, configString } from "../../node-config";
import { ReviewInput, ReviewOutput } from "./schema";

export class ReviewNode extends NodeDefinition<ReviewInput, ReviewOutput> {
  readonly key = NODE_KEYS.REVIEW;
  readonly label = "Review";
  readonly promptKeys = [NODE_KEYS.REVIEW] as const;
  readonly order = 40;
  readonly edges = [[NODE_KEYS.RESOLVE, "next"]] as const;

  readonly inputSchema = ReviewInput;
  readonly outputSchema = ReviewOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** cap the number of posted comments (0 = unlimited) */
    max_comments: z.number().int().min(0).default(0),
    /** inline per-file comments (today) or a single summary note */
    comment_style: z.enum(["inline", "summary"]).default("inline"),
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "max_comments", label: "Max comments", type: "number", help: "Cap on posted comments (0 = unlimited)." },
    {
      key: "comment_style", label: "Comment style", type: "select",
      options: [{ value: "inline", label: "Inline" }, { value: "summary", label: "Summary" }],
      help: "Inline per-file comments or one summary note.",
    },
  ] as const satisfies readonly ConfigField[];

  /** Resolve the MR (iid + git branch) for this review — per-branch or flow-level. */
  resolveMr(ctx: FlowCtx, branchName?: string | null): { mrIid: number; mrBranch: string | null } {
    if (branchName) {
      const bRow = db.get<{ mr_iid: number | null }>(
        `SELECT mr_iid FROM branches WHERE flow_id=? AND name=?`, ctx.flow.id, branchName);
      if (!bRow?.mr_iid) throw new Error(`no merge request for branch ${branchName} — approve the build first`);
      return { mrIid: bRow.mr_iid, mrBranch: this.ctxHelper.buildBranch(ctx, branchName) };
    }
    if (!ctx.flow.mr_iid) throw new Error("no merge request yet — approve the build to create one first");
    return { mrIid: ctx.flow.mr_iid, mrBranch: ctx.flow.mr_branch };
  }

  async run(ctx: FlowCtx, input: ReviewInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ReviewInput;
    }

    const { mrIid, mrBranch } = this.resolveMr(ctx, input.branchName);

    const changes = await gitLab.getMRChanges(ctx.flow.repo_url ?? "", mrIid);
    const diffText = ((changes.changes ?? []) as { old_path: string; new_path: string; diff: string }[])
      .map((c) => `--- ${c.old_path}\n+++ ${c.new_path}\n${c.diff}`)
      .join("\n")
      .slice(0, 60000);

    const instructions = input.instructions ? `Extra review focus from the developer: ${input.instructions}` : "";
    const label = input.branchName ? `review (${input.branchName})` : "review";
    const reviewCtx = {
      ticket_key: ctx.ticket.key,
      ticket_summary: ctx.ticket.summary,
      ticket_prd: ctx.ticket.prdText?.slice(0, 4000) ?? "",
    };

    const prompt = (input.prompt
      ? input.promptIsBody
        // user edited the body only — re-attach the internal instructions + diff
        ? `${input.prompt}\n\n${prompts.internalSuffix(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText })}`
        : input.prompt
      : prompts.resolve(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText })
    ).split("\n").filter(Boolean).join("\n");

    return this.execute(ctx, {
      input: { ...input, prompt },
      prompt,
      promptOverride: input.prompt,
      agent: {
        mode: "agent",
        name: `${label} ${ctx.ticket.key}`,
        startingRef: mrBranch ?? undefined,
        model: input.model,
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
          // single aggregated MR note instead of one comment per issue
          if (effective.length > 0) {
            const summary = effective
              .map((c) => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ""}\` — ` : ""}${c.body}`)
              .join("\n");
            await gitLab.createMRNote(ctx.flow.repo_url ?? "", mrIid, `**AI Review**\n\n${summary}`);
          }
          posted = effective.length;
        } else {
          for (const c of effective) {
            const body = c.file ? `**${c.file}${c.line ? `:${c.line}` : ""}** — ${c.body}` : c.body;
            await gitLab.createMRNote(ctx.flow.repo_url ?? "", mrIid, `**AI Review**\n\n${body}`);
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

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(ctx, this.inputSchema.parse({ instructions: content }), this.nodeConfig(ctx));
    return outcome.reply;
  }

  // Review posts MR notes — don't replay after a restart; let the user retry.
  async recover(): Promise<boolean> {
    return false;
  }
}
