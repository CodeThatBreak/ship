import "server-only";

import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import { z } from "zod";
import { gitHostRegistry, type ChangeRequest, type ChangeRequestDiffs, type GitHostResolver, type GitHostService } from "../../../ports/gitHost";
import { prompts } from "../../../prompts/promptLibrary";
import { untrustedData, type UntrustedDataResult } from "../../../prompts/untrustedData";
import { REVIEW_DIFF_CAP, TASK_PRD_CAP } from "../../../prompts/caps";
import { AgentRunNode, nodeRoles, nodeSupport, type FlowCtx, type NodePromptPreview, type PromptPreviewParams, type RunOutcome } from "../../shared/nodeSharedExports";
import type { RecoveryResult } from "../../shared/types/recovery";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { flowCtxHelper } from "../../shared/runContext";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { AgentRunner } from "../../../harness/harnessExports";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { ConfigField } from "../../../templates/nodeConfig";
import { mcpSourcesSchema } from "../../../templates/schemas/mcpSources";
import { configNumber, configString, mcpSourcesOf, mcpSourceConfigFields } from "../../../templates/nodeConfig";
import { mrTargetResolver } from "../../shared/mrTargetResolver";
import { ReviewConsumes, ReviewInput, ReviewOutput } from "./schema";
import {
  parseReviewComments,
  readPostedCommentHashes,
  reviewCommentPostHash,
} from "./reviewComments";

/** The review kind's node definition (§T3 chain review role, §T4 refinable): runs the AI review of the MR diff and declares the contract/config below. Definition only — execution lives in AgentRunNode + the kind's collaborators; this class never writes status directly. */
export class ReviewNode extends AgentRunNode<ReviewInput, ReviewOutput> {
  readonly key = NODE_KEYS.REVIEW;
  readonly label = "Review";
  /** §T4: chat messages refine the review — re-run with them as extra focus.
   *  The first turn before a run is the review prompt itself (composer-as-prompt,
   *  plan's precedent): it carries the prompt body, later ones the extra focus. */
  override readonly capabilities: NodeCapabilities = {
    panelTitle: "AI review",
    refinable: true,
    promptNode: NODE_KEYS.REVIEW,
    startLabel: "Run AI review",
  };
  /** Engine-dispatch metadata (§T3): the review kind occupies the chain's review role. */
  override readonly chainRole = NODE_KEYS.REVIEW;
  readonly promptKeys = [NODE_KEYS.REVIEW] as const;
  override readonly promptSections = [NODE_KEYS.REVIEW] as const;
  readonly order = 40;
  override readonly edges = [[NODE_KEYS.RESOLVE, "next"]] as const;

  readonly inputSchema = ReviewInput;
  readonly outputSchema = ReviewOutput;
  override readonly consumes = ReviewConsumes;
  /** validation-only: the review's posting path has no feedback turn — the
   *  first contract miss (or empty reply) is a failed node, retried manually */
  override readonly retryBudget = 0;

