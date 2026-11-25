import "server-only";

import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { NodeSupport } from "../../../nodes/shared/nodeSupport";
import type { GitHostResolver, GitHostService } from "../../../ports/gitHost";
import type { FactStore } from "../../../facts/factStore";
import type { TransitionEvents } from "../../transitions/transitionEvents";
import { ARTIFACT_KIND, EVENT_KIND } from "../../../constants/vocabulary";
import { FACT_KIND } from "../../../facts/types/facts";
import { configNumber, configString } from "../../../templates/nodeConfig";
import {
  parseReviewResponse,
  readPostedCommentHashes,
  reviewCommentPostHash,
} from "../../../nodes/kinds/review/reviewComments";
import { reviewCommentItemSchema, type ReviewCommentItem } from "../../../nodes/kinds/review/schema";
import {
  REVIEW_VERDICT,
  REVIEW_VERDICT_META_KEY,
  reviewVerdictOf,
} from "../../../nodes/kinds/review/constants/reviewVerdict";
import type { EffectVerb } from "../constants/effectVerbs";
import type { VerbCtx } from "./types/verbDescriptor";
import { EffectContractViolation } from "./effectContractViolation";

/**
 * The `publish_review_comments` verb (task 19, design §4.2 use case 7):
 * posts a declarative review run's parsed comments to the established change
 * request — inline per-file comments or one summary note, exactly the
 * built-in review node's posting path, now declarable by any node's
 * `effects.afterSuccess` config.
 *
 * Invariants upheld:
 * - The verb runs under the node's claim — the declarative wildcard effect
 *   dispatched it after the post-terminal door fired; nothing here touches
 *   `nodes.status`.
 * - Required fact `change_request`: a flow without an established change
 *   request fails loudly — a typed `effect_contract_violation` event naming
 *   the verb and the missing fact, then the typed error — never a silent
 *   no-op and never a host call against an unestablished MR.
 * - Idempotency (the built-in's `postedHashes` ledger): every successfully
 *   posted comment's stable hash persists into the `review` artifact's meta
 *   immediately after its host call, so a re-run (recovery, a second success
 *   door) posts only what the ledger does not hold — never a double-post.
 * - F2 / Invariant 7: git/host I/O runs outside any transaction; the ledger
 *   write is its own single-purpose artifact transaction AFTER the host call
 *   landed, which is what makes the ledger trustworthy as the resume point.
 *   (No `jobs` journal: the ledger is this sequence's idempotency mechanism,
 *   the review node's own precedent.)
 * - The review verdict (optional structured fact): a recognized
 *   `REVIEW_VERDICT` value on the node's output contract stamps the
 *   artifact meta, the downstream consumption riding the flow's contract
 *   layer (Invariant 5).
 *
 * Must never: write node status, resolve the MR itself (the established
 * `change_request` fact is the only target), or swallow a host failure —
 * the throw surfaces to the dispatcher and the ledger holds every comment
 * that DID land.
 */
export class PublishReviewComments {
  constructor(
    /** the closed verb id this instance runs (the descriptor's `id`) */
    private readonly verbId: EffectVerb,
    /** the repo-scoped git host resolution (the node-registered seam) */
    private readonly gitHosts: GitHostResolver,
    /** the flow context loader (the engine's read model — call-time resolved) */
    private readonly ctxOf: (flowId: string) => Promise<FlowCtx>,
    /** the fact vocabulary read model (the established change request) */
    private readonly facts: Pick<FactStore, "changeRequestFact">,
    /** the typed event emission primitive (the feed's error kind) */
    private readonly events: Pick<TransitionEvents, "emit">,
    /** the artifact persistence seam (the ledger's home — the node's rows) */
    private readonly support: Pick<NodeSupport, "nodeByKey" | "latestArtifact" | "saveArtifact">,
  ) {}

