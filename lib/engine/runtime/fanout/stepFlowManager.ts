import "server-only";

import { db } from "../../../db/app";
import {
  NODE_CANCELABLE_STATUSES,
  childFlowHasStarted,
  isNodeStarted,
} from "../transitions/constants/statusSets";
import { mergeArena } from "./mergeArena";
import { engineParts } from "@/lib/composition/container";
import { fanoutOf, parseConfigSnapshot, type FanoutKnob } from "../../templates/nodeConfig";
import type { TemplateGraph } from "../../templates/templateStore";
import { planSteps } from "../planStepStore";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepChildPayload } from "./types/stepChildPayload";
import type { StepState } from "./types/stepState";
import { StepChildStore } from "./stepChildStore";
import { StepFlowExpander } from "./stepFlowExpander";
import { StepScheduler } from "./stepScheduler";
import { StepRollup } from "./stepRollup";
import { MergeBackCoordinator } from "./mergeBackCoordinator";

// ── plan fan-out: the StepFlowManager facade (step 07 decomposition) ─────────
// State authority for the fan-out knob (`fanout.mode != whole` on any node
// downstream of a plan): one real child flow per pending plan step, each
// running that node's work with step-scoped input (the `{plan, step,
// siblings}` trigger payload, persisted on the child flow), monitorable and
// approvable on its own flow screen, aggregated back into the parent node's
// output contract on all-resolved.
//
// The engine stays template-generic: this runtime is a built-in internal
// consumed by the fan-out check in the stage runner (a small hook), the
// child-terminal effect registration (`fanoutEffects.ts`), and the
// approve/skip actions. Children are ordinary flows created through the
// narrower `flowEngine.createStepChild` (the snapshot machinery of create(),
// minus the standalone start-contract / task-type validation) — which is what
// lets the existing per-flow machinery (agent runners, chat, artifacts,
// retry/cancel, reconcile) work on children with no changes.
//
// Step 07 split (docs/engine-overhaul/target-architecture.md §12) — one class
// per concern, this file stays the thin delegating facade so every external
// call site (staging/stageRunner, flowEngine, the approval/retry/plan-step
// services, the read model, reconcile, the effect registration) keeps working
// unchanged:
// - `StepFlowExpander`  — the gate, mode resolution and child expansion
// - `StepScheduler`     — the parallel_max slot budget + file-overlap qualification
// - `StepRollup`        — the child-terminal join + the aggregate publication
// - `MergeBackCoordinator` — the approve → merge-back loop (with `mergeArena`)
// - `StepChildStore`    — the shared child-row data access all four read through
//
// `FlowEngine` (module tail) supplies the engine reference via `bind()`: this
// runtime cannot import the flowEngine value directly (flowEngine imports the
// manager for the fan-out hook; the singleton cycle resolves at bind time).
export class StepFlowManager {
  /** Engine surface the fan-out runtime drives (bound once by flowEngine's module tail). */
  private engine: StepFlowEngine | null = null;

  private readonly children: StepChildStore;
  private readonly rollup: StepRollup;
  private readonly scheduler: StepScheduler;
  private readonly expander: StepFlowExpander;
  private readonly mergeBack: MergeBackCoordinator;

  constructor() {
    // the collaborators reference each other in pairs (expander ↔ scheduler ↔
    // rollup); the facade is the composition point, so the back-references are
    // lazy thunks resolved only when the runtime actually runs
    const engine = (): StepFlowEngine => this.e;
    this.children = new StepChildStore();
    this.rollup = new StepRollup(
      engine,
      this.children,
      (parentFlowId, nodeKey) => this.scheduler.scheduleRollup(parentFlowId, nodeKey),
      () => this.expander,
    );
    this.scheduler = new StepScheduler(engine, this.children, this.rollup, () => this.expander);
    this.expander = new StepFlowExpander(engine, this.children, this.scheduler, this.rollup);
    this.mergeBack = new MergeBackCoordinator(engine, this.children, this.expander, this.rollup);
  }

  /** Called once from flowEngine.ts (module-load tail) — resolves the engine cycle. */
  bind(engine: StepFlowEngine): void {
    this.engine = engine;
  }