  /** Typed config knobs (defaults = today's behavior). */
  override readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** cap the number of posted comments (0 = unlimited) */
    max_comments: z.number().int().min(0).default(0),
    /** inline per-file comments (today) or a single summary note */
    comment_style: z.enum(["inline", "summary"]).default("inline"),
    /** ambient MCP servers for agent runs (Cursor local.settingSources) */
    mcp_sources: mcpSourcesSchema,
  });
  override readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "max_comments", label: "Max comments", type: "number", help: "Cap on posted comments (0 = unlimited)." },
    {
      key: "comment_style", label: "Comment style", type: "select",
      options: [{ value: "inline", label: "Inline" }, { value: "summary", label: "Summary" }],
      help: "Inline per-file comments or one summary note.",
    },
    ...mcpSourceConfigFields,
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
  async resolveMr(ctx: FlowCtx, branchName?: string | null): Promise<{ mrIid: number; mrBranch: string | null }> {
    return mrTargetResolver.resolve(ctx, branchName);
  }

  /**
   * The task PRD as a fenced untrusted-data block (cap unchanged at
   * TASK_PRD_CAP) — shared by run and preview so the two render byte-equal
   * text for the same task (I7). Null when the task carries no PRD: the empty
   * `{{ticket_prd}}` slot stays empty instead of fencing nothing.
   */
  private taskPrd(ctx: FlowCtx): UntrustedDataResult | null {
    return ctx.task.prdText
      ? untrustedData({ source: "task PRD", text: ctx.task.prdText, cap: TASK_PRD_CAP })
      : null;
  }

  /**
   * Live prompt preview (verbatim from the route's former review case). The
   * diff is run data — fetched at run time, so the preview shows the
   * contract/rules + ticket context with an empty diff slot.
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    const configBody = await nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.REVIEW,
      {
        ticket_key: ctx.task.key,
        ticket_type: this.ctxHelper.taskLabel(ctx),
        ticket_summary: ctx.task.summary ?? "",
        ticket_prd: this.taskPrd(ctx)?.text ?? "",
      },
      {
        instructions: params.instructions
          ? `Extra review focus from the developer: ${params.instructions}`
          : "",
      },
      { body: configBody },
    );
    return { templateKey: NODE_KEYS.REVIEW, configBody, assembly: asm };
  }

  async run(ctx: FlowCtx, input: ReviewInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the prompt-body knob folds into the per-run prompt override path
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = { ...input, prompt: body, promptIsBody: true } as ReviewInput;
    }

    const node = await this.node(ctx);

    const { mrIid, mrBranch } = await this.resolveMr(ctx, input.branchName);
    const repoUrl = ctx.flow.repoUrl ?? "";
    const host = await this.gitHosts.forRepo(repoUrl, ctx.flow.executionMode);

    const changes = await host.getChanges(repoUrl, mrIid);
    const changeRequest = await host.getChangeRequest(repoUrl, mrIid);
    const rawDiff = changes.changes
      .map((c) => `--- ${c.oldPath}\n+++ ${c.newPath}\n${c.diff}`)
      .join("\n");
    // untrusted host content rides the shared fence (cap value unchanged);
    // a cap that bites is loud in-prompt AND logged once here
    const diff = rawDiff ? untrustedData({ source: "MR diff", text: rawDiff, cap: REVIEW_DIFF_CAP }) : null;
    if (diff?.truncated) {
      await this.support.emit(
        ctx.flow.id,
        node.id,
        EVENT_KIND.LOG,
        `MR diff truncated to ${REVIEW_DIFF_CAP} of ${diff.originalLength} characters — the source material was capped`,
      );
    }
    const prd = this.taskPrd(ctx);
    if (prd?.truncated) {
      await this.support.emit(
        ctx.flow.id,
        node.id,
        EVENT_KIND.LOG,
        `task PRD truncated to ${TASK_PRD_CAP} of ${prd.originalLength} characters — the source material was capped`,
      );
    }
    const diffText = diff?.text ?? "";

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
      ticket_prd: prd?.text ?? "",
    };

    // byte-parity rule (I7): the internal-block whitespace is normalized inside
    // PromptLibrary — no per-node collapse here, preview and run stay identical
    const prompt = input.prompt
      ? input.promptIsBody
        // user edited the body only — re-attach the internal instructions + diff
        ? prompts.assemblePrompt(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText }, { body: input.prompt }).final
        : input.prompt
      : prompts.resolve(NODE_KEYS.REVIEW, reviewCtx, { instructions, diff: diffText });

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
      finalize: async (result) => this.reviewOutcome(ctx, node, result, input, config, {
        repoUrl,
        mrIid,
        host,
        changes,
        changeRequest,
      }),
    });
  }

  /**
   * The finalize pipeline shared by the live run and restart recovery: parse
   * the agent's comment list (empty or unparseable output is a FAILED node —
   * missing output is a first-class state, never a silent done-with-0; a valid
   * `[]` is the contract's "no findings" answer and completes with 0 comments),
   * post the comments through the `postedHashes` ledger (idempotent — a
   * recovery re-run posts only what the ledger does not hold), and build the
   * outcome.
   */
  private async reviewOutcome(
    ctx: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    input: ReviewInput,
    config: Record<string, unknown>,
    hostCtx: {
      repoUrl: string;
      mrIid: number;
      host: GitHostService;
      changes: ChangeRequestDiffs;
      changeRequest: ChangeRequest;
    },
  ): Promise<RunOutcome> {
    const { repoUrl, mrIid, host, changes, changeRequest } = hostCtx;
    const parsed = parseReviewComments(result.result ?? "");
    if (parsed.warning) {
      // step 05: empty or unparseable output is a failed node — the agent
      // produced no reviewable result; publishing `done` with 0 comments
      // fabricated a success. A valid `[]` carries no warning: it is a clean
      // review with no findings and completes below with `comments: 0`.
      await this.support.emit(ctx.flow.id, node.id, "log", parsed.warning);
      const message = parsed.warning;
      return {
        status: "failed" as const,
        output: this.outputSchema.parse({ comments: 0, branchName: input.branchName ?? undefined }),
        artifact: {
          kind: "review",
          content: result.result ?? "",
          meta: { posted: 0, branchName: input.branchName ?? undefined, mrIid },
        },
        event: message,
        eventData: { error: message },
        reply: message,
      };
    }

    const commentStyle = configString(config, "comment_style") === "summary" ? "summary" : "inline";
    const prevArt = await this.support.latestArtifact(ctx.flow.id, "review", { nodeType: NODE_KEYS.REVIEW });
    const postedHashes = new Set(readPostedCommentHashes(prevArt?.meta));
    const maxComments = configNumber(config, "max_comments", 0);
    const effective = maxComments > 0 ? parsed.comments.slice(0, maxComments) : parsed.comments;

    let posted = 0;
    const newHashes: string[] = [...postedHashes];

    const persistProgress = async () => {
      await this.support.saveArtifact(
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
        await persistProgress();
      }
    } else {
      const inlineContext = {
        diffRefs: changeRequest.diffRefs,
        changes: changes.changes,
      };
      for (const c of effective) {
        const hash = reviewCommentPostHash(mrIid, c, "inline");
        if (postedHashes.has(hash)) continue;
        const noteBody = `**AI Review**\n\n${c.body}`;
        const file = c.file?.trim();
        const line = c.line;
        if (file && typeof line === "number" && line > 0) {
          // step 05: an inline-post failure FAILS the node — the silent
          // MR-note fallback posted the comment in the wrong place and still
          // reported success. The ledger (persisted after every successful
          // post) makes the retry resume exactly where this run stopped.
          try {
            await host.createInlineComment(
              repoUrl,
              mrIid,
              { path: file, line, body: noteBody },
              inlineContext,
            );
          } catch (e: unknown) {
            const detail = e instanceof Error ? e.message : String(e);
            const message = `inline review comment on ${file}:${line} failed: ${detail}`;
            await this.support.emit(ctx.flow.id, node.id, EVENT_KIND.ERROR, message);
            return {
              status: "failed" as const,
              output: this.outputSchema.parse({ comments: posted, branchName: input.branchName ?? undefined }),
              artifact: {
                kind: "review",
                content: result.result ?? "",
                meta: { posted, postedHashes: newHashes, mrIid, branchName: input.branchName ?? undefined },
              },
              event: message,
              eventData: { error: detail },
              reply: message,
            };
          }
        } else {
          await host.createComment(repoUrl, mrIid, noteBody);
        }
        newHashes.push(hash);
        postedHashes.add(hash);
        posted++;
        await persistProgress();
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
  }

  /** Chat maps the message onto the node's guidance field (§T4b recipe). */
  protected override chatInput(content: string, model?: string): Record<string, unknown> {
    return { instructions: content, model: model ?? null };
  }

  /**
   * The first turn on a never-run node runs the review with the message as
   * the prompt body (the shape the retired prompt modal produced); turns
   * after a run are the `instructions` refine.
   */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (this.isFirstTurn(await this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        ReviewInput.parse({ prompt: content, promptIsBody: true, model: model ?? null }),
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    return super.chat(ctx, content, model);
  }

  /**
   * Restart recovery re-runs the posting path against the recorded agent
   * result — the `postedHashes` ledger (persisted after every successful
   * post) makes it idempotent, so a crash mid-posting resumes exactly where
   * the run stopped instead of always declining. Ordering note (step 06
   * hardens): the ledger write is not yet in the same transaction as the
   * host post, so a crash between the two can double-post one comment.
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the review run ended with ${result.status}` };
    }
    try {
      const input = ReviewInput.parse(node.input ?? {});
      const config = await this.nodeConfig(ctx);
      const { mrIid } = await this.resolveMr(ctx, input.branchName);
      const repoUrl = ctx.flow.repoUrl ?? "";
      const host = await this.gitHosts.forRepo(repoUrl, ctx.flow.executionMode);
      const changes = await host.getChanges(repoUrl, mrIid);
      const changeRequest = await host.getChangeRequest(repoUrl, mrIid);
      const outcome = await this.reviewOutcome(ctx, node, result, input, config, {
        repoUrl,
        mrIid,
        host,
        changes,
        changeRequest,
      });
      await this.applyOutcome(ctx, outcome, { note: `recovered: ${note}` });
      return { kind: "recovered" };
    } catch (e: unknown) {
      return { kind: "manual", reason: `re-running the review posting failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}