  /** Run the verb. Returns `true` when at least one comment landed this run
   *  — the wildcard effect's claim to the follow-on (Invariant 8); a fully
   *  idempotent re-run posts nothing and reports `false` (the default edge
   *  walk proceeds, byte-for-byte as if the verb were not declared). */
  async run(ctx: VerbCtx): Promise<boolean> {
    // the comments read from the node's PUBLISHED output (the output
    // contract's fact, Invariant 5) — the effect dispatch's context carries
    // identity only, so the node row is the one read model both dispatch
    // paths (the declarative wildcard and the panel verb door) share
    const node = await this.support.nodeByKey(ctx.flowId, ctx.nodeKey);
    const output = node.output ?? null;
    const comments = commentsFromOutput(output);
    const verdict = reviewVerdictOf(output);
    if (comments.length === 0) {
      // a clean review is a legitimate no-op: the run approved and flagged
      // nothing, so there is nothing to post and no host call to make. Only
      // an output that never said "clean" is the loud contract violation.
      if (verdict === REVIEW_VERDICT.APPROVE) return false;
      throw await this.refuse(ctx, "the node's output carries no parseable review comments");
    }
    const cr = await this.facts.changeRequestFact(ctx.flowId);
    if (!cr) throw await this.refuse(ctx, "no run has established a change request yet");

    const flowCtx = await this.ctxOf(ctx.flowId);
    const repoUrl = flowCtx.flow.repoUrl;
    if (!repoUrl) {
      throw new Error(`flow ${ctx.flowId} has no repo url — no git host to post review comments on`);
    }
    const host = await this.gitHosts.forRepo(repoUrl, flowCtx.flow.executionMode);
    const config = node.config ?? {};

    const style = configString(config, "comment_style") === "summary" ? "summary" : "inline";
    const maxComments = configNumber(config, "max_comments", 0);
    const effective = maxComments > 0 ? comments.slice(0, maxComments) : comments;

    const prev = await this.support.latestArtifact(ctx.flowId, ARTIFACT_KIND.REVIEW, { nodeType: node.type });
    const postedHashes = new Set(readPostedCommentHashes(prev?.meta));
    const newHashes: string[] = [...postedHashes];
    const content = JSON.stringify({ comments, ...(verdict ? { verdict } : {}) });
    const persistProgress = async (): Promise<void> => {
      await this.support.saveArtifact(node.id, ctx.flowId, ARTIFACT_KIND.REVIEW, content, {
        posted: newHashes.length,
        postedHashes: newHashes,
        mrIid: cr.mrIid,
        ...(cr.branchName ? { branchName: cr.branchName } : {}),
        ...(verdict ? { [REVIEW_VERDICT_META_KEY]: verdict } : {}),
      });
    };

    const posted =
      style === "summary"
        ? await this.postSummary(host, repoUrl, cr.mrIid, effective, postedHashes, newHashes, persistProgress)
        : await this.postInline(host, repoUrl, cr.mrIid, effective, postedHashes, newHashes, persistProgress, ctx);
    return posted > 0;
  }

