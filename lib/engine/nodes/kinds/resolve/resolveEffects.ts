import "server-only";

/**
 * Applies the resolve contract's decisions against the MR and the local
 * comment rows — the effect-apply half of the contract (`ResolveOutputContract`
 * is the parse half). Replaces the blanket "resolve on any code change" gate
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
import { EVENT_KIND } from "../../../constants/vocabulary";
import type { GitHostResolver } from "../../../ports/gitHost";
import type { NodeSupport } from "../../shared/nodeSupport";
import { RESOLVE_COMMENT_ACTION } from "./constants/commentActions";
import type {
  HostRetrySleep,
  ResolveEffectCounts,
  ResolveEffectInput,
  ResolveEffectLedger,
  ResolveEffectResult,
} from "./types/resolveEffects";
import { planResolveEffects } from "./utils/planResolveEffects";
import { defaultSleep, withHostRetry } from "./utils/hostRetry";
import { replyHash } from "./utils/replyHash";
import { errorMessage } from "./utils/errorMessage";

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
      await this.support.emit(input.flowId, input.nodeId, EVENT_KIND.LOG, warning);
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

    const host = await this.gitHosts.forRepo(input.repoUrl, input.executionMode);
    const persist = async () => input.persistProgress(ledger);

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
          await this.support.recordAgentReply({
            flowId: input.flowId,
            mrIid: input.mrIid,
            discussionId: effect.threadId,
            body: effect.body,
            note,
          });
          await persist();
        } catch (e) {
          counts.hostFailures += 1;
          await this.support.emit(
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
        await this.support.resolveComments(effect.rowIds);
        counts.resolved += 1;
        await persist();
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
        await this.support.resolveComments(effect.rowIds);
        await persist();
      } catch (e) {
        counts.hostFailures += 1;
        await this.support.emit(
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