  private get e(): StepFlowEngine {
    if (!this.engine) throw new Error("StepFlowManager is not bound to the engine yet");
    return this.engine;
  }

  // ── the fan-out gate + expansion (StepFlowExpander) ────────────────────────

  resolveMode(
    config: Record<string, unknown>,
    published: "whole" | "steps" | null
  ): { mode: FanoutKnob["mode"]; published: "whole" | "steps" | null; override: boolean } {
    return this.expander.resolveMode(config, published);
  }

  async publishedExecution(flowId: string): Promise<"whole" | "steps" | null> {
    return this.expander.publishedExecution(flowId);
  }

  /** The fan-out decision of the engine's trigger path (`null` = the whole path). */
  async gate(flowId: string, nodeKey: string): Promise<"fanout" | "whole-wrap" | null> {
    return this.expander.gate(flowId, nodeKey);
  }

  /** Spawn one child flow per pending plan step, then first-schedule. True when a child was spawned. */
  async expand(parentFlowId: string, nodeKey: string): Promise<boolean> {
    return this.expander.expand(parentFlowId, nodeKey);
  }

  /** Wrap a whole-mode native output as a single-entry aggregate (from-plan + whole resolution). */
  async wrapWholeOutput(flowId: string, nodeKey: string): Promise<void> {
    return this.expander.wrapWholeOutput(flowId, nodeKey);
  }

  async validateChildStartContract(childGraph: TemplateGraph, templateId: string, payload: unknown): Promise<void> {
    return this.expander.validateChildStartContract(childGraph, templateId, payload);
  }

  async integrationBranchFor(parentFlowId: string, nodeOwnerKey: string, planBranch: string | null): Promise<string> {
    return this.expander.integrationBranchFor(parentFlowId, nodeOwnerKey, planBranch);
  }

  // ── scheduling (StepScheduler) ─────────────────────────────────────────────

  /** Start unstarted children up to `parallel_max` (file-overlap qualified), then hand off to the rollup. */
  async advance(parentFlowId: string, nodeKey: string): Promise<void> {
    return this.scheduler.advance(parentFlowId, nodeKey);
  }

  // ── child terminal rollup (StepRollup) ─────────────────────────────────────

  /** The `onChildTerminal` effect body (`fanoutEffects.ts`): a finished step child reschedules the rollup. */
  async onChildFinished(childFlowId: string): Promise<void> {
    return this.rollup.onChildFinished(childFlowId);
  }

  async onAllResolved(parentFlowId: string, nodeKey: string, states?: StepState[]): Promise<void> {
    return this.rollup.onAllResolved(parentFlowId, nodeKey, states);
  }

  /** Roll a child's node set to one status: failed > awaiting_approval > running > done. */
  public static childRollup(statuses: string[], flowStatus: string | null): string | null {
    return StepRollup.childRollup(statuses, flowStatus);
  }

  // ── merge-back (MergeBackCoordinator) ──────────────────────────────────────

  /** The user approved a step child — merge-back for code children, plain close for the rest. */
  async approveChildStep(childFlowId: string): Promise<void> {
    return this.mergeBack.approveChildStep(childFlowId);
  }

  /** Restart recovery: re-enter the merge-back loop from the durable step_merges row. */
  async resumePendingMerge(childFlowId: string): Promise<void> {
    return this.mergeBack.resumePendingMerge(childFlowId);
  }

  /** User Retry on a merge-failed step: re-enter the merge loop from the failed row. */
  async resumeMergeRetry(parentFlowId: string, childFlowId: string): Promise<boolean> {
    return this.mergeBack.resumeMergeRetry(parentFlowId, childFlowId);
  }

  // ── shared glue (kept on the facade — checklist editing + read model) ──────

  /** The work node instance key for a step child (from expand-time payload, with legacy fallback). */
  async childWorkNodeKey(childFlowId: string): Promise<string> {
    return this.children.childWorkNodeKey(childFlowId);
  }

  /** The child flow's persisted trigger payload (parsed; null when absent/unparseable). */
  async childPayload(childFlowId: string): Promise<StepChildPayload | null> {
    return this.children.childPayload(childFlowId);
  }