  /** One summary note carrying every pending comment (the built-in's
   *  summary style): a single host call, one ledger entry per comment. */
  private async postSummary(
    host: GitHostService,
    repoUrl: string,
    mrIid: number,
    comments: readonly ReviewCommentItem[],
    postedHashes: ReadonlySet<string>,
    newHashes: string[],
    persistProgress: () => Promise<void>,
  ): Promise<number> {
    const pending = comments.filter((c) => !postedHashes.has(reviewCommentPostHash(mrIid, c, "summary")));
    if (pending.length === 0) return 0;
    const summary = pending
      .map((c) => `- ${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ""}\` — ` : ""}${c.body}`)
      .join("\n");
    await host.createComment(repoUrl, mrIid, `**AI Review**\n\n${summary}`);
    for (const c of pending) {
      newHashes.push(reviewCommentPostHash(mrIid, c, "summary"));
    }
    await persistProgress();
    return pending.length;
  }

  /** The inline style (the built-in's default): one per-file comment per
   *  pending item; a comment without a file/line falls back to a plain MR
   *  note. An inline-post failure FAILS the dispatch — the ledger persisted
   *  after every earlier post makes the retry resume exactly where this run
   *  stopped (the silent-MR-note-fallback lesson, step 05). */
  private async postInline(
    host: GitHostService,
    repoUrl: string,
    mrIid: number,
    comments: readonly ReviewCommentItem[],
    postedHashes: Set<string>,
    newHashes: string[],
    persistProgress: () => Promise<void>,
    ctx: VerbCtx,
  ): Promise<number> {
    let inlineContext: Awaited<ReturnType<typeof inlineContextOf>> | null = null;
    let posted = 0;
    for (const c of comments) {
      const hash = reviewCommentPostHash(mrIid, c, "inline");
      if (postedHashes.has(hash)) continue;
      const noteBody = `**AI Review**\n\n${c.body}`;
      const file = c.file?.trim();
      const line = c.line;
      if (file && typeof line === "number" && line > 0) {
        inlineContext ??= await inlineContextOf(host, repoUrl, mrIid);
        try {
          await host.createInlineComment(repoUrl, mrIid, { path: file, line, body: noteBody }, inlineContext);
        } catch (e: unknown) {
          const detail = e instanceof Error ? e.message : String(e);
          const message = `inline review comment on ${file}:${line} failed: ${detail}`;
          await this.events.emit(ctx.flowId, ctx.nodeKey, EVENT_KIND.ERROR, message);
          throw new Error(message);
        }
      } else {
        await host.createComment(repoUrl, mrIid, noteBody);
      }
      newHashes.push(hash);
      postedHashes.add(hash);
      posted++;
      await persistProgress();
    }
    return posted;
  }

  /** The loud refusal: the typed `effect_contract_violation` feed event
   *  naming the verb and the missing fact, attached to the dispatching node —
   *  the returned error is the caller's throw (the dispatcher refuses; no
   *  comment was ever posted). */
  private async refuse(ctx: VerbCtx, detail: string): Promise<EffectContractViolation> {
    const violation = new EffectContractViolation(this.verbId, FACT_KIND.CHANGE_REQUEST, detail);
    await this.events.emit(
      ctx.flowId,
      ctx.nodeKey,
      EVENT_KIND.EFFECT_CONTRACT_VIOLATION,
      `${ctx.nodeKey}: ${violation.message}`,
      { nodeKey: ctx.nodeKey, verb: this.verbId, fact: FACT_KIND.CHANGE_REQUEST },
    );
    return violation;
  }
}

/** The host position context one inline comment needs (the built-in's
 *  inlineContext shape): the MR's diff refs + the diff's file list, read
 *  once per run. */
const inlineContextOf = async (host: GitHostService, repoUrl: string, mrIid: number) => {
  const [changeRequest, changes] = await Promise.all([
    host.getChangeRequest(repoUrl, mrIid),
    host.getChanges(repoUrl, mrIid),
  ]);
  return { diffRefs: changeRequest.diffRefs, changes: changes.changes };
};

/** The review comments one verb run posts: the node's validated `comments`
 *  output when the output contract declares it, else the comment list parsed
 *  from the agent text the output carries (the built-in review node's parse,
 *  reused — one comment vocabulary, no drift). */
const commentsFromOutput = (output: Record<string, unknown> | null): ReviewCommentItem[] => {
  if (!output) return [];
  const declared = output["comments"];
  if (Array.isArray(declared)) {
    return declared.flatMap((item: unknown) => {
      const parsed = reviewCommentItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }
  for (const value of Object.values(output)) {
    if (typeof value === "string" && value.trim()) {
      const fromText = parseReviewResponse(value);
      if (fromText.outcome === "commented") return fromText.comments;
    }
  }
  return [];
};
