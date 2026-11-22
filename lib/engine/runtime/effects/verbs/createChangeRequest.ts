import "server-only";

import type { Prisma } from "@prisma/client";
import { EVENT_KIND } from "../../../constants/vocabulary";
import type { BranchRow } from "../../../../db/rows";
import { FACT_KIND } from "../../../facts/types/facts";
import type { FactStore } from "../../../facts/factStore";
import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { MergeRequestService } from "../../../nodes/kinds/mergeRequest/mergeRequestExports";
import type { TransitionEvents } from "../../transitions/transitionEvents";
import { JOB_KIND } from "../../jobs/constants/jobVocabulary";
import { JobQueue } from "../../jobs/jobQueue";
import { mrCreateDedupKey } from "../../jobs/utils/jobDedupKeys";
import type { EffectVerb } from "../constants/effectVerbs";
import type { VerbCtx } from "./types/verbDescriptor";
import { EffectContractViolation } from "./effectContractViolation";

/**
 * The `create_change_request` verb (task 11, design §4.2 — findings A4/F2):
 * opens the git-host change request for the branch fact a declarative node's
 * run established, wrapping `MergeRequestService.create` — the 80%-built
 * branch→CR path (resolve branch, push in local mode, create-or-adopt on the
 * host, persist to the branch row) the SDLC chain drives through the
 * `mr_create` journal.
 *
 * Invariants upheld:
 * - The verb runs under the node's attempt claim — the declarative wildcard
 *   effect dispatched it after the approval transition won; nothing here
 *   touches `nodes.status`.
 * - Invariant 7 (F2): the MR-creation sequence is journaled write-ahead —
 *   one `mr_create` job per branch target enqueued BEFORE the host I/O,
 *   claimed atomically, and completed inside `create`'s persist transaction
 *   via the existing `onPersist` hook, so a crash cannot leave a persisted
 *   MR with a still-claimed journal job (the sweep's re-claim adopt path
 *   picks the MR up instead of duplicating it). Git/HTTP I/O runs before or
 *   after the DB batch, never inside — the service owns that discipline.
 * - Required fact `branch`: a node without an established branch fact fails
 *   loudly — a typed `effect_contract_violation` event naming the verb and
 *   the missing fact, then the typed error — never a silent no-op and never
 *   a half-established fact.
 *
 * Must never: write node status, reset the built-in gate/review chain (a
 * declarative effect does not own the built-in chain's handbacks), or run
 * host I/O inside the persist transaction.
 */
export class CreateChangeRequest {
  constructor(
    /** the closed verb id this instance runs (the descriptor's `id`) */
    private readonly verbId: EffectVerb,
    /** the branch→CR service the verb wraps */
    private readonly mr: MergeRequestService,
    /** the flow context loader (the engine's read model — call-time resolved) */
    private readonly ctxOf: (flowId: string) => Promise<FlowCtx>,
    /** the fact vocabulary read model (branch facts live in branch rows) */
    private readonly facts: Pick<FactStore, "branchFacts">,
    /** the typed event emission primitive (the feed's contract-violation kind) */
    private readonly events: Pick<TransitionEvents, "emit">,
  ) {}

  /** Run the verb. Returns `true` when the MR actually landed (or was
   *  adopted) — the wildcard effect's claim to the follow-on (Invariant 8);
   *  `false` when another live intent already owns the creation. */
  async run(ctx: VerbCtx): Promise<boolean> {
    const branch = await this.targetBranch(ctx);
    const jobs = new JobQueue();
    // write-ahead journal (Invariant 7): the intent exists before any host
    // I/O, deduped per branch target — a retried approve re-enqueues into
    // the SAME job row instead of a second creation
    const dedupKey = mrCreateDedupKey(ctx.flowId, branch);
    const { id: jobId, deduplicated } = await jobs.enqueue({
      kind: JOB_KIND.MR_CREATE,
      flowId: ctx.flowId,
      dedupKey,
      payload: {
        flowId: ctx.flowId,
        branchName: branch,
        emitNodeKey: ctx.nodeKey,
        // a declarative effect does not own the built-in gate/review
        // handbacks — the effect's follow-on is the template edge walk
        skipGateReviewReset: true,
      },
    });
    // A prior attempt may have failed the push (or host create) and left its
    // job queued with backoff, dedup key still held. An explicit re-trigger —
    // the "Open PR" click — re-arms that SAME job for an immediate in-request
    // retry instead of being deduplicated into a no-op. A worker with a live
    // claim owns the dispatch in that case; defer to it.
    const dispatchId = deduplicated
      ? await jobs.reviveForRetry(dedupKey, JOB_KIND.MR_CREATE)
      : jobId;
    if (!dispatchId) return false; // a live intent owns this branch's MR
    const job = await jobs.claimById(dispatchId);
    if (!job) return false; // the worker sweep owns the dispatch
    try {
      await this.mr.create(await this.ctxOf(ctx.flowId), branch, {
        emitNodeKey: ctx.nodeKey,
        skipGateReviewReset: true,
        // the MR rows' persist and the journal job's completion land in ONE
        // transaction (the service's own contract) — a crash cannot split
        // the established change_request fact from a still-claimed job
        onPersist: async (tx: Prisma.TransactionClient) => {
          await jobs.complete(dispatchId, tx);
          await jobs.clearDedupKey(dispatchId, tx);
        },
      });
    } catch (e: unknown) {
      // host/infra failure — requeue with backoff (the sweep's re-claim owns
      // the retry and its adopt path), then rethrow so the effect dispatch
      // surfaces the failure instead of advancing past a missing MR. The dedup
      // key stays held; a manual re-trigger revives this row via reviveForRetry.
      await jobs.fail(dispatchId, e instanceof Error ? e.message : String(e));
      throw e;
    }
    return true;
  }

  /** The branch fact the verb targets: the approve override's named branch
   *  when one rides the trigger params, else the flow's most recently
   *  updated branch fact (the latest run's established branch). A missing
   *  fact fails loudly — typed event, then the typed error. */
  private async targetBranch(ctx: VerbCtx): Promise<string> {
    const rows = await this.facts.branchFacts(ctx.flowId);
    const requested = ctx.params?.branchName;
    if (typeof requested === "string" && requested.length > 0) {
      const named = rows.find((row) => row.name === requested);
      if (!named) throw await this.refuse(ctx, `no branch fact named "${requested}" was established`);
      return named.name;
    }
    const latest = latestBranchFact(rows);
    if (!latest) throw await this.refuse(ctx, "no run has established a branch fact yet");
    return latest.name;
  }

  /** The loud refusal: the typed `effect_contract_violation` feed event
   *  naming the verb and the missing fact, attached to the dispatching node —
   *  the returned error is the caller's throw (the stage refuses; the MR was
   *  never touched). */
  private async refuse(ctx: VerbCtx, detail: string): Promise<EffectContractViolation> {
    const violation = new EffectContractViolation(this.verbId, FACT_KIND.BRANCH, detail);
    await this.events.emit(
      ctx.flowId,
      ctx.nodeKey,
      EVENT_KIND.EFFECT_CONTRACT_VIOLATION,
      `${ctx.nodeKey}: ${violation.message}`,
      { nodeKey: ctx.nodeKey, verb: this.verbId, fact: FACT_KIND.BRANCH },
    );
    return violation;
  }
}

/** The flow's most recently updated branch fact (ISO timestamps compare
 *  chronologically; `createdAt` breaks an exact tie). */
const latestBranchFact = (rows: BranchRow[]): BranchRow | null =>
  [...rows].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0] ?? null;
