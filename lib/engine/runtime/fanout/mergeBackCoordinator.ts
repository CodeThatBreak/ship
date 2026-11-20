import "server-only";

import { db } from "../../../db/app";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { configNumber } from "../../templates/nodeConfig";
import { prompts } from "../../prompts/promptLibrary";
import { nodeRegistry } from "../../nodes/registry";
import type { NodeCapabilities } from "../../nodes/shared/capabilities";
import { mergeArena } from "./mergeArena";
import { engineParts } from "@/lib/composition/container";
import { planSteps, type PlanStepRow } from "../planStepStore";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepChildPayload } from "./types/stepChildPayload";
import type { StepChildStore } from "./stepChildStore";
import type { StepFlowExpander } from "./stepFlowExpander";
import type { StepRollup } from "./stepRollup";

/**
 * MergeBackCoordinator — the step child's approve → merge-back loop (step 07
 * decomposition of `StepFlowManager`, Phase 2): approve ≠ MR — approving a
 * code child claims the step for merge and runs the arena merge onto the
 * parent's integration branch; on `conflict`/`rejected` (repairable CODE
 * states) the bounded merge-fix agent repairs the step branch and the loop
 * re-attempts. Restart-resume (`resumePendingMerge`) re-enters the loop from
 * the durable `step_merges` row; the user Retry on a merge-failed step
 * (`resumeMergeRetry`) re-enters from the failed row instead of re-running
 * the build.
 *
 * Invariants upheld:
 * - One merge in flight per child, claimed atomically: the
   * `completed_by='merge'` conditional UPDATE is the claim — a second
   * approve, an in-arena merge or an active merge row all fail loud.
 * - The merge-fix budget is bounded by the parent's
   * `max_merge_fix_attempts` knob (default 2): exhaustion ⇒ the step fails
   * visible with `step_merges: failed`. Infra failures never consume the
   * budget — the commit-fix classification: network/auth is not something an
   * agent can code away.
 * - Per-branch merge locks are FIFO — dropping them would let a
   * concurrently queued sibling merge run beside the in-flight one. Resume-
   * after-restart starts with an empty lock map — reconcile never needs to
   * drop either.
 * - The merge-back loop re-verifies step ownership before every attempt (an
   * abandoned approval — the step skipped or closed by a checklist edit
   * while the loop awaited — never lands).
 *
 * Must never:
 * - create the MR — the MR machinery runs only when the PARENT's aggregate
   * is finally approved (approveBuild chain);
 * - publish the parent's aggregate — the `StepRollup` owns that; this class
   * only reports child terminals back through `rollup.onChildFinished`;
 * - rebase — an out-of-order landing is repaired by a merge commit via the
   * stale-base path.
 */
export class MergeBackCoordinator {
  constructor(
    private readonly engine: () => StepFlowEngine,
    private readonly children: StepChildStore,
    private readonly expander: StepFlowExpander,
    private readonly rollup: StepRollup,
  ) {}

  private get e(): StepFlowEngine {
    return this.engine();
  }

