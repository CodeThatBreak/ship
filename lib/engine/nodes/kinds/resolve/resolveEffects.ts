import "server-only";

/**
 * Applies the resolve contract's decisions against the MR and the local
 * comment rows — the effect-apply half of the contract (`ResolveOutputContract`
 * is the parse half). Replaces the blanket `shouldResolveCommentsOnHost` gate
 * (G2) with the per-comment decision matrix (§3) plus the G8/G9/G10 fixes:
 * non-resolvable threads never host-call, one host resolve per discussion
 * marks every row of the thread, and posted replies are recorded locally so
 * the poller/webhook cannot re-open them.
 *
 * Every host effect is retried in a bounded way (G5) and journaled into the
 * artifact ledger after it lands (the review `persistProgress` precedent), so
 * re-application — restart recovery (§6 layer 4) — skips what the host already
 * has instead of replying to itself (G10). Domain constants live in
 * `constants/` and the shared types in `types/resolveEffects.ts`.
 */
import { createHash } from "node:crypto";
import type { CommentRow } from "../../../../db/rows";
import { EVENT_KIND } from "../../../constants/vocabulary";
import type { GitHostResolver } from "../../../ports/gitHost";
import { GitHostApiError, GitHostTimeoutError } from "../../../ports/gitHostErrors";
import type { NodeSupport } from "../../shared/nodeSupport";
import { RESOLVE_COMMENT_ACTION } from "./constants/commentActions";
import { AI_RESOLVE_PREFIX } from "./constants/aiResolvePrefix";
import {
  HOST_RETRY_BASE_DELAY_MS,
  HOST_RETRY_EXTRA_ATTEMPTS,
  HOST_RETRY_MAX_DELAY_MS,
} from "./constants/hostRetry";
import { PUSH_STATE, type PushState } from "./constants/pushState";
import type { ResolveAgentResponse, ResolveCommentDecision } from "./schema";
import type {
  HostRetrySleep,
  ResolveEffectCounts,
  ResolveEffectInput,
  ResolveEffectLedger,
  ResolveEffectResult,
  ResolvePlan,
  ResolvePlannedEffect,
} from "./types/resolveEffects";
import { commentResolvable } from "./resolveContract";

// ── planning (pure) ──────────────────────────────────────────────────────────

/**
 * Whether a `fixed` decision may close its thread (D1a): the fix is verified on
 * the remote MR head (`pushed`), or the agent explicitly took responsibility in
 * a posted reply while nothing is verified (`none` + reply). `local_only` and
 * `unknown` never close — a reviewer's thread is never about a commit the MR
 * head does not hold.
 */
export const resolveAuthority = (
  decision: ResolveCommentDecision,
  pushState: PushState,
): boolean =>
  pushState === PUSH_STATE.PUSHED ||
  (pushState === PUSH_STATE.NONE && decision.reply != null);

/**
 * The decision matrix (§3) as a pure planner: decisions × comment rows ×
 * `pushState` × resolvability → ordered effect list. Answers/wontfixes always
 * reply; a `fixed` decision closes its thread only under resolve authority —
 * on a resolvable thread that is the host resolve (G9 deduped, all rows marked),
 * on a non-resolvable thread (no discussion id, or `raw.resolvable = false`,
 * G8) the same decision closes locally and the host is never called. Replies
 * always precede their thread's resolve. Unauthorised decisions emit a warning
 * naming why the thread stays open; `none` + no reply additionally counts at
 * apply time as skipped.
 */