  /** Skip a step: mark done with `completed_by: 'skipped'`, cancel the child,
   *  drop its merge rows (a restart must never resume a skipped step's merge),
   *  delete the step branch (code children) and sweep the child worktree, emit,
   *  advance. Skipped steps stay visible on the checklist + parent card. */
  async skipStepFlow(parentFlowId: string, stepId: string): Promise<void> {
    const step = (await planSteps.list(parentFlowId)).find((s) => s.id === stepId);
    if (!step) throw new Error("plan step not found");
    if (step.status !== "pending") throw new Error(`the step is already ${step.status}`);
    // owning fan-out node: the child payload knows; unlinked steps resolve via
    // the parent's first configured fan-out node
    const nodeKey =
      (step.subFlowId ? (await this.children.childPayload(step.subFlowId))?.parentNodeKey : null) ??
      await this.firstFanoutNodeKey(parentFlowId);
    if (!nodeKey) throw new Error("no fan-out node on this flow");
    // skip batching (step 06, Invariant 7): check-off + stuck-merge hand-back
    // in one tx
    const childId = step.subFlowId;
    await db.transaction(async (tx) => {
      await planSteps.setStatus(parentFlowId, stepId, "done", "skipped", tx);
      if (childId) await tx.$executeRawUnsafe(`UPDATE step_merges SET status='failed', error='step skipped — the merge-back was abandoned', updated_at=$1 WHERE flow_id=$2 AND status IN ('running','conflict','rejected')`, db.now(), childId);
    });
    if (childId) {
      const childFlow = await this.children.childFlowOf(childId);
      const codeChild = typeof (await this.mergeBack.engineCapabilitiesOfMergeBack(childId)) === "function";
      for (const n of await db.all<{ nodeKey: string; status: string }>(`SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1`, childId)) {
        if (NODE_CANCELABLE_STATUSES.includes(n.status)) await this.e.cancelNode(childId, n.nodeKey); // marks failed + stops in-flight local runs
      }
      // step-branch deletion on skip (Phase 2C) — the branch was created for
      // this step, and a skipped hand-back does not keep its work product
      if (codeChild && childFlow?.mrBranch) {
        try {
          await mergeArena.deleteStepBranch(parentFlowId, childFlow.mrBranch, nodeKey);
        } catch (e: unknown) {
          await db.emitEvent(parentFlowId, null, "lifecycle",
            `step-branch deletion skipped/failed (${e instanceof Error ? e.message : String(e)})`,
            { nodeKey, branch: childFlow.mrBranch });
        }
      }
      await db.transaction(async (tx) => { await this.children.closeChild(childId, tx); await db.emitEvent(parentFlowId, null, "lifecycle", `plan step skipped: ${step.title}`, { nodeKey }, tx); });
    } else {
      await db.emitEvent(parentFlowId, null, "lifecycle", `plan step skipped: ${step.title}`, { nodeKey });
    }
    await this.scheduler.advance(parentFlowId, nodeKey);
  }

