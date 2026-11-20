import "server-only";
import { db } from "../../../db/app";
import {
  NODE_ACTIVE_STATUSES,
  NODE_IN_FLIGHT_STATUSES,
} from "../transitions/constants/statusSets";
import { engineParts } from "@/lib/composition/container";
import { processSingleton } from "../../../singleton";
import type { SplitEngineSurface } from "./types/splitEngineSurface";
import type { SplitUnitState } from "./types/splitUnitState";
import type { SplitLinkIndex } from "./types/splitLinkIndex";
import type { SplitConsumeMode } from "../../nodes/shared/split";
import { SplitExpander } from "./splitExpander";
import { SplitJoin } from "./splitJoin";
import { SplitLinkageStore } from "./splitLinkageStore";

// ── the split runtime facade (agent-node split plan §3 — Phase 2) ────────────
// State authority for the `split_consume: "per-unit"` consumer knob: one real
// child flow per unit a source publishes, scheduled by declared `dependsOn` +
// a `parallel_max` slot budget (default 1 — no file-overlap inference, no
// plan-shaped assumptions), joined into an aggregate published on the
// consumer node in unit order (decision 4), with per-unit actions addressed
// by `unit.key` through the derived linkage.
//
// Step 07 split (docs/engine-overhaul/target-architecture.md §12) — one class
// per concern, this file stays the thin delegating facade so every external
// call site (staging/stageRunner, flowEngine, the effect registration
// `splitEffects.ts`) keeps working unchanged:
// - `SplitExpander`     — the stage-ownership gate (the consumes handoff) and
//                         the per-unit child expansion
// - `SplitJoin`         — the dependsOn/slot scheduler, the aggregate
//                         publication (`finishSplit`) and the child-terminal
//                         reschedule
// - `SplitLinkageStore` — the unit ↔ child-flow linkage (the
//                         `SplitLinkIndex` seam's flows-derived default)
//
// The runtime is written against the narrow `SplitLinkIndex` seam
// (recommendation 1: linkage derived from `flows` — `parent_flow_id` + the
// child payload's `parentNodeKey`/`unit.key`); a future `split_units` table
// replaces the index class without touching the runtime logic.
//
// `FlowEngine` supplies the engine reference via `bind()` at module load
// (flow-engine.ts module tail), the same cycle resolution the
// StepFlowManager uses — this module cannot import the flowEngine value
// directly because flow-engine.ts imports the split manager for the
// child-terminal hooks.
export class SplitManager {
  private engine: SplitEngineSurface | null = null;

  private readonly join: SplitJoin;
  private readonly expander: SplitExpander;

  constructor(private readonly linkage: SplitLinkIndex = new SplitLinkageStore()) {
    // the collaborators read the engine through a lazy thunk — bind() lands
    // later (flow-engine.ts module tail resolves the singleton cycle)
    const engine = (): SplitEngineSurface => this.e;
    this.join = new SplitJoin(engine, this.linkage);
    this.expander = new SplitExpander(engine, this.linkage, this.join);
  }

  /** Called once from flow-engine.ts (module tail) — resolves the engine cycle. */
  bind(engine: SplitEngineSurface): void {
    this.engine = engine;
  }

  private get e(): SplitEngineSurface {
    if (!this.engine) throw new Error("SplitManager is not bound to the engine yet");
    return this.engine;
  }

  // ── the stage gate + expansion (SplitExpander) ─────────────────────────────

  /** The split runtime's stage-ownership gate (the consumes handoff). */
  stageGate(flowId: string, nodeKey: string): Promise<boolean> {
    return this.expander.stageGate(flowId, nodeKey);
  }

  /** Expand a per-unit consumer into one child flow per published unit. */
  expand(
    parentFlowId: string,
    consumerNodeKey: string,
    sourceNodeKey: string,
    opts: { consume?: SplitConsumeMode } = {},
  ): Promise<boolean> {
    return this.expander.expand(parentFlowId, consumerNodeKey, sourceNodeKey, opts);
  }

  // ── scheduling + join (SplitJoin) ──────────────────────────────────────────

  /** Start eligible units (deps + slot budget), then run the join check. */
  advance(parentFlowId: string, consumerNodeKey: string): Promise<void> {
    return this.join.advance(parentFlowId, consumerNodeKey);
  }

  /** The `onChildTerminal` effect body (`splitEffects.ts`): a finished split
   *  child reschedules the parent's units (and can complete the join). */
  onChildFinished(childFlowId: string): Promise<void> {
    return this.join.onChildFinished(childFlowId);
  }

  // ── linkage read-through (SplitLinkageStore) ───────────────────────────────

  /**
   * The consumer node key that owns a unit key on this flow (the per-unit
   * actions' optional addressing — the caller may address a unit by key
   * alone), or null when no split linkage on the flow carries it.
   */
  async consumerOfUnit(parentFlowId: string, unitKey: string): Promise<string | null> {
    return this.linkage.consumerNodeOfUnit(parentFlowId, unitKey);
  }

  // ── per-unit actions (§3), addressed by unit.key through the linkage ───────

