import { db } from "../../../db";
import { z } from "zod";
import { localGit } from "../../../git/local";
import { gitHostRegistry } from "../../ports/git-host";
import { prompts } from "../../prompts";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { configString } from "../../node-config";
import { ResolveInput, ResolveOutput } from "./schema";

export class ResolveNode extends NodeDefinition<ResolveInput, ResolveOutput> {
  readonly key = NODE_KEYS.RESOLVE;
  readonly label = "Resolve";
  readonly promptKeys = [NODE_KEYS.RESOLVE] as const;
  readonly order = 50;
  readonly edges = [[NODE_KEYS.PIPELINE, "loop"]] as const;

  readonly inputSchema = ResolveInput;
  readonly outputSchema = ResolveOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** quiet-period minutes before the debounced resolve fires (legacy: resolve.delay_ms / RESOLVE_DELAY_MINUTES); null = legacy behavior (10 min) — engine-consumed */
    quiet_minutes: z.number().min(0).optional(),
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "quiet_minutes", label: "Quiet period (min)", type: "number", help: "Minutes of comment quiet before the debounced resolve fires. Empty = 10 (or RESOLVE_DELAY_MINUTES)." },
  ] as const satisfies readonly ConfigField[];

  async run(ctx: FlowCtx, input: ResolveInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ResolveInput;
    }

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

    // capture the MR head + local branch state before the run — compared after
    // to decide whether the agent actually modified code (gates the re-review loop)
    const before = await this.captureState(ctx, mrIid, mrBranch);

    return this.execute(ctx, {
      input: { ...input, prompt },
      prompt,
      promptOverride: input.prompt,
      agent: {
        mode: "agent",
        name: `${label} ${ctx.task.key}`,
        startingRef: mrBranch ?? undefined,
        model: input.model,
      },
      label,
      finalize: async (result) => {
        if (open.length && mrIid) {
          for (const c of open) {
            if (c.discussion_id) {
              await gitHostRegistry
                .forRepo(ctx.flow.repo_url ?? "")
                .resolveComment(ctx.flow.repo_url ?? "", mrIid, c.discussion_id, true)
                .catch(() => {});
            }
            db.run(`UPDATE comments SET status='resolved', resolved_by='agent', updated_at=? WHERE id=?`, db.now(), c.id);
          }
        }
        const codeChanged = await this.detectCodeChange(ctx, mrIid, mrBranch, before);
        return {
          status: "done" as const,
          output: this.outputSchema.parse({ resolved: open.length, branchName: input.branchName ?? undefined, codeChanged }),
          artifact: { kind: "resolve", content: result.result ?? "", meta: { resolved: open.length, branchName: input.branchName ?? undefined, codeChanged } },
          event: `resolved ${open.length} comment(s)${input.branchName ? ` (${input.branchName})` : ""}` +
            `${codeChanged ? "" : " — no code changes, skipping re-review"}`,
          eventData: { codeChanged },
          reply: result.result ?? "",
        };
      },
    });
  }

  /** MR head SHA + local branch fingerprint before a run (null when unusable). */
  private async captureState(
    ctx: FlowCtx,
    mrIid: number | null,
    mrBranch: string | null,
  ): Promise<{ mrSha: string | null; localRef: string | null }> {
    const mrSha = mrIid
      ? ((await gitHostRegistry
          .forRepo(ctx.flow.repo_url ?? "")
          .getChangeRequest(ctx.flow.repo_url ?? "", mrIid)
          .catch(() => null))?.sha ?? null)
      : null;
    const lp = this.ctxHelper.localPath(ctx);
    const localState = lp && mrBranch
      ? await localGit.localBranchState(lp, mrBranch, ctx.repo?.default_branch ?? "main").catch(() => null)
      : null;
    return { mrSha, localRef: localState?.stat ?? null };
  }

  /**
   * True only when the agent actually changed code: the MR head SHA moved, or (in
   * local mode) the branch's diff-vs-base fingerprint changed — e.g. local
   * commits that haven't been pushed yet, which the SHA alone would miss since
   * the MR head only moves on push. One re-check after a short delay guards
   * against a push landing between the run finishing and the first read.
   */
  private async detectCodeChange(
    ctx: FlowCtx,
    mrIid: number | null,
    mrBranch: string | null,
    before: { mrSha: string | null; localRef: string | null },
  ): Promise<boolean> {
    const RECHECK_MS = 5_000;
    for (const delay of [0, RECHECK_MS]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (mrIid && before.mrSha) {
        const afterSha = (await gitHostRegistry
          .forRepo(ctx.flow.repo_url ?? "")
          .getChangeRequest(ctx.flow.repo_url ?? "", mrIid)
          .catch(() => null))?.sha;
        if (afterSha && afterSha !== before.mrSha) return true;
      }
      const lp = this.ctxHelper.localPath(ctx);
      if (lp && mrBranch && before.localRef != null) {
        const afterState = await localGit.localBranchState(lp, mrBranch, ctx.repo?.default_branch ?? "main").catch(() => null);
        if (afterState?.stat && afterState.stat !== before.localRef) return true;
      }
    }
    return false;
  }

  override async chat(ctx: FlowCtx, content: string): Promise<string> {
    const outcome = await this.run(ctx, this.inputSchema.parse({ instructions: content }), this.nodeConfig(ctx));
    return outcome.reply;
  }

  // Resolve commits fixes and closes discussions — don't replay after a restart.
  async recover(): Promise<boolean> {
    return false;
  }
}
