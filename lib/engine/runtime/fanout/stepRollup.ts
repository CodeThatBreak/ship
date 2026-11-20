import "server-only";

import type { QueryExecutor } from "../../../db/database";
import { db } from "../../../db/app";
import { NODE_STATUS } from "../../constants/nodeStatus";
import {
  isNodeTerminalSuccess,
  NODE_TERMINAL_STATUSES,
} from "../transitions/constants/statusSets";
import { nodeRegistry } from "../../nodes/registry";
import { DEFAULT_FANOUT_OUTPUT } from "../../nodes/shared/schemas/defaultOutputs";
import type { NodeCapabilities } from "../../nodes/shared/capabilities";
import { flowCtxHelper } from "../../nodes/shared/runContext";
import { branchStore } from "../../nodes/kinds/build/branchStore";
import { engineParts, nodeSupport } from "@/lib/composition/container";
import { planSteps } from "../planStepStore";
import type { PlanStepRow } from "../planStepStore/types/planStep";
import type { StepChildPayload } from "./types/stepChildPayload";
import type { StepState } from "./types/stepState";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepChildStore } from "./stepChildStore";
import type { StepFlowExpander } from "./stepFlowExpander";

/**
 * StepRollup — the fan-out join (step 07 decomposition of `StepFlowManager`):
 * when a step child's flow reaches its terminal the `onChildTerminal` effect
 * lands here; once EVERY linked child is resolved the parent's aggregate
 * output contract is published and the parent node takes its trigger-type
 * terminal. Owns the aggregate publication (`finishFanout`, moved verbatim
 * from `flowEngine.finishFanout` in the step-07 decomposition) and the
 * attempt tokens that fence it.
 *
 * Invariants upheld:
 * - ONE completion batch (step 06, Invariant 7): the plan-step check-offs +
 *   branch upserts + `flows.mr_branch` + diff artifact saves land in ONE
 *   transaction; the aggregate publish stays OUTSIDE it (the publish continues
 *   into the edge evaluation — downstream stage starts are agent I/O, never
 *   inside a tx) and is one attempt-fenced statement, idempotently re-runnable.
 * - The publish is from-set fenced on `running` through the transition
 *   authority: a late aggregate that resolves after the user retried the node
 *   loses silently; the captured expand-time attempt token reinforces the fence.
 * - Git I/O (`makeDiff`) happens BEFORE the batch — git never joins a
 *   transaction (step 06 risk note).
 *
 * Must never:
 * - write `nodes.status` outside the authority (it publishes only through
 *   `engineParts.transitions.publishAggregate`);
 * - start children (the `StepScheduler` owns scheduling) — it only schedules
 *   its own rollup pass through the injected `scheduleRollup` hand-off;
 * - decide merge policy — merge-backs belong to the `MergeBackCoordinator`.
 */
export class StepRollup {
  constructor(
    private readonly engine: () => StepFlowEngine,
    private readonly children: StepChildStore,
    /** the scheduler's guarded rollup hand-off (in-flight keyed per parent node) */
    private readonly scheduleRollup: (parentFlowId: string, nodeKey: string) => void,
    /** the expander is wired after this class (the facade's construction order);
     *  every call site runs long after construction, so the lazy lookup is safe */
    private readonly expander: () => StepFlowExpander,
  ) {}

  private get e(): StepFlowEngine {
    return this.engine();
  }

  /** Fan-out attempt tokens captured at expand — the rollup's aggregate publish is
   *  attempt-fenced (stale aggregates lose to the user's re-claim; step 03 makes it durable). */
  private readonly aggregateAttempts = new Map<string, string>();

  /** Expand records the parent claim's attempt token so the aggregate publish is fenced. */
  captureAggregateAttempt(parentFlowId: string, nodeKey: string, attemptId: string): void {
    this.aggregateAttempts.set(`${parentFlowId}\n${nodeKey}`, attemptId);
  }