  /**
   * The user approved a step child (Approve & create MR routes here when the
   * flow has no plain build node — the step_build panel's approve button).
   * Code children run the `mergeBack` hook (approve ≠ MR: the MR machinery
   * runs only when the PARENT's aggregate is finally approved).
   */
  async approveChildStep(childFlowId: string): Promise<void> {
    const childFlow = await this.children.childFlowOf(childFlowId);
    const payload = await this.children.childPayload(childFlowId);
    if (!childFlow?.parentFlowId || !payload?.parentNodeKey) {
      throw new Error("this flow is not a fan-out step child");
    }
    const parentFlowId = childFlow.parentFlowId;
    const workNodeKey = await this.children.childWorkNodeKey(childFlowId);
    const node = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    if (!node) throw new Error("the step child has no work node");
    if (node.status !== "awaiting_approval") throw new Error(`the step is ${node.status}, not awaiting approval`);
    const stepRow = await this.children.stepRowOf(childFlowId);
    if (!stepRow) throw new Error("the step child has no linked plan step");
    if (stepRow.completedBy === "merge") {
      throw new Error("the step merge is already in progress");
    }
    if (mergeArena.isMerging(childFlowId)) {
      throw new Error("the step merge is already in progress");
    }
    const activeMerge = await db.get<{ id: string }>(
      `SELECT id FROM step_merges WHERE flow_id=$1 AND status IN ('running','conflict','rejected') LIMIT 1`,
      childFlowId);
    if (activeMerge) {
      throw new Error("the step merge is already in progress");
    }
    const ctx = await this.e.ctx(childFlowId);
    const branch = ctx.flow.mrBranch;
    if (!branch) throw new Error("the step child has no step branch to merge");
    const integrationBranch = await this.expander.integrationBranchFor(parentFlowId, payload.parentNodeKey, stepRow.branch ?? null);

    await db.emitEvent(childFlowId, null, "lifecycle",
      `step approved${typeof (await this.engineCapabilitiesOfMergeBack(childFlowId)) === "function" ? ` — merging ${branch} into ${integrationBranch}` : ""}`);
    if (typeof (await this.engineCapabilitiesOfMergeBack(childFlowId)) !== "function") {
      // non-code child: nothing to merge — approval closes the child
      await db.run(`UPDATE plan_steps SET status='done', completed_by='approved', updated_at=$1 WHERE sub_flow_id=$2`,
        db.now(), childFlowId);
      await this.children.closeChild(childFlowId);
      await this.rollup.onChildFinished(childFlowId);
      return;
    }
    const claimed = await db.run(
      `UPDATE plan_steps SET completed_by='merge', updated_at=$1 WHERE sub_flow_id=$2 AND (completed_by IS NULL OR completed_by='')`,
      db.now(), childFlowId);
    if (claimed === 0) {
      throw new Error("the step merge is already in progress");
    }
    this.e.bg(childFlowId, workNodeKey, () =>
      this.runMergeBack(parentFlowId, childFlowId, payload, stepRow, workNodeKey, branch, integrationBranch));
  }

