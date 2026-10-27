import type { NodeRow } from "../../../db/rows";
import { z } from "zod";
import { localGit } from "../../../git/local";
import { gitHostRegistry } from "../../ports/git-host";
import { prompts } from "../../prompts";
import { NodeDefinition, type FlowCtx, type NodePromptPreview, type PromptPreviewParams, type RunOutcome } from "../base";
import type { NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields } from "../../node-config";
import { ResolveInput, ResolveOutput } from "./schema";
import { worktreeManager } from "../../worktree-lifecycle";

export class ResolveNode extends NodeDefinition<ResolveInput, ResolveOutput> {
  readonly key = NODE_KEYS.RESOLVE;
  readonly label = "Resolve";
  readonly capabilities: NodeCapabilities = { panelTitle: "Comment resolution" };
  readonly promptKeys = [NODE_KEYS.RESOLVE] as const;
  readonly promptSections = [NODE_KEYS.RESOLVE] as const;
  readonly order = 50;
  readonly edges = [[NODE_KEYS.PIPELINE, "loop"]] as const;

  readonly inputSchema = ResolveInput;
  readonly outputSchema = ResolveOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** user rules appended after the prompt body, before the engine's locked blocks */
    prompt_rules: z.string().optional(),
    /** quiet-period minutes before the debounced resolve fires; unset = the 10-min default — engine-consumed */
    quiet_minutes: z.number().min(0).optional(),
    /** ambient MCP servers for agent runs (Cursor local.settingSources) */
    mcp_sources: mcpSourcesSchema,
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "prompt_rules", label: "Your rules", type: "text", help: "Extra rules appended after the prompt body, before the engine's locked instructions and the open comments — on every run of this node." },
    { key: "quiet_minutes", label: "Quiet period (min)", type: "number", help: "Minutes of comment quiet before the debounced resolve fires. Empty = 10." },
    ...mcpSourceConfigFields,
  ] as const satisfies readonly ConfigField[];

  /**
   * Live prompt preview (verbatim from the route's former resolve case): the
   * body knob or default with the developer instructions; the header/
   * comment blocks are run data — computed at run time from open comments.
   */
  override previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    const configBody = this.previewBody(node);
    const branch = ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    const mode = this.ctxHelper.execMode(ctx);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.RESOLVE,
      { branch, mode },
      {
        dev_instructions: params.instructions ? `Developer instructions: ${params.instructions}` : "",
        instructions: mode === "local" ? `Start by checking out branch ${branch}.` : "",
      },
      { body: configBody, userRules: this.previewRules(node) },
    );
    return { templateKey: NODE_KEYS.RESOLVE, configBody, assembly: asm };
  }

  async run(ctx: FlowCtx, input: ResolveInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ResolveInput;
    }
    // the user's standing rules (prompt_rules knob) apply to every run
    const userRules = typeof config.prompt_rules === "string" ? config.prompt_rules : "";

    const node = this.node(ctx);

    // resolve MR IID — per-branch or flow-level
    let mrIid: number | null;
    let mrBranch: string | null;
    if (input.branchName) {
      const branchMrIid = this.support.branchMrIid(ctx.flow.id, input.branchName);
      if (!branchMrIid) throw new Error(`no merge request for branch ${input.branchName}`);
      mrIid = branchMrIid;
      mrBranch = this.ctxHelper.buildBranch(ctx, input.branchName);
    } else {
      mrIid = ctx.flow.mr_iid;
      mrBranch = ctx.flow.mr_branch;
    }

    const open = this.support.openComments(ctx.flow.id);
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

    // byte-parity rule (I7): internal-block whitespace is normalized inside
    // PromptLibrary — no per-node collapse, preview and run stay identical
    let prompt = input.prompt
      ? input.promptIsBody
        // user edited the body only — re-attach the internal instructions + comments
        ? prompts.assemblePrompt(NODE_KEYS.RESOLVE,
            { branch: mrBranch ?? undefined, mode },
            { header, subheader, instructions, dev_instructions, comments: list },
            { body: input.prompt, userRules },
          ).final
        : input.prompt
      : prompts.resolve(NODE_KEYS.RESOLVE,
          { branch: mrBranch ?? undefined, mode },
          { header, subheader, instructions, dev_instructions, comments: list },
          undefined,
          { userRules },
        );

    // capture the MR head + local branch state before the run — compared after
    // to decide whether the agent actually modified code (gates the re-review loop)
    const before = await this.captureState(ctx, mrIid, mrBranch);

    // comment fixes run in the flow's worktree (same tree the build used;
    // ensure is a no-op/reuse when it already exists with mrBranch checked out)
    let worktree: string | null = null;
    if (mode === "local" && mrBranch) {
      const binding = await worktreeManager.ensureFlowWorktree(ctx, mrBranch, { nodeId: node.id });
      worktree = binding.dir;
      // non-fatal deps setup: one line in the run prompt — the agent can
      // self-repair by running the repo's dependency setup itself
      if (binding.setupNote) prompt += `\n${binding.setupNote} If the fixes need dependencies, run the repo's dependency setup yourself before building/testing.`;
    }

    return this.execute(ctx, {
      input: { ...input, prompt },
      prompt,
      agent: {
        mode: "agent",
        name: `${label} ${ctx.task.key}`,
        startingRef: mrBranch ?? undefined,
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources: mcpSourcesOf(config),
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
            this.support.resolveComment(c.id);
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