  /**
   * Notification hook — called from the engine's node-stage tail / cancel /
   * generic approve when a step child's node reached a terminal state.
   * Early-returns unless the whole child is terminal, then reschedules.
   */
  async onChildFinished(childFlowId: string): Promise<void> {
    const link = await db.get<{ flowId: string }>(`SELECT flow_id AS "flowId" FROM plan_steps WHERE sub_flow_id=$1`, childFlowId);
    if (!link) return;
    const payload = await this.children.childPayload(childFlowId);
    const parentNodeKey = payload?.parentNodeKey;
    if (!parentNodeKey) return; // no fan-out linkage — nothing this runtime scheduled
    const nodes = await engineParts.nodeStore.statusesOfFlow(childFlowId);
    const flowStatus = await this.children.childFlowStatus(childFlowId);
    const allTerminal = nodes.length > 0 && nodes.every((n) => NODE_TERMINAL_STATUSES.includes(n));
    if (!allTerminal && flowStatus !== "done") return;
    await db.emitEvent(link.flowId, null, "lifecycle",
      `step child resolved ("${payload.step.title}")`,
      { nodeKey: parentNodeKey, childFlowId });
    this.scheduleRollup(link.flowId, parentNodeKey);
  }

  /** Rollup: when every linked child is resolved, publish the aggregate (all resolved). */
  async checkRollup(parentFlowId: string, nodeKey: string): Promise<void> {
    const states = await this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    if (states.some((s) => s.childFlowId != null && !s.isResolved && !s.isFailed)) return;
    if (states.some((s) => s.childFlowId == null && s.step.status === "pending")) return;
    await this.onAllResolved(parentFlowId, nodeKey, states); // check-offs batched inside (step 06, Invariant 7)
  }

  // ── all resolved: aggregate output contract + parent terminal ──────────────

  /**
   * Publish the aggregate output contract (the def's `fanoutOutput`, default
   * `{steps: [{id, title, status, branch?, artifact_id?, output?}]}`), move the node to its
   * trigger-type terminal (approval ⇒ `awaiting_approval`), then the normal edge evaluation.
   */
  async onAllResolved(parentFlowId: string, nodeKey: string, states?: StepState[]): Promise<void> {
    const parentRunning = await engineParts.nodeStore.statusOf(parentFlowId, nodeKey);
    if (parentRunning !== NODE_STATUS.RUNNING) return;

    const ctx = await this.e.ctx(parentFlowId);
    states ??= await this.statesOf(parentFlowId, nodeKey);
    const def = await this.e.defOf(parentFlowId, nodeKey);
    const isCode = typeof def.capabilities.mergeBack === "function";

    const stepsOut = await Promise.all(states.map(async (s) => {
      const out = s.childFlowId ? await this.children.childOutput(s.childFlowId) : null;
      const outObj = out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
      const artifactId = outObj?.latestArtifact ?? outObj?.artifactId ?? outObj?.output_id ?? null;
      return {
        id: s.step.metaId ?? s.step.id,
        title: s.step.title,
        status: this.aggregateStatus(s),
        branch: s.branch ?? undefined,
        artifact_id: typeof artifactId === "string" ? artifactId : undefined,
        output: outObj ?? {},
      };
    }));
    const aggregate = { steps: DEFAULT_FANOUT_OUTPUT.parse({ steps: stepsOut }).steps };

    // merged code children publish the parent-side diff artifacts (the
    // whole-mode finalizeBuild contract) — `makeDiff` captures run BEFORE the
    // batch: git I/O never joins a transaction (step 06 risk note)
    const integrationBranches = [...new Set(states.map((s) => s.integrationBranch).filter((b): b is string => Boolean(b)))];
    const perBranch: Record<string, string> = {}, diffs: Record<string, { raw: string; stat: string }> = {};
    let latestArtifact: string | null = null;
    const diffNodeId = isCode ? await engineParts.nodeStore.idOf(parentFlowId, nodeKey) : null;
    for (const branch of integrationBranches) {
      if (!diffNodeId || !states.some((s) => s.integrationBranch === branch && s.step.status === "done" && s.step.completedBy === "merge")) continue;
      try { const d = await flowCtxHelper.makeDiff(ctx, branch); diffs[branch] = { raw: d ? d.raw : "(diff unavailable)", stat: d?.stat ?? "" }; } catch { /* per-branch diff failure is non-fatal — the aggregate still publishes */ }
    }

    // Rollup completion batch (step 06, Invariant 7): plan-step check-offs +
    // branch upserts + flows.mr_branch + diff artifact saves in ONE tx. The
    // aggregate publish stays OUTSIDE: `finishFanout` continues into the edge
    // evaluation (downstream stage starts = agent I/O, never inside a tx) —
    // one attempt-fenced statement, idempotently re-runnable.
    await db.transaction(async (tx) => {
      for (const s of states) if (s.step.status === "pending" && s.isResolved && !s.isFailed) await planSteps.setStatus(parentFlowId, s.step.id, "done", "child", tx);
      for (const branch of integrationBranches) {
        const diff = diffs[branch];
        if (diff === undefined) continue; // merged-done guard — no capture, no batch for this branch
        await branchStore.upsert(parentFlowId, branch, { status: "awaiting_approval" }, tx);
        await tx.$executeRawUnsafe(`UPDATE flows SET mr_branch=$1 WHERE id=$2 AND (mr_branch IS NULL OR mr_branch='')`, branch, parentFlowId);
        if (!diffNodeId) continue;
        const art = await nodeSupport.saveArtifact(diffNodeId, parentFlowId, "diff", diff.raw, { branch, stat: diff.stat, fanout: true }, undefined, tx);
        perBranch[branch] = art.id;
        latestArtifact = latestArtifact ?? art.id;
      }
    });

    await this.finishFanout(parentFlowId, nodeKey, {
      steps: aggregate.steps,
      ...(integrationBranches[0] ? { branch: integrationBranches[0] } : {}),
      ...(latestArtifact ? { latestArtifact } : {}),
      ...(integrationBranches.length > 1 ? { branchArtifacts: perBranch } : {}),
    }, this.aggregateAttempts.get(`${parentFlowId}\n${nodeKey}`) ?? null);
  }