export const planResolveEffects = (input: {
  response: ResolveAgentResponse;
  open: readonly CommentRow[];
  pushState: PushState;
}): ResolvePlan => {
  const rows = new Map(input.open.map((r) => [r.id, r]));
  // two-phase slatting: every reply always precedes the resolve of its thread
  // (§4) — a later decision's reply in the same discussion lands before the
  // earlier decision's resolve
  const replyEffects: ResolvePlannedEffect[] = [];
  const closureEffects: ResolvePlannedEffect[] = [];
  const degradedSkips: ResolveCommentDecision[] = [];
  const warnings: string[] = [];
  const slatted = new Set<string>(); // per-thread effects already slatted (G9 dedupe)

  for (const decision of input.response.decisions) {
    const row = rows.get(decision.id);
    if (!row) continue; // coverage is the contract's job; the planner never invents rows

    if (decision.action === RESOLVE_COMMENT_ACTION.SKIPPED) continue; // counted at apply time

    const threadId = row.discussion_id;
    const hostable = threadId != null && commentResolvable(row);
    // one effect key per thread of each closure type — same-discussion rows
    // slat together, host resolves and local closes never collide (G9)
    const threadKey = hostable
      ? `resolve:${threadId}`
      : `local:${threadId ?? `note:${decision.id}`}`;

    if (decision.reply) {
      if (threadId != null) {
        replyEffects.push({
          kind: "reply",
          threadId,
          body: `${AI_RESOLVE_PREFIX}${decision.reply}`,
          commentId: decision.id,
        });
      } else {
        // G8: a threadless MR note cannot host a reply — say so, never a failure
        warnings.push(
          `comment ${decision.id} has no discussion thread — its reply could not be posted to the MR`,
        );
      }
    }

    if (!decision.resolve) continue; // answered/wontfix default: the reviewer closes the thread

    if (!resolveAuthority(decision, input.pushState)) {
      if (input.pushState === PUSH_STATE.NONE) {
        // the agent claimed fixed without a reply and nothing is verified —
        // the thread stays open and the decision counts as skipped (§3)
        degradedSkips.push(decision);
        warnings.push(
          `comment ${decision.id} stays open — declared fixed without a reply and nothing is verified on the MR`,
        );
      } else {
        warnings.push(
          `thread ${threadId ?? `for comment ${decision.id}`} stays open — ${
            input.pushState === PUSH_STATE.LOCAL_ONLY
              ? "the fix is committed locally but not pushed to the MR"
              : "the MR state could not be verified"
          }`,
        );
      }
      continue;
    }

    if (input.pushState === PUSH_STATE.NONE) {
      // resolved without a pushed fix — the agent took explicit, explained
      // responsibility in its posted reply; the warning says so (§3)
      warnings.push(
        `thread ${threadId ?? `for comment ${decision.id}`} resolved without a pushed fix — the agent explained in its reply`,
      );
    }

    if (slatted.has(threadKey)) continue;
    slatted.add(threadKey);

    const groupRows = threadId
      ? input.open.filter((r) => r.discussion_id === threadId)
      : [row];
    if (hostable) {
      closureEffects.push({ kind: "resolve", threadId: threadId as string, rowIds: groupRows.map((r) => r.id) });
    } else {
      // G8: handled on a non-resolvable thread — local close, nothing on the
      // host, never counted as a failure
      closureEffects.push({ kind: "localClose", rowIds: groupRows.map((r) => r.id), commentId: decision.id });
      warnings.push(
        `thread for comment ${decision.id} is not resolvable on the host — closed locally only`,
      );
    }
  }

  return { effects: [...replyEffects, ...closureEffects], degradedSkips, warnings };
};

// ── host retry (G5) ──────────────────────────────────────────────────────────

const defaultSleep: HostRetrySleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retries transient host failures only: timeouts, 429s, 5xx. 401/403/404 and anything else is permanent. */
const isRetryableHostError = (e: unknown): boolean => {
  if (e instanceof GitHostTimeoutError) return true;
  if (e instanceof GitHostApiError) return e.httpStatus === 429 || e.httpStatus >= 500;
  return false;
};

/**
 * ONE bounded retry wrapper per host call (G5): up to
 * {@link HOST_RETRY_EXTRA_ATTEMPTS} extra attempts with backoff
 * min(1s · 2ⁿ, 8s) — the host's `retryAfterMs` wins when it is present.
 */
const withHostRetry = async <T>(
  fn: () => Promise<T>,
  sleep: HostRetrySleep = defaultSleep,
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= HOST_RETRY_EXTRA_ATTEMPTS || !isRetryableHostError(e)) throw e;
      const backoff = Math.min(HOST_RETRY_BASE_DELAY_MS * 2 ** attempt, HOST_RETRY_MAX_DELAY_MS);
      const retryAfter = e instanceof GitHostApiError ? e.retryAfterMs : undefined;
      await sleep(retryAfter ?? backoff);
    }
  }
};

