import "server-only";

import { fanoutOf } from "../../templates/nodeConfig";
import { filesOf } from "./utils/stepFiles";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepState } from "./types/stepState";
import type { StepChildStore } from "./stepChildStore";
import type { StepRollup } from "./stepRollup";
import type { StepFlowExpander } from "./stepFlowExpander";

/**
 * StepScheduler — the fan-out slot budget (step 07 decomposition of
 * `StepFlowManager`, Phase 3A): starts unstarted children up to
 * `parallel_max` (default 1 = the original sequential behavior,
 * byte-for-byte), with file-overlap qualification and the rollup hand-off.
 *
 * Invariants upheld:
 * - A child occupies a slot while its node is `running` OR
 *   `awaiting_approval` (an approved-but-unmerged code child's work product
 *   is still outstanding — its successor would build against a branch that
 *   has not absorbed the merge; the per-branch arena lock + the stale-base
 *   machinery absorb the divergence when slots are genuinely parallel).
 * - Qualification: a candidate may join the in-flight set only when its
 *   `files` are disjoint from every overlapping earlier sibling that is in
 *   flight (empty `files` ⇒ overlap ⇒ sequential — no evidence of
 *   independence), including failed earlier CODE siblings (a failed code
 *   child stalls its overlapping neighbours — they'd build against a missing
 *   branch); failed NON-code children never block siblings.
 * - Start claims (`claimedStarts`) keep the parallel scheduler from starting
   * one child twice while the previous claim's bg start is still pending —
   * advance() runs synchronously, so an in-process map is enough; claims
   * expire after 60 s (a start that never took — engine bg failure — re-arms
   * the slot) and are dropped as soon as the child's node status leaves
   * `pending`.
 * - Merge attempts stay serialized by the merge arena's per-branch lock
 *   (FIFO — merges land in approval order; step order when the user approves
 *   in step order; an out-of-order landing is repaired by a merge commit via
 *   the stale-base path, never a rebase).
 *
 * Must never:
 * - write `nodes.status` or publish transitions — starting a child goes
 *   through the engine's `startStepChild` (its own claim path);
 * - publish the aggregate itself — it hands off to the `StepRollup` through
 *   the guarded `scheduleRollup` (one publish pass per parent node at a time);
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `StepFlowEngine` surface).
 */
export class StepScheduler {
  constructor(
    private readonly engine: () => StepFlowEngine,
    private readonly children: StepChildStore,
    private readonly rollup: StepRollup,
    /** the expander is wired after this class (the facade's construction order);
     *  every call site runs long after construction, so the lazy lookup is safe */
    private readonly expander: () => StepFlowExpander,
  ) {}

  private get e(): StepFlowEngine {
    return this.engine();
  }

  /** In-process start claims: advance() runs synchronously, so this is enough
   *  to keep the parallel scheduler from starting one child twice while the
   *  previous claim's bg start is still pending. Claims expire after 60 s (a
   *  start that never took — engine bg failure — re-arms the slot) and are
   *  dropped as soon as the child's node status leaves `pending`. */
  private claimedStarts = new Map<string, number>();

  /** In-process rollup guard: one publish pass per parent fan-out node at a time. */
  private rollupInflight = new Set<string>();

  /**
   * The scheduler: start unstarted children up to `parallel_max` (default 1 =
   * today's sequential behavior). A child occupies a slot while its node is
   * `running` OR `awaiting_approval` (an approved-but-unmerged code child's
   * work is still outstanding). Qualification: an earlier overlapping sibling
   * (files intersect, or either side has no file list) that is in flight
   * serializes the candidate — empty `files` ⇒ overlap ⇒ sequential. A failed
   * earlier CODE sibling keeps stalling its overlapping neighbours (they'd
   * build against a missing branch — the plan §3 rule, kept), while a failed
   * NON-code sibling releases the rest. Overlapping-code-sibling merges stay
   * serialized by the merge arena's per-branch lock; merges land in approval
   * order (step order when approvals arrive in step order; an out-of-order
   * landing is repaired by a merge commit — never a rebase).
   */
  async advance(parentFlowId: string, nodeKey: string): Promise<void> {
    const states = await this.rollup.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    // claims prevent double-starts when two hooks hit advance concurrently
    // (parallel scheduling widens the expand/terminal/merge hook overlap)
    const now = Date.now();
    for (const [id, at] of this.claimedStarts) {
      if (now - at > 60_000) this.claimedStarts.delete(id);
    }
    for (const s of states) if (s.childFlowId && s.childNodeStatus !== null) this.claimedStarts.delete(s.childFlowId);
    const maxParallel = Math.max(1, fanoutOf(await this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    const inFlight = states.filter((s) => s.isRunning || s.isAwaiting);
    let slots = maxParallel - inFlight.length;
    if (slots > 0) {
      const unresolved = new Set(
        states.flatMap((o) => (o.childFlowId != null && !o.isResolved ? [o.childFlowId] : [])),
      );
      const queue = states
        .filter((s): s is typeof s & { childFlowId: string } =>
          s.childFlowId != null &&
          s.childNodeStatus === null &&
          s.step.status === "pending" &&
          !this.claimedStarts.has(s.childFlowId))
        .sort((a, b) => a.step.position - b.step.position);
      for (const s of queue) {
        if (slots <= 0) break;
        const childFlowId = s.childFlowId;
        // an earlier overlapping sibling still in flight ⇒ sequential
        const blocked =
          states.some((o) =>
            o.childFlowId !== childFlowId &&
            o.childFlowId != null &&
            unresolved.has(o.childFlowId) &&
            o.step.position < s.step.position &&
            this.overlaps(o, s)) ||
          // a failed CODE child stalls its overlapping later neighbours;
          // failed non-code siblings (docs-agent style) never block
          states.some((o) =>
            o.childFlowId !== s.childFlowId &&
            o.isFailed &&
            o.isCodeChild &&
            o.step.position < s.step.position &&
            this.overlaps(o, s));
        if (blocked) continue;
        this.claimedStarts.set(childFlowId, now);
        await this.expander().refreshSiblings(parentFlowId, nodeKey, childFlowId, states);
        void this.e.startStepChild(childFlowId); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    this.scheduleRollup(parentFlowId, nodeKey);
  }

  /** Two steps overlap when their `files` lists share a path (empty lists ⇒ independent UNKNOWN ⇒ overlap). */
  private overlaps(a: StepState, b: StepState): boolean {
    const fa = filesOf(a.step);
    const fb = filesOf(b.step);
    if (!fa.length || !fb.length) return true;
    return fa.some((f) => fb.includes(f));
  }

  /** Fire-and-forget async fan-out work through the engine's guarded bg wrapper. */
  private fanoutAsync(parentFlowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    this.e.bg(parentFlowId, nodeKey, fn);
  }

  /**
   * The guarded rollup hand-off (fan-out-runtime internal, called by the
   * `StepRollup`'s child-terminal path and by the facade's wiring): one
   * publish pass per parent fan-out node at a time, fire-and-forget through
   * the engine's guarded bg wrapper.
   */
  scheduleRollup(parentFlowId: string, nodeKey: string): void {
    const key = `${parentFlowId}:${nodeKey}`;
    if (this.rollupInflight.has(key)) return;
    this.rollupInflight.add(key);
    this.fanoutAsync(parentFlowId, nodeKey, async () => {
      try {
        await this.rollup.checkRollup(parentFlowId, nodeKey);
      } finally {
        this.rollupInflight.delete(key);
      }
    });
  }
}
