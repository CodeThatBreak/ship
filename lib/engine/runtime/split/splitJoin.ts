import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import { FLOW_STATUS } from "../../../../constants/flow";
import { NODE_STATUS } from "../../constants/nodeStatus";
import {
  NODE_SUCCESS_STATUSES,
  NODE_TERMINAL_STATUSES,
} from "../transitions/constants/statusSets";
import { isNodeTerminalSuccess } from "../transitions/constants/statusSets";
import { splitParallelMaxOf } from "../../nodes/shared/split";
import { engineParts } from "@/lib/composition/container";
import type { QueryExecutor } from "../../../db/database";
import type { SplitUnitStatus } from "./types/splitUnitStatus";
import type { SplitUnitState } from "./types/splitUnitState";
import type { SplitEngineSurface } from "./types/splitEngineSurface";
import type { SplitLinkIndex } from "./types/splitLinkIndex";
import { WORST_OF_PRECEDENCE } from "./constants/worstOfPrecedence";

/**
 * SplitJoin — the split runtime's scheduler and join (step 07 decomposition
 * of `SplitManager`): starts eligible units (`advance` — declared
 * `dependsOn` + the `parallel_max` slot budget, default 1 — no file-overlap
 * inference, no plan-shaped assumptions), derives the unit states the
 * scheduler, the join and the per-unit actions all read (`unitStates`,
 * `unitStatusOf`, `childOutput`), and owns the consumer's aggregate
 * publication (`finishSplit`, moved verbatim from `flowEngine.finishSplit`
 * in the step-07 decomposition — the worst-of precedence, the
 * `splitOutcome` publish through the transition authority, the advance on a
 * success terminal), plus the child-terminal hook (`onChildFinished`) that
 * reschedules the parent's units.
 *
 * Invariants upheld:
 * - The aggregate publish is attempt-fenced: the expand-time attempt token
 *   (`consumerAttempts`, captured through `captureAttempt`) makes a stale
 *   aggregate lose to the user's re-claim; step 03 makes this durable.
 * - A unit occupies a slot while `running` or `awaiting_approval` (approval
 *   is mid-work — the same slot semantics the step fan-out scheduler uses);
 *   the in-process `claimedStarts` guard keeps concurrent advance hooks from
 *   starting one unit's child twice while a previous start's bg run is still
 *   pending (claims expire after 60 s and drop once the unit leaves
 *   `pending`).
 * - The `blocked` closure is transitive: a pending unit behind a
 *   failed/skipped/blocked dependency is blocked too.
 * - The join is idempotent: later hooks re-publish the same aggregate until
 *   every entry is terminal (a retried unit flips its entry).
 *
 * Must never:
 * - write `nodes.status` outside the transition authority (the aggregate
 *   publishes only through `engineParts.transitions.publishAggregate`);
 * - create or expand children (the `SplitExpander` owns expansion);
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `SplitEngineSurface`).
 */
export class SplitJoin {
  constructor(
    private readonly engine: () => SplitEngineSurface,
    private readonly linkage: SplitLinkIndex,
  ) {}

  private get e(): SplitEngineSurface {
    return this.engine();
  }

  /** Consumer attempt tokens captured at expand — the join's aggregate publish is attempt-fenced
   * (stale aggregates lose to the user's re-claim; step 03 makes this durable). */
  private readonly consumerAttempts = new Map<string, string>();

  /** The expander records the consumer claim's attempt token so the aggregate publish is fenced. */
  captureAttempt(parentFlowId: string, consumerNodeKey: string, attemptId: string): void {
    this.consumerAttempts.set(`${parentFlowId}\n${consumerNodeKey}`, attemptId);
  }

  /** In-process start claims (see advance) — the split scheduler's guard
   *  against starting one unit's child twice while a previous start's bg run
   *  is still pending. */
  private claimedStarts = new Map<string, number>();