  /** The first node instance of the flow whose effective fan-out knob isn't whole. */
  /**
   * Approve one fan-out step from the parent's step card: routes into the
   * child flow's approve (merge-back for code children, plain close for
   * non-code ones). The MR still comes only from the parent's final approval.
   */
  async approveFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    const step = await db.get<{ subFlowId: string | null }>(
      `SELECT sub_flow_id AS "subFlowId" FROM plan_steps WHERE id=$1 AND flow_id=$2`,
      stepId,
      parentFlowId
    );
    if (!step?.subFlowId) throw new Error('that step has no sub-flow yet');
    await this.e.approvals.approveBuild(step.subFlowId); // step children route to the fan-out approve
  }

  /** Retry one failed fan-out step's child run (its recorded step input).
   *  A merge-back failure routes to the merge loop instead — the branch +
   *  approval state survive, so re-running the build prompt would discard the
   *  fix-agent work the conflict surfaced. */
  async retryFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    const step = await db.get<{ subFlowId: string | null }>(
      `SELECT sub_flow_id AS "subFlowId" FROM plan_steps WHERE id=$1 AND flow_id=$2`,
      stepId,
      parentFlowId
    );
    if (!step?.subFlowId) throw new Error('that step has no sub-flow yet');
    if (await this.resumeMergeRetry(parentFlowId, step.subFlowId)) return;
    const workNodeKey = await this.childWorkNodeKey(step.subFlowId);
    const workNode = await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      step.subFlowId,
      workNodeKey
    );
    if (!workNode || workNode.status !== 'failed') {
      throw new Error('the step child has no failed node to retry');
    }
    await this.e.retries.retryNode(step.subFlowId, workNodeKey);
  }

  private async firstFanoutNodeKey(parentFlowId: string): Promise<string | null> {
    for (const n of await db.all<{ nodeKey: string; config: string | null }>(`SELECT node_key AS "nodeKey", config FROM nodes WHERE flow_id=$1`, parentFlowId)) {
      if (fanoutOf(parseConfigSnapshot(n.config)).mode !== "whole") return n.nodeKey;
    }
    return null;
  }

  /** Internal helper for the checklist-edit guard: close a child that never started. */
  async cancelUnstartedChild(childFlowId: string): Promise<void> {
    const statuses = await engineParts.nodeStore.statusesOfFlow(childFlowId);
    if (statuses.some((s) => isNodeStarted(s))) return; // started — never closed silently
    await this.children.closeChild(childFlowId);
  }

  /**
   * Checklist-edit guards (mirror of assertPlanEditable): a step whose child
   * has started/merged cannot be deleted; a pending child with no run may be
   * removed — its child flow closes. Consumed by the plan-step editing paths.
   */
  async deletableStepIds(flowId: string): Promise<{ deletable: Set<string>; toCancel: Map<string, string> }> {
    const deletable = new Set<string>();
    const toCancel = new Map<string, string>();
    for (const s of await planSteps.list(flowId)) {
      if (!s.subFlowId) {
        deletable.add(s.id);
        continue;
      }
      const started = childFlowHasStarted(await engineParts.nodeStore.statusesOfFlow(s.subFlowId));
      if (started) continue; // building/done child — not deletable
      deletable.add(s.id);
      toCancel.set(s.id, s.subFlowId); // pending child with no run → removed + cancelled
    }
    return { deletable, toCancel };
  }

  /**
   * Durable merge-back state per linked child (read-side, Phase 2): what the
   * parent panel's step cards key on — `mergeStatus` (running/conflict/
   * rejected/failed/merged), the fix-attempt count, the last error text, and
   * the stale-base derivation. `flowEngine.get()` folds this into each
   * plan step's `sub_flow` so the FanoutStepList renders the new states with
   * no extra side calls.
   */
  async mergeStates(parentFlowId: string): Promise<Record<string, {
    mergeStatus: string | null;
    mergeAttempts: number;
    mergeError: string | null;
    staleBase: boolean;
  }>> {
    const out: Record<string, { mergeStatus: string | null; mergeAttempts: number; mergeError: string | null; staleBase: boolean }> = {};
    // index by owner node key: one statesOf pass per owning node (usually one)
    // instead of one per step — Phase 3A de-O(k²)
    const perNode = new Map<string, string[]>();
    for (const s of await planSteps.list(parentFlowId)) {
      if (!s.subFlowId) continue;
      const nodeKey = (await this.children.childPayload(s.subFlowId))?.parentNodeKey;
      if (!nodeKey) continue;
      const ids = perNode.get(nodeKey) ?? [];
      ids.push(s.subFlowId);
      perNode.set(nodeKey, ids);
    }
    for (const [nodeKey, ids] of perNode) {
      const states = await this.rollup.statesOf(parentFlowId, nodeKey);
      const byChild = new Map(states.map((x) => [x.childFlowId, x]));
      for (const childId of ids) {
        const st = byChild.get(childId);
        if (!st) continue;
        out[childId] = {
          mergeStatus: st.mergeStatus,
          mergeAttempts: st.mergeAttempts,
          mergeError: st.mergeError,
          staleBase: st.staleBase,
        };
      }
    }
    return out;
  }
}

/** Shared application manager — bound to the flow engine by flowEngine.ts at load. Plain module const (decision Q9): the bound engine reference is the only in-memory field; all step/child state derives from DB rows, so per-module-graph copies cannot disagree. */
export const stepFlows = new StepFlowManager();