  /**
   * The consumer node a unit action addresses: the explicit key wins; the
   * linkage resolves the owner when omitted (the unit cards pass only the
   * unit key when the consumer is unambiguous). Unresolvable → loud error.
   */
  private async consumerFor(parentFlowId: string, unitKey: string, consumerNodeKey?: string): Promise<string> {
    if (consumerNodeKey) return consumerNodeKey;
    const owner = await this.consumerOfUnit(parentFlowId, unitKey);
    if (!owner) throw new Error(`no split unit "${unitKey}" on any consumer of flow ${parentFlowId}`);
    return owner;
  }

  /**
   * Skip a unit: stop in-flight runs, mark its nodes skipped, close the child
   * flow `skipped`, reschedule — dependents become `blocked`.
   */
  async skipUnit(parentFlowId: string, consumerNodeKey: string | undefined, unitKey: string): Promise<void> {
    const consumer = await this.consumerFor(parentFlowId, unitKey, consumerNodeKey);
    const state = await this.stateFor(parentFlowId, consumer, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to skip`);
    if (state.status === "done" || state.status === "skipped") {
      throw new Error(`unit "${unitKey}" is already ${state.status}`);
    }
    await this.stopActiveChildNodes(state.childFlowId);
    await engineParts.transitions.applyFlowScope(state.childFlowId, "skipUnit"); // terminals never overwritten
    await db.prisma.flow.update({ where: { id: state.childFlowId }, data: { status: "skipped", updatedAt: new Date() } });
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" skipped`, { nodeKey: consumer, unitKey, childFlowId: state.childFlowId });
    await this.join.advance(parentFlowId, consumer);
  }

  /** Retry a failed unit's child run (its recorded input). Blocked units have
   *  no failed run of their own — retry the failed dependency that blocks them. */
  async retryUnit(parentFlowId: string, consumerNodeKey: string | undefined, unitKey: string): Promise<void> {
    const consumer = await this.consumerFor(parentFlowId, unitKey, consumerNodeKey);
    const state = await this.stateFor(parentFlowId, consumer, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to retry`);
    const failed = await db.prisma.node.findMany({
      where: { flowId: state.childFlowId, status: "failed" }, select: { nodeKey: true },
    });
    if (!failed.length) throw new Error(`unit "${unitKey}" has no failed node to retry`);
    await this.e.retries.retryNode(state.childFlowId, failed[0].nodeKey); // hooks reschedule on finish
  }

  /**
   * Approve a unit holding at `awaiting_approval` — inline (not the generic
   * approveNode: that route sends child flows to the plan fan-out approve).
   */
  async approveUnit(parentFlowId: string, consumerNodeKey: string | undefined, unitKey: string): Promise<void> {
    const consumer = await this.consumerFor(parentFlowId, unitKey, consumerNodeKey);
    const state = await this.stateFor(parentFlowId, consumer, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to approve`);
    const awaiting = await db.prisma.node.findMany({
      where: { flowId: state.childFlowId, status: "awaiting_approval" }, select: { nodeKey: true },
    });
    if (!awaiting.length) throw new Error(`unit "${unitKey}" is not awaiting approval`);
    for (const n of awaiting) {
      await this.e.setNodeStatus(state.childFlowId, n.nodeKey, "approve"); // raced-out nodes keep their real state
      await db.emitEvent(state.childFlowId, null, "lifecycle", `${n.nodeKey} approved`);
    }
    // the child's own graph continues past its approval gate, if it has one
    await this.e.advanceFrom(state.childFlowId, awaiting[0].nodeKey);
    await this.join.advance(parentFlowId, consumer);
  }

  /** Cancel a unit: stop its active runs (standard stop), leaving the unit
   *  failed — its dependents surface `blocked`, the aggregate republishes. */
  async cancelUnit(parentFlowId: string, consumerNodeKey: string | undefined, unitKey: string): Promise<void> {
    const consumer = await this.consumerFor(parentFlowId, unitKey, consumerNodeKey);
    const state = await this.stateFor(parentFlowId, consumer, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to cancel`);
    const active = (await db.prisma.node.findMany({
      where: { flowId: state.childFlowId }, select: { nodeKey: true, status: true },
    })).filter((n) => NODE_ACTIVE_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(state.childFlowId, n.nodeKey); // marks failed + stops in-flight runs
    }
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" cancelled`, { nodeKey: consumer, unitKey, childFlowId: state.childFlowId });
    await this.join.advance(parentFlowId, consumer);
  }

  /** Standard stop for a child's active nodes (used by skip). */
  private async stopActiveChildNodes(childFlowId: string): Promise<void> {
    const active = (await db.prisma.node.findMany({
      where: { flowId: childFlowId }, select: { nodeKey: true, status: true },
    })).filter((n) => NODE_IN_FLIGHT_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(childFlowId, n.nodeKey);
    }
  }

  /** One unit's state by key (the actions' addressing). */
  private async stateFor(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<SplitUnitState> {
    const state = (await this.join.unitStates(parentFlowId, consumerNodeKey)).find((s) => s.key === unitKey);
    if (!state) throw new Error(`no split unit "${unitKey}" on ${consumerNodeKey} of flow ${parentFlowId}`);
    return state;
  }
}

/** Shared split runtime manager — bound to the flow engine by flow-engine.ts
 *  at load. Constructor-injected linkage (the `SplitLinkIndex` seam) so a
 *  future `split_units` table swap never ripples into the runtime. */
export const splitManager = processSingleton("splitManager", () => new SplitManager());