  /**
   * Start eligible units — all `dependsOn` keys resolved `done` + a free
   * slot — up to `parallel_max` (the consumer's `split_parallel_max` knob,
   * default 1). No file-overlap inference: a failed unit fails its
   * dependents (they surface `blocked`); non-dependents proceed. Then runs
   * the join check (a start can complete the unit set).
   */
  async advance(parentFlowId: string, consumerNodeKey: string): Promise<void> {
    const states = await this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    const parallelMax = splitParallelMaxOf(
      await this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    // claims prevent double-starts when two hooks hit advance concurrently
    // (a child terminal + a user action can interleave): a start that never
    // took re-arms the slot after 60 s; the claim is dropped as soon as the
    // unit leaves `pending` (running / awaiting / terminal)
    const now = Date.now();
    for (const [id, at] of this.claimedStarts) {
      if (now - at > 60_000) this.claimedStarts.delete(id);
    }
    for (const s of states) if (s.childFlowId && s.status !== "pending") this.claimedStarts.delete(s.childFlowId);
    // a unit occupies a slot while running or awaiting approval (approval is
    // mid-work — the same slot semantics the step fan-out scheduler uses)
    const inFlight = states.filter((s) => s.status === "running" || s.status === "awaiting_approval").length;
    let slots = parallelMax - inFlight;
    if (slots > 0) {
      for (const s of states) {
        if (slots <= 0) break;
        if (!s.childFlowId || s.status !== "pending") continue;
        if (this.claimedStarts.has(s.childFlowId)) continue;
        if (!s.dependsOn.every((d) => states.find((x) => x.key === d)?.status === "done")) continue;
        this.claimedStarts.set(s.childFlowId, now);
        await this.e.startStepChild(s.childFlowId); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    await this.checkJoin(parentFlowId, consumerNodeKey);
  }

  /**
   * All unit states a consumer node owns, in unit (expansion) order — the
   * scheduler's, the join's and the actions' single view. Includes the
   * `blocked` closure: a pending unit whose dependency failed/skipped/blocked
   * (or is unknown — it could never resolve) can never start.
   */
  async unitStates(parentFlowId: string, consumerNodeKey: string): Promise<SplitUnitState[]> {
    const links = await this.linkage.linksOf(parentFlowId, consumerNodeKey);
    const states: SplitUnitState[] = await Promise.all(links.map(async (link) => {
      const flow = await db.prisma.flow.findUnique({ where: { id: link.childFlowId }, select: { status: true } });
      const flowStatus = flow?.status ?? null;
      const statuses = (await db.prisma.node.findMany({
        where: { flowId: link.childFlowId }, select: { status: true }, orderBy: { createdAt: "asc" },
      })).map((n) => n.status);
      const status = SplitJoin.unitStatusOf(statuses, flowStatus);
      return {
        key: link.unitKey,
        title: link.unit.title,
        dependsOn: link.unit.dependsOn,
        childFlowId: link.childFlowId,
        status,
        output: await this.childOutput(link.childFlowId),
      };
    }));
    // the blocked closure: computed off the derived statuses (a pending unit
    // behind a failed/skipped/blocked dependency is blocked too — transitively)
    const byKey = new Map(states.map((s) => [s.key, s]));
    const resolved = new Map<string, SplitUnitStatus>();
    const statusWithBlocked = (key: string, seen: Set<string>): SplitUnitStatus => {
      const memo = resolved.get(key);
      if (memo) return memo;
      const s = byKey.get(key);
      if (!s) return "blocked"; // a dependency on an unknown key never resolves
      if (s.status !== "pending") return s.status;
      if (seen.has(key)) return s.status; // defensive — cycles fail at expansion
      seen.add(key);
      const blocked = s.dependsOn.some((d) => {
        const ds = statusWithBlocked(d, seen);
        return ds === "failed" || ds === "skipped" || ds === "blocked";
      });
      const out = blocked ? "blocked" : s.status;
      resolved.set(key, out);
      return out;
    };
    for (const s of states) statusWithBlocked(s.key, new Set());
    return states.map((s) => {
      const status = resolved.get(s.key) ?? s.status;
      return { ...s, status };
    });
  }

  /** Roll a child's node set to one unit status: skipped (flow-level marker) >
   *  failed > awaiting_approval > running > done > pending. */
  public static unitStatusOf(statuses: string[], flowStatus: string | null): SplitUnitStatus {
    if (flowStatus === FLOW_STATUS.SKIPPED) return "skipped";
    if (statuses.some((s) => s === FLOW_STATUS.FAILED)) return "failed";
    if (statuses.some((s) => s === FLOW_STATUS.AWAITING_APPROVAL)) return "awaiting_approval";
    if (statuses.some((s) => s === FLOW_STATUS.RUNNING)) return "running";
    if (statuses.length && statuses.every((s) => NODE_SUCCESS_STATUSES.includes(s))) {
      return "done";
    }
    if (flowStatus === FLOW_STATUS.DONE) return "done";
    return "pending";
  }

  /** A child's merged node outputs (last write wins per key; {} when none). */
  private async childOutput(childFlowId: string): Promise<Record<string, unknown>> {
    const outs = await db.prisma.node.findMany({
      where: { flowId: childFlowId, output: { not: Prisma.DbNull } }, select: { output: true },
      orderBy: { updatedAt: "asc" },
    });
    const merged: Record<string, unknown> = {};
    for (const row of outs) {
      if (row.output == null) continue;
      try {
        const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(merged, parsed);
        }
      } catch { /* unparseable output column — skipped */ }
    }
    return merged;
  }

  /**
   * The join check: when no unit can advance — none running, none unstarted
   * with all dependencies done — publish the aggregate on the consumer node
   * (one entry per unit in unit order, failed units as failed entries, their
   * never-started dependents as `blocked`) and release the parent through the
   * engine's split terminal. Idempotent: later hooks re-publish the same
   * aggregate until every entry is terminal (a retried unit flips its entry).
   */
  private async checkJoin(parentFlowId: string, consumerNodeKey: string): Promise<void> {
    const states = await this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    if (states.some((s) => s.status === "running")) return;
    // an unstarted unit whose dependencies are all done could still advance —
    // but only when a slot is actually free (an awaiting-approval unit holds
    // its slot until the user acts; nothing can advance around it — the join
    // publishes then, the awaiting entry surfacing in the worst-of status)
    const parallelMax = splitParallelMaxOf(
      await this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    const inFlight = states.filter((s) => s.status === "running" || s.status === "awaiting_approval").length;
    const couldAdvance = inFlight < parallelMax && states.some((s) =>
      s.status === "pending" && s.dependsOn.every((d) => states.find((x) => x.key === d)?.status === "done"));
    if (couldAdvance) return;
    const entries = states.map((s) => ({ key: s.key, title: s.title, status: s.status, output: s.output }));
    const worst = WORST_OF_PRECEDENCE.find((w) => entries.some((e) => e.status === w)) ?? "done";
    await this.finishSplit(parentFlowId, consumerNodeKey, { units: entries, worst }, this.consumerAttempts.get(`${parentFlowId}\n${consumerNodeKey}`) ?? null);
  }

  /**
   * Publish a split consumer's terminal state (moved verbatim from
   * `flowEngine.finishSplit` in the step-07 decomposition — SplitJoin
   * internals, not a public API): the aggregate `{units: [{key, title,
   * status, output}]}` is validated against the def's `splitOutput`
   * capability when one is published (the default split shape otherwise),
   * the node takes the worst-of status of its unit entries (decision 4:
   * failed > awaiting_approval > done), and the parent continues via the
   * normal edge evaluation on a success terminal. A failed aggregate holds
   * for the per-unit actions (Retry the failed unit). The authority's
   * `running` from-set is the fence — a stale aggregate can no longer clobber
   * a node the user retried or cancelled (the step-00 characterization test).
   */
  async finishSplit(parentFlowId: string, nodeKey: string, output: Record<string, unknown>, attemptId?: string | null, tx?: QueryExecutor): Promise<void> {
    const units: unknown = output.units ?? [];
    // worst-of the unit entries (decision 4): failed > awaiting_approval > done
    const entries = Array.isArray(units) ? (units as { status?: unknown }[]) : [];
    const status = entries.some(u => u?.status === NODE_STATUS.FAILED)
      ? NODE_STATUS.FAILED
      : entries.some(u => u?.status === NODE_STATUS.AWAITING_APPROVAL)
        ? NODE_STATUS.AWAITING_APPROVAL
        : NODE_STATUS.DONE;
    const published = await engineParts.transitions.publishAggregate(parentFlowId, nodeKey, 'splitOutcome', {
      status,
      output: { ...output, units },
      attemptId,
      detail: `split resolved — aggregate published (${entries.length} units)${status === NODE_STATUS.AWAITING_APPROVAL ? ' · a unit awaits approval' : status === NODE_STATUS.FAILED ? ' · a unit failed' : ''}`,
    }, tx);
    if (!published) return;
    await this.e.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.e.advanceFrom(parentFlowId, nodeKey);
    }
  }

  /**
   * Notification hook — called from the engine's node-stage / retry / cancel
   * tails when a child flow reached a terminal state. No-op unless the flow
   * is a split child (linkage check first — the whole method is two queries
   * for non-split children), then reschedules the parent's units.
   */
  async onChildFinished(childFlowId: string): Promise<void> {
    const payload = await this.linkage.childPayloadOf(childFlowId);
    if (!payload?.parentNodeKey || !payload.unit?.key) return; // no split linkage
    const flow = await db.prisma.flow.findUnique({
      where: { id: childFlowId },
      select: { parentFlowId: true, kind: true, status: true },
    });
    if (!flow?.parentFlowId || flow.kind !== "split") return;
    // a multi-node (template-target) child mid-graph is not terminal yet —
    // intermediate node finishes don't reschedule the parent's units. An
    // `awaiting_approval` node DOES: the unit holds a scheduler slot until
    // the user acts, and the join accounts for it.
    const statuses = (await db.prisma.node.findMany({
      where: { flowId: childFlowId }, select: { status: true },
    })).map((n) => n.status);
    const flowClosed = flow.status === FLOW_STATUS.DONE || flow.status === FLOW_STATUS.SKIPPED;
    const allTerminal = statuses.length > 0
      && statuses.every((s) => NODE_TERMINAL_STATUSES.includes(s));
    const holding = statuses.some((s) => s === FLOW_STATUS.AWAITING_APPROVAL);
    if (!allTerminal && !holding && !flowClosed) return;
    await db.emitEvent(flow.parentFlowId, null, "lifecycle",
      `split unit "${payload.unit.title}" resolved`,
      { nodeKey: payload.parentNodeKey, childFlowId, unitKey: payload.unit.key });
    await this.advance(flow.parentFlowId, payload.parentNodeKey);
  }
}