/** Stable idempotency key for one posted reply (`reviewCommentPostHash` precedent). */
const replyHash = (mrIid: number, threadId: string, body: string): string =>
  createHash("sha256").update(JSON.stringify({ mrIid, threadId, body })).digest("hex");

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// ── application ──────────────────────────────────────────────────────────────

/**
 * Applies the planned contract — constructor-injected `NodeSupport` +
 * `GitHostResolver` (AGENTS §3.1; the `ReviewNode` seam). Applies in plan
 * order, journals every landed effect into the ledger via
 * `persistProgress`, and never lets one failing effect stop the rest: a
 * permanently failing host effect emits an error event, counts, and the run
 * moves on with the thread left open.
 */
export class ResolveEffects {
  constructor(
    private readonly support: NodeSupport,
    private readonly gitHosts: GitHostResolver,
    private readonly sleep: HostRetrySleep = defaultSleep,
  ) {}

  async apply(input: ResolveEffectInput): Promise<ResolveEffectResult> {
    const plan = planResolveEffects(input);
    for (const warning of plan.warnings) {
      this.support.emit(input.flowId, input.nodeId, EVENT_KIND.LOG, warning);
    }

    const ledger: ResolveEffectLedger = {
      replies: [...input.ledger.replies],
      resolvedDiscussions: [...input.ledger.resolvedDiscussions],
    };
    const postedHashes = new Set(ledger.replies.map((r) => r.hash));
    const resolvedThreads = new Set(ledger.resolvedDiscussions);
    const counts: ResolveEffectCounts = {
      resolved: 0,
      replied: 0,
      wontfix: 0,
      skipped: 0,
      hostFailures: 0,
    };
    counts.wontfix += input.response.decisions.filter(
      (d) => d.action === RESOLVE_COMMENT_ACTION.WONTFIX,
    ).length;
    counts.skipped += plan.degradedSkips.length + input.response.decisions.filter(
      (d) => d.action === RESOLVE_COMMENT_ACTION.SKIPPED,
    ).length;

    const host = this.gitHosts.forRepo(input.repoUrl);
    const persist = () => input.persistProgress(ledger);

    for (const effect of plan.effects) {
      if (effect.kind === "reply") {
        const hash = replyHash(input.mrIid, effect.threadId, effect.body);
        if (postedHashes.has(hash)) continue; // re-application: the host already has the reply (G10)
        try {
          const note = await withHostRetry(
            () => host.replyToComment(input.repoUrl, input.mrIid, effect.threadId, effect.body),
            this.sleep,
          );
          ledger.replies.push({ hash, noteId: note.id });
          counts.replied += 1;
          // G10 self-ingestion guard: close the posted reply locally before the
          // poller/webhook can deliver it back as a new open comment
          this.support.recordAgentReply({
            flowId: input.flowId,
            mrIid: input.mrIid,
            discussionId: effect.threadId,
            body: effect.body,
            note,
          });
          persist();
        } catch (e) {
          counts.hostFailures += 1;
          this.support.emit(
            input.flowId,
            input.nodeId,
            EVENT_KIND.ERROR,
            `could not post reply to MR thread ${effect.threadId} for comment ${effect.commentId}: ${errorMessage(e).slice(0, 200)}`,
          );
        }
        continue;
      }

      if (effect.kind === "localClose") {
        // G8: nothing on the host — never a failure, just bookkeeping
        this.support.resolveComments(effect.rowIds);
        counts.resolved += 1;
        persist();
        continue;
      }

      if (resolvedThreads.has(effect.threadId)) continue; // re-application: the host already closes it
      try {
        await withHostRetry(
          () => host.resolveComment(input.repoUrl, input.mrIid, effect.threadId, true),
          this.sleep,
        );
        ledger.resolvedDiscussions.push(effect.threadId);
        counts.resolved += 1;
        // G9: mark every open row of the discussion behind the one host call
        this.support.resolveComments(effect.rowIds);
        persist();
      } catch (e) {
        counts.hostFailures += 1;
        this.support.emit(
          input.flowId,
          input.nodeId,
          EVENT_KIND.ERROR,
          `could not resolve MR thread ${effect.threadId}: ${errorMessage(e).slice(0, 200)}`,
        );
      }
    }

    return { ...counts, ledger };
  }
}
