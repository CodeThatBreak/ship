import "server-only";

import type { NodeRow } from "../../../../db/rows";
import { z } from "zod";
import { gitHostRegistry, type GitHostResolver } from "../../../ports/git-host";
import { prompts } from "../../../prompts/prompt-library";
import { AgentRunNode, nodeRoles, nodeSupport, type FlowCtx, type NodePromptPreview, type PromptPreviewParams, type RunOutcome } from "../../shared";
import { flowCtxHelper, type FlowContextHelper } from "../../shared/run-context";
import type { NodeSupport } from "../../shared/node-support";
import type { AgentRunner } from "../../../harness";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/node-keys";
import type { ConfigField } from "../../../templates/node-config";
import { configNumber, configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields, splitConsumerConfigFields } from "../../../templates/node-config";
import { splitConsumeSchema, splitParallelMaxSchema } from "../../shared/split";
import { mrTargetResolver } from "../../shared/mr-target-resolver";
import { ReviewInput, ReviewOutput } from "./schema";
import {
  parseReviewComments,
  readPostedCommentHashes,
  reviewCommentPostHash,
} from "./review-comments";

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
    // split-consumption knob (agent-node split plan §2.4 — Phase 4): default whole = today
    split_consume: splitConsumeSchema,
    split_parallel_max: splitParallelMaxSchema,
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
    ...splitConsumerConfigFields,
  ] as const satisfies readonly ConfigField[];

  private readonly gitHosts: GitHostResolver;

  constructor(
    support: NodeSupport = nodeSupport,
    runner?: AgentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
    gitHosts: GitHostResolver = gitHostRegistry,
  ) {
    super(support, runner, ctxHelper);
    this.gitHosts = gitHosts;
  }

  /** Resolve the MR (iid + git branch) for this review — per-branch or flow-level. */
  resolveMr(ctx: FlowCtx, branchName?: string | null): { mrIid: number; mrBranch: string | null } {
    return mrTargetResolver.resolve(ctx, branchName);
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
    return { templateKey: NODE_KEYS.REVIEW, configBody, assembly: asm, rulesKey: "prompt_rules" };
  }

  async run(ctx: FlowCtx, input: ReviewInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ReviewInput;
    }
    // the user's standing rules (prompt_rules knob) apply to every run
    const userRules = typeof config.prompt_rules === "string" ? config.prompt_rules : "";

    const node = this.node(ctx);

    const { mrIid, mrBranch } = this.resolveMr(ctx, input.branchName);
    const repoUrl = ctx.flow.repo_url ?? "";
    const host = this.gitHosts.forRepo(repoUrl);

    const changes = await host.getChanges(repoUrl, mrIid);
    const diffText = changes.changes
      .map((c) => `--- ${c.oldPath}\n+++ ${c.newPath}\n${c.diff}`)
      .join("\n")
      .slice(0, 60000);

    const truncatedNote = changes.truncated
      ? "Note: the MR diff from GitLab was truncated (large change set). Review what is present and call out that the diff may be incomplete.\n"
      : "";
    const instructions = [
      truncatedNote,
      input.instructions ? `Extra review focus from the developer: ${input.instructions}` : "",
    ]
      .filter(Boolean)
      .join("");
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
        const parsed = parseReviewComments(result.result ?? "");
        if (parsed.warning) {
          this.support.emit(ctx.flow.id, node.id, "log", parsed.warning);
        }
        if (parsed.comments.length === 0 && (result.result ?? "").trim()) {
          return {
            status: "failed" as const,
            output: this.outputSchema.parse({ comments: 0, branchName: input.branchName ?? undefined }),
            artifact: {
              kind: "review",
              content: result.result ?? "",
              meta: { posted: 0, branchName: input.branchName ?? undefined, mrIid },
            },
            event: parsed.warning ?? "review could not parse comments from agent output",
            eventData: { error: parsed.warning },
            reply: parsed.warning ?? "Review output was not a valid comment list.",
          };
        }

        const commentStyle = configString(config, "comment_style") === "summary" ? "summary" : "inline";
        const prevArt = this.support.latestArtifact(ctx.flow.id, "review", { nodeType: NODE_KEYS.REVIEW });
        const postedHashes = new Set(readPostedCommentHashes(prevArt?.meta));
        const maxComments = configNumber(config, "max_comments", 0);
        const effective = maxComments > 0 ? parsed.comments.slice(0, maxComments) : parsed.comments;

        let posted = 0;
        const newHashes: string[] = [...postedHashes];

        const persistProgress = () => {
          this.support.saveArtifact(
            node.id,
            ctx.flow.id,
            "review",
            result.result ?? "",
            {
              posted: newHashes.length,
              postedHashes: newHashes,
              mrIid,
              branchName: input.branchName ?? undefined,
            },
          );
        };

        if (commentStyle === "summary") {
          const pending = effective.filter(
            (c) => !postedHashes.has(reviewCommentPostHash(mrIid, c, "summary")),
          );
          if (pending.length > 0) {
            const summary = pending
              .map((c) => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ""}\` — ` : ""}${c.body}`)
              .join("\n");
            await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${summary}`);
            for (const c of pending) {
              newHashes.push(reviewCommentPostHash(mrIid, c, "summary"));
            }
            posted = pending.length;
            persistProgress();
          }
        } else {
          for (const c of effective) {
            const hash = reviewCommentPostHash(mrIid, c, "inline");
            if (postedHashes.has(hash)) continue;
            const body = c.file ? `**${c.file}${c.line ? `:${c.line}` : ""}** — ${c.body}` : c.body;
            await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${body}`);
            newHashes.push(hash);
            postedHashes.add(hash);
            posted++;
            persistProgress();
          }
        }

        return {
          status: "done" as const,
          output: this.outputSchema.parse({ comments: posted, branchName: input.branchName ?? undefined }),
          artifact: {
            kind: "review",
            content: result.result ?? "",
            meta: {
              posted,
              postedHashes: newHashes,
              mrIid,
              branchName: input.branchName ?? undefined,
            },
          },
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