  /**
   * The merge-back loop: arena attempt → on `merged` the success path → on
   * infra `failed` the failed-visible path → on `conflict` / `rejected`
   * (repairable CODE states) the bounded merge-fix agent on the step child —
   * the exact commit-fix reuse (runNode-with-feedback on the node that built
   * the step; the agent merges the integration branch into its own step
   * branch, resolves respecting both intents, commits, pushes; it works in
   * the child's worktree/branch in local mode and on the step branch in cloud
   * mode — either way the arena re-attempts the merge after it), then a
   * re-attempt. Bounded by the parent's `max_merge_fix_attempts` knob
   * (default 2, the max_commit_fix_attempts style): exhaustion ⇒ the step
   * fails visible with `step_merges: failed` and the parent card shows the
   * failure (user Retry re-runs the loop). Infra failures never consume the
   * budget — the commit-fix classification: network/auth is not something an
   * agent can code away.
   */
  private async runMergeBack(
    parentFlowId: string,
    childFlowId: string,
    payload: StepChildPayload,
    stepRow: PlanStepRow,
    childNodeKey: string,
    branch: string,
    integrationBranch: string,
    resumeRowId?: string,
    resumeNote?: string,
  ): Promise<void> {
    const nodeOwnerKey = payload.parentNodeKey;
    const nodeRefId = await engineParts.nodeStore.idOf(childFlowId, childNodeKey);
    const nodeRef = nodeRefId ? { id: nodeRefId } : undefined;
    const maxAttempts = Math.max(1, configNumber(
      await this.e.nodeConfigFor(parentFlowId, nodeOwnerKey), "max_merge_fix_attempts", 2));
    if (resumeNote) {
      await db.emitEvent(parentFlowId, null, "lifecycle", resumeNote,
        { nodeKey: nodeOwnerKey, childFlowId });
    }
    // NOTE: per-branch merge locks are FIFO — dropping them would let a
    // concurrently queued sibling merge run beside the in-flight one (Phase 3A
    // parallel approvals queue instead). Resume-after-restart starts with an
    // empty lock map — reconcile never needs to drop either.
    let mergeRowId = resumeRowId ?? undefined;
    try {
      for (;;) {
        // abandoned approvals hand-back: the step may have been skipped (or
        // closed by a checklist edit) while this loop awaited — never land it
        const live = await this.children.stepRowOf(childFlowId);
        const nodeStatus = await engineParts.nodeStore.statusOf(childFlowId, childNodeKey);
        if (!live || live.completedBy === "skipped" || !nodeStatus ||
            (nodeStatus !== NODE_STATUS.AWAITING_APPROVAL && nodeStatus !== NODE_STATUS.RUNNING)) {
          await db.emitEvent(parentFlowId, null, "lifecycle",
            `step "${stepRow.title}" merge-back abandoned (the step is no longer approved/pending)`,
            { nodeKey: nodeOwnerKey, childFlowId });
          return;
        }

        const result = await mergeArena.mergeStepBranch({
          parentFlowId,
          childFlowId,
          parentNodeKey: nodeOwnerKey,
          integrationBranch,
          branch,
          message: `[${stepRow.metaId ?? "s?"}] ${stepRow.title}`,
          baseBranch: (await this.e.ctx(parentFlowId)).repo?.defaultBranch ?? "main",
          ...(mergeRowId ? { mergeRowId } : {}),
        });
        // the arena ROW id is bookkeeping truth — adopt it for re-attempts
        mergeRowId = (await db.get<{ id: string }>(
          `SELECT id FROM step_merges WHERE flow_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, childFlowId
        ))?.id ?? mergeRowId;

        if (result.status === "merged") {
          // merge-back completion batch (step 06, Invariant 7): check-off
          // + child close + announcement in ONE tx (the worktree sweep is I/O, outside)
          await db.transaction(async (tx) => {
            await planSteps.setStatus(parentFlowId, stepRow.id, "done", "merge", tx);
            await this.children.closeChild(childFlowId, tx);
            await db.emitEvent(parentFlowId, null, "lifecycle", `step "${stepRow.title}" merged into ${integrationBranch}${result.stale ? " (stale base resolved by merge — no rebase)" : ""}`, { nodeKey: nodeOwnerKey, childFlowId }, tx);
          });
          await this.rollup.onChildFinished(childFlowId);
          return;
        }

        // infra failure: the commit-fix classification — an agent cannot code
        // away network/auth. Fail visible; the user Retry re-runs the loop.
        if (result.status === "failed") {
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, result.error);
          return;
        }

        // conflict / rejected — repairable code state → the bounded fix agent
        const attempts = mergeRowId
          ? ((await db.get<{ attempts: number }>(`SELECT attempts FROM step_merges WHERE id=$1`, mergeRowId))?.attempts ?? 0)
          : 1;
        if (attempts > maxAttempts) {
          const err = `${result.status} after ${attempts - 1} merge-fix agent runs (max ${maxAttempts}): ${result.error}`;
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, err);
          return;
        }
        await db.emitEvent(parentFlowId, null, "lifecycle",
          `merge-fix agent starting (attempt ${attempts}/${maxAttempts}) — ${result.status === "conflict" ? "resolving the merge conflict on the step branch" : "fixing the hook-rejected code on the step branch"}`,
          { nodeKey: nodeOwnerKey, childFlowId });
        const fixPrompt = prompts.resolve("merge_fix",
          { branch, integration: integrationBranch },
          {
            situation: result.status === "conflict"
              ? `conflicting with the code already landed on ${integrationBranch}`
              : `pushed to ${integrationBranch} but the push was rejected by a pre-receive/pre-push hook`,
            error: result.error,
          });
        try {
          await this.e.runNode(childFlowId, childNodeKey, {
            plan: null, prompt: null, branchInfo: null, step: null, feedback: fixPrompt, model: null,
          });
        } catch (e: unknown) {
          // the fix agent's own run failed (agent error / runtime) — not a
          // code-repairable outcome, hand back failed-visible
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
            `merge-fix agent failed: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (nodeRef) {
          // the fix run ended `awaiting_approval` (a new diff is up) — keep the
          // loop's merge-underway semantics visible on the parent card
          await db.emitEvent(parentFlowId, nodeRef.id, "lifecycle",
            `merge-fix agent finished — re-attempting the arena merge`,
            { nodeKey: nodeOwnerKey, childFlowId });
        }
        // declared: the child stays awaiting_approval while the merge re-attempts
        await this.e.setNodeStatus(childFlowId, childNodeKey, "mergeFixAwaiting");
      }
    } catch (e: unknown) {
      await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
        e instanceof Error ? e.message : String(e));
    }
  }

  /** Mark a merge-back failed loud: step_merges → failed, child node → failed, failure on the parent. */
  private async failMergeBack(
    parentFlowId: string,
    childFlowId: string,
    childNodeKey: string,
    stepRow: PlanStepRow,
    parentNodeKey: string,
    error: string,
  ): Promise<void> {
    await db.run(`UPDATE step_merges SET status='failed', error=$1, updated_at=$2 WHERE flow_id=$3 AND status IN ('running','conflict','rejected')`,
      error.slice(0, 2000), db.now(), childFlowId);
    // declared mergeBackFailed — from-set fenced; published terminals are never overwritten
    await this.e.setNodeStatus(childFlowId, childNodeKey, "mergeBackFailed");
    await db.emitEvent(childFlowId, null, "error", `merge-back failed: ${error}`, { nodeKey: childNodeKey });
    await db.emitEvent(parentFlowId, null, "error",
      `step "${stepRow.title}" merge-back failed: ${error} — Retry the step to re-run the merge (+ fix agent)`,
      { nodeKey: parentNodeKey, childFlowId });
    await this.rollup.onChildFinished(childFlowId);
  }

  /**
   * A `running`/`conflict` step_merges row whose owning run is dead (server
   * restart): re-enter the merge-back loop on the same durable row. The child
   * node must still be approved/underway for this to be safe (caller checks —
   * reconcile only resumes awaiting-approval children). The loop re-verifies
   * step ownership before every attempt.
   */
  async resumePendingMerge(childFlowId: string): Promise<void> {
    const payload = await this.children.childPayload(childFlowId);
    const stepRow = await this.children.stepRowOf(childFlowId);
    const workNodeKey = await this.children.childWorkNodeKey(childFlowId);
    const childNode = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    const childFlow = await this.children.childFlowOf(childFlowId);
    const row = await db.get<{ id: string; status: string }>(
      `SELECT id, status FROM step_merges WHERE flow_id=$1 AND status IN ('running','conflict') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    if (!payload?.parentNodeKey || !stepRow || !childNode || !childFlow?.parentFlowId || !row) {
      await db.emitEvent(childFlowId, null, "error", "a pending step merge could not be resumed (the fan-out linkage is gone)");
      return;
    }
    const parentFlowId = childFlow.parentFlowId;
    const integrationBranch = await this.expander.integrationBranchFor(
      parentFlowId, payload.parentNodeKey, stepRow.branch ?? null);
    const branch = childFlow.mrBranch;
    if (!branch) {
      await db.run(`UPDATE step_merges SET status='failed', error='restart interrupted the merge and the step branch is lost', updated_at=$1 WHERE id=$2`,
        db.now(), row.id);
      return;
    }
    this.e.bg(parentFlowId, payload.parentNodeKey, () =>
      this.runMergeBack(
        parentFlowId, childFlowId, payload, stepRow, workNodeKey, branch,
        integrationBranch, row.id,
        `merge-back for step "${stepRow.title}" was interrupted by a restart — resuming (bounded by the merge-fix budget)`));
  }

  /**
   * User Retry on a merge-failed step: re-enter the merge-back loop from the
   * failed row instead of re-running the step build (the Retry button's
   * merge-failure path — a plain build failure with no merge row keeps
   * routing to the standard node retry).
   */
  async resumeMergeRetry(parentFlowId: string, childFlowId: string): Promise<boolean> {
    const row = await db.get<{ id: string }>(
      `SELECT id FROM step_merges WHERE flow_id=$1 AND status IN ('conflict','rejected','failed') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    const workNodeKey = await this.children.childWorkNodeKey(childFlowId);
    const childNode = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    if (!row || !childNode || childNode.status !== "failed") return false;
    await this.e.setNodeStatus(childFlowId, workNodeKey, "mergeRetryAwaiting");
    await this.resumePendingMerge(childFlowId);
    return true;
  }

  /** The child's def mergeBack hook presence — a fan-out-runtime internal,
   *  shared with the facade's skip path (a skipped code child's step branch is
   *  deleted; a non-code child's is never created). */
  async engineCapabilitiesOfMergeBack(childFlowId: string): Promise<unknown> {
    const type = await this.children.childTypeOf(childFlowId);
    if (!type) return null;
    const def = nodeRegistry.maybe(type) ?? undefined;
    return (def?.capabilities as NodeCapabilities | undefined)?.mergeBack ?? null;
  }
}
