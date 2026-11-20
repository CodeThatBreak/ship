import "server-only";

import { db } from "../../../db/app";
import type { Database } from "../../../db/database";
import { EVENT_KIND } from "../../constants/vocabulary";
import { TransitionAuthority } from "../transitions/nodeTransitions";
import { TransitionEvents } from "../transitions/transitionEvents";
import type {
  TriggerClaimParams,
  TriggerResult,
  TriggerSource,
  TriggerTransitionParams,
} from "./types/triggerGateway";

/**
 * TriggerGateway — the single claim door for every trigger entry point
 * (target-architecture §1, Invariant 11; step 06). Manual runs, retries,
 * chat turns, approvals, the post-MR chain stage triggers and the
 * auto/resume stage starts all resolve their duplicates HERE — at the
 * authority's atomic conditional claim — and every loser emits one typed
 * `skipped_duplicate_trigger` event (debug-level, dedup-friendly in the UI)
 * naming the source and the holder's attempt, then returns the
 * {@link TriggerResult} the routes map to 200 started / 409 skipped.
 *
 * Replaces the old read-then-act split (silent `chainBusy` returns vs
 * `ConflictError` throws vs swallowed claim conflicts) with one convention.
 *
 * Must never: dispatch a stage itself (the caller owns the post-claim work),
 * return silently on a lost claim (the skip event IS the contract), throw
 * for a duplicate or a lost from-set (validation errors — unknown node,
 * non-retryable kind — stay the caller's job, before the claim), or write
 * node status outside the authority.
 *
 * Constructed in `lib/composition` (decision Q9) — never a module singleton.
 */
export class TriggerGateway {
  constructor(
    private readonly transitions: TransitionAuthority,
    private readonly events: TransitionEvents,
    private readonly database: Database = db,
  ) {}

  /**
   * The atomic claim door for run-starting triggers. `key` selects the
   * trigger kind's declared from-set (`manualStage`, `manualResolve`,
   * `runFromPending`, `retry`, `chatRefine`, `resumeWait`); `chainKeys`
   * folds the chain-busy guard into the same conditional UPDATE.
   */
  async claimTrigger(params: TriggerClaimParams): Promise<TriggerResult> {
    const claim = await this.transitions.claimTrigger(params.flowId, params.nodeKey, params.key, {
      chainKeys: params.chainKeys,
    });
    if (claim.claimed) return { started: true, attemptId: claim.attemptId };
    await this.emitSkip(params.flowId, params.nodeKey, params.source, params.key, {
      status: claim.status,
      holderAttemptId: claim.holderAttemptId,
    });
    return { started: false, skipped: true, reason: "skipped_duplicate_trigger" };
  }

  /**
   * The atomic door for approval-style triggers (approve / build approve /
   * plan-retry revert): the keyed transition's from-set IS the fence — a
   * node not in it (already approved, or moved on) loses here with the same
   * typed skip event instead of the old ad-hoc `ConflictError` strings.
   */
  async transitionTrigger(params: TriggerTransitionParams): Promise<TriggerResult> {
    const applied = await this.transitions.apply(params.flowId, params.nodeKey, params.key, {
      toStatus: params.toStatus,
    });
    if (applied) return { started: true };
    const node = await this.database.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      params.flowId,
      params.nodeKey,
    );
    await this.emitSkip(params.flowId, params.nodeKey, params.source, params.key, {
      status: node?.status ?? null,
      holderAttemptId: null,
    });
    return { started: false, skipped: true, reason: "skipped_duplicate_trigger" };
  }

  /**
   * The typed skip event: one per losing trigger, debug-level (grouped in
   * the feed) — the failure is never silent, but it is also never an error.
   */
  private async emitSkip(
    flowId: string,
    nodeKey: string,
    source: TriggerSource,
    key: string,
    holder: { status: string | null; holderAttemptId: string | null },
  ): Promise<void> {
    const where = holder.status
      ? `node is ${holder.status}${holder.holderAttemptId ? ` (attempt ${holder.holderAttemptId})` : ""}`
      : "node is gone";
    await this.events.emit(
      flowId,
      nodeKey,
      EVENT_KIND.SKIPPED_DUPLICATE_TRIGGER,
      `${nodeKey}: ${key} trigger skipped — ${where} (source: ${source})`,
      {
        nodeKey,
        source,
        trigger: key,
        status: holder.status,
        holderAttemptId: holder.holderAttemptId,
      },
    );
  }
}
