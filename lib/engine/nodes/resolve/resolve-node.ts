import { db } from "../../../db";
import { gitLab } from "../../../integrations/gitlab";
import { prompts } from "../../prompts";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import { ResolveInput, ResolveOutput } from "./schema";

export class ResolveNode extends NodeDefinition<ResolveInput, ResolveOutput> {
  readonly key = NODE_KEYS.RESOLVE;
  readonly label = "Resolve";
  readonly promptKeys = [NODE_KEYS.RESOLVE] as const;
  readonly order = 50;
  readonly edges = [[NODE_KEYS.REVIEW, "loop"]] as const;

  readonly inputSchema = ResolveInput;
  readonly outputSchema = ResolveOutput;

  async run(ctx: FlowCtx, input: ResolveInput): Promise<RunOutcome> {
    const node = this.node(ctx);

    // resolve MR IID — per-branch or flow-level
    let mrIid: number | null;
    let mrBranch: string | null;
    if (input.branchName) {
      const bRow = db.get<{ mr_iid: number | null }>(
        `SELECT mr_iid FROM branches WHERE flow_id=? AND name=?`, ctx.flow.id, input.branchName);
      if (!bRow?.mr_iid) throw new Error(`no merge request for branch ${input.branchName}`);
      mrIid = bRow.mr_iid;
      mrBranch = this.ctxHelper.buildBranch(ctx, input.branchName);
    } else {
      mrIid = ctx.flow.mr_iid;
      mrBranch = ctx.flow.mr_branch;
    }

    const open = db.all<{ id: string; discussion_id: string | null; file_path: string | null; line: number | null; body: string }>(
      `SELECT * FROM comments WHERE flow_id=? AND status IN ('open')`, ctx.flow.id
    );
    if (!open.length && !input.instructions) {
      this.support.setNode(node.id, { status: "done", output: JSON.stringify(this.outputSchema.parse({ resolved: 0 })) });
      return {
        status: "done",
        output: this.outputSchema.parse({ resolved: 0 }),
        event: "no open comments",
        reply: "No open comments.",
      };
    }
    const list = open
      .map((c) => `- ${c.file_path ? `${c.file_path}${c.line ? `:${c.line}` : ""} — ` : ""}${c.body}`)
      .join("\n");

    const mode = this.ctxHelper.execMode(ctx);
    const label = input.branchName ? `resolve (${input.branchName})` : "resolve";
    const header = open.length
      ? `Address every open merge-request comment below by committing fixes to branch ${mrBranch}.`
      : `Make the following change on branch ${mrBranch}.`;
    const subheader = open.length ? `After fixing, briefly state what you changed for each comment.` : "";
    const instructions = mode === "local" ? `Start by checking out branch ${mrBranch}.` : "";
    const dev_instructions = input.instructions ? `Developer instructions: ${input.instructions}` : "";

    const prompt = (input.prompt
      ? input.promptIsBody
        // user edited the body only — re-attach the internal instructions + comments
        ? `${input.prompt}\n\n${prompts.internalSuffix(NODE_KEYS.RESOLVE,
            { branch: mrBranch ?? undefined, mode },
            { header, subheader, instructions, dev_instructions, comments: list })}`
        : input.prompt
      : prompts.resolve(NODE_KEYS.RESOLVE,
          { branch: mrBranch ?? undefined, mode },
          { header, subheader, instructions, dev_instructions, comments: list },
        )
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
        if (open.length && mrIid) {
          for (const c of open) {
            if (c.discussion_id) {
              await gitLab.resolveDiscussion(ctx.flow.repo_url ?? "", mrIid, c.discussion_id, true).catch(() => {});
            }
            db.run(`UPDATE comments SET status='resolved', resolved_by='agent', updated_at=? WHERE id=?`, db.now(), c.id);
          }
        }
        return {
          status: "done" as const,
          output: this.outputSchema.parse({ resolved: open.length, branchName: input.branchName ?? undefined }),
          artifact: { kind: "resolve", content: result.result ?? "", meta: { resolved: open.length, branchName: input.branchName ?? undefined } },
          event: `resolved ${open.length} comment(s)${input.branchName ? ` (${input.branchName})` : ""}`,
          reply: result.result ?? "",
        };
      },
    });
  }

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(ctx, this.inputSchema.parse({ instructions: content }));
    return outcome.reply;
  }

  // Resolve commits fixes and closes discussions — don't replay after a restart.
  async recover(): Promise<boolean> {
    return false;
  }
}