  /**
   * Publish a fan-out node's terminal state (moved verbatim from
   * `flowEngine.finishFanout` in the step-07 decomposition — StepFlowManager
   * internals, not a public API): persist the aggregate output, move the node
   * to its trigger-type terminal (approval ⇒ `awaiting_approval` — the SDLC
   * build's final aggregate approval flows through the untouched approveBuild
   * chain → MR creation), then continue the normal edge evaluation on a
   * success terminal. The authority's `running` from-set is the fence: a late
   * aggregate that resolves after the user retried the node loses silently.
   */
  async finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>, attemptId?: string | null, tx?: QueryExecutor): Promise<void> {
    // the aggregate validates against the def's fanoutOutput contract at the
    // authority's seam (step 04) — a violation fails the node typed, `false`
    // comes back, and the flow never advances on unvalidated data
    const steps: unknown = output.steps ?? [];
    const tt = (await this.e.graph(parentFlowId))?.byKey.get(nodeKey)?.trigger.type ?? "auto";
    const status = tt === "approval" ? NODE_STATUS.AWAITING_APPROVAL : NODE_STATUS.DONE;
    const published = await engineParts.transitions.publishAggregate(parentFlowId, nodeKey, "fanoutOutcome", {
      status,
      output: { ...output, steps },
      attemptId,
      detail: `fan-out resolved — aggregate published (${(steps as unknown[])?.length ?? 0} steps)${status === NODE_STATUS.AWAITING_APPROVAL ? " · awaiting the final approval" : ""}`,
    }, tx);
    if (!published) return;
    await this.e.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.e.advanceFrom(parentFlowId, nodeKey);
    }
  }

  private aggregateStatus(s: StepState): "done" | "failed" | "skipped" {
    if (s.step.completedBy === "skipped") return "skipped";
    if (s.isFailed) return "failed";
    // stalled pending steps (an earlier overlapping sibling failed) stay honest
    if (s.step.status === "pending" && s.childFlowId == null) return "failed";
    return s.step.status === "done" ? "done" : s.childNodeStatus === "failed" ? "failed" : "done";
  }

  // ── state derivation ────────────────────────────────────────────────────────

  /**
   * All step children a parent node owns. Shared with the scheduler (the
   * slot budget reads the same states the rollup does) and the facade's
   * `mergeStates` read model.
   */
  async statesOf(parentFlowId: string, nodeKey: string): Promise<StepState[]> {
    const all = (await planSteps.list(parentFlowId)).filter((s) => s.subFlowId != null);
    const states: StepState[] = [];
    for (const step of all) {
      const childFlowId = step.subFlowId;
      if (!childFlowId) continue;
      const payload = await this.children.childPayload(childFlowId);
      if (!payload || payload.parentNodeKey !== nodeKey) continue;
      states.push(await this.stateOf(parentFlowId, step, payload));
    }    // cross-sibling pass: a code child awaiting its merge whose integration
    // branch already absorbed an earlier sibling's merge has a STALE BASE —
    // its step branch was cut at expand time, before that merge existed. The
    // chip shows while it diverges; the arena merge is the repair (no rebase).
    for (const s of states) {
      if (!s.isCodeChild || s.step.status === "done") continue;
      s.staleBase = states.some((o) =>
        o !== s &&
        o.integrationBranch === s.integrationBranch &&
        o.step.position < s.step.position &&
        o.step.status === "done" &&
        o.step.completedBy === "merge");
    }
    return states;
  }

  async stateOf(parentFlowId: string, step: PlanStepRow, payload: StepChildPayload): Promise<StepState> {
    const childFlowId = step.subFlowId;
    if (!childFlowId) throw new Error("stateOf requires a linked sub-flow");
    const childFlow = (await this.children.childFlowOf(childFlowId)) ?? null;
    const workNodeKey = payload.workNodeKey ?? await this.children.childWorkNodeKey(childFlowId);
    const nodes = await db.all<{ nodeKey: string; type: string; status: string }>(
      `SELECT node_key AS "nodeKey", type, status FROM nodes WHERE flow_id=$1 ORDER BY created_at`, childFlowId);
    const workNode = nodes.find((n) => n.nodeKey === workNodeKey) ?? nodes[0];
    const statuses = workNode ? [workNode.status] : nodes.map((n) => n.status);
    const childDef = workNode ? nodeRegistry.maybe(workNode.type) : undefined;
    const isCodeChild = typeof (childDef?.capabilities as NodeCapabilities | undefined)?.mergeBack === "function";
    const rollup = StepRollup.childRollup(statuses, childFlow?.status ?? null);
    const merge = await this.children.latestMergeRow(childFlowId);
    const isFailed =
      rollup === "failed" ||
      (merge != null && merge.status !== "merged" && step.status !== "done");
    return {
      step,
      childFlowId,
      childStatus: childFlow?.status ?? null,
      childNodeKey: workNode?.nodeKey ?? null,
      childNodeType: workNode?.type ?? null,
      childNodeStatus: rollup,
      branch: childFlow?.mrBranch ?? null,
      integrationBranch: isCodeChild ? await this.integrationBranchOf(parentFlowId, payload.parentNodeKey, step.branch ?? null) : null,
      isCodeChild,
      isRunning: rollup === "running",
      isAwaiting: rollup === "awaiting_approval",
      isResolved: rollup === "done" || rollup === "failed" || step.status === "done",
      isFailed,
      mergeStatus: merge?.status ?? null,
      mergeAttempts: merge?.attempts ?? 0,
      mergeError: merge?.error ?? null,
      staleBase: false, // filled by statesOf's cross-sibling pass below
    };
  }

  /** Roll a child's node set to one status: failed > awaiting_approval > running > done. */
  public static childRollup(statuses: string[], flowStatus: string | null): string | null {
    if (statuses.some((s) => s === "failed")) return "failed";
    if (statuses.some((s) => s === "awaiting_approval")) return "awaiting_approval";
    if (statuses.some((s) => s === "running")) return "running";
    if (statuses.length && statuses.every((s) => s === "done" || s === "approved" || s === "skipped")) return "done";
    if (flowStatus === "done") return "done";
    return null;
  }

  /** The expander owns the integration-branch derivation — rollup/state read it
   *  through the same method so expand/approve/reconcile can never disagree. */
  private integrationBranchOf(parentFlowId: string, nodeOwnerKey: string, planBranch: string | null): Promise<string> {
    return this.expander().integrationBranchFor(parentFlowId, nodeOwnerKey, planBranch);
  }
}
