import type { CommentRow } from "../../../../../db/rows";
import { RESOLVE_COMMENT_ACTION } from "../constants/commentActions";
import { AI_RESOLVE_PREFIX } from "../constants/aiResolvePrefix";
import { PUSH_STATE, type PushState } from "../constants/pushState";
import type { ResolveAgentResponse, ResolveCommentDecision } from "../schema";
import type { ResolvePlan, ResolvePlannedEffect } from "../types/resolveEffects";
import { commentResolvable } from "./commentResolvable";

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

    const threadId = row.discussionId;
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
      ? input.open.filter((r) => r.discussionId === threadId)
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
