import "server-only";

import type { NodeTriggerRun } from "../../shared/nodeSharedExports";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import { branchStore } from "./branchStore";
import { splitUnitItemOf } from "./utils/splitUnitItem";
import { topoSortBranches } from "./utils/topoSortBranches";
import { type PlanBranch, parsePlanArtifactMeta, PlanOutput } from "../plan/schema";
import { BuildInput } from "./schema";

/**
 * BuildTriggerPlanner — the build kind's engine-trigger materialization (the
 * StageRunner input side): the runs one build trigger starts.
 *
 * Role: reads the approved plan artifact, decomposes its plan-meta into
 * sequential multi-branch runs (branch rows first, one run per topologically
 * sorted branch), consumes a split child's `unit` trigger payload as the run
 * input (agent-node split plan §2.4), and carries the plan run's model into
 * every build run. Plan-meta parsing is a built-in internal — it lives in
 * the kind, never in the engine.
 *
 * Invariants: a CORRUPT plan meta is a typed failure, never a silent
 * single-branch fallback (the decomposition would silently vanish — step
 * 05); the model comes from the PLAN node's published output contract,
 * validated, never a blind cast with a silent `?? undefined` fallback (step
 * 04/05); a split child's PRESENT-but-malformed unit throws (fail loud — a
 * silent fall-through would run the wrong build).
 *
 * Must never: write node status (branch rows are bookkeeping, not the state
 * machine) or read plans other than the plan node's published `plan`
 * artifact.
 */
export class BuildTriggerPlanner {
  constructor(private readonly support: NodeSupport = nodeSupport) {}

  /**
   * Split-child consumption (agent-node split plan §2.4 — Phase 6): when
   * this build instance is a split child (the auto-wrapped build), the unit
   * rides the child flow's trigger payload — consume it as the run input:
   * the branch's plan document + branch contract, the exact input shape the
   * parent def's own multi-branch triggerRuns decomposition passes. Null on
   * an ordinary parent-flow build — the plan-based behavior is unchanged.
   */
  triggerInput(ctx: FlowCtx): BuildInput | null {
    const unit = splitUnitItemOf(ctx.flow.triggerPayload);
    if (!unit) return null;
    return {
      plan: unit.plan,
      prompt: null,
      promptIsBody: false,
      branchInfo: { name: unit.name, title: unit.title, scope: unit.scope },
      feedback: null,
      model: null,
    };
  }

  /**
   * Engine-triggered runs (the plan → build edge activation when the plan is
   * approved): the approved plan artifact + branch decomposition from the
   * plan meta + the model picked for the plan run. Multi-branch plans come
   * back as sequential runs.
   */
  async triggerRuns(ctx: FlowCtx): Promise<NodeTriggerRun[]> {
    // split child (Phase 6): the unit payload IS the run input — the plan
    // artifact reads below are parent-flow behavior only
    const unitInput = this.triggerInput(ctx);
    if (unitInput) return [{ input: unitInput }];
    const plan = await this.approvedPlan(ctx);
    const planContent = plan.content;

    // carry the model selected for the plan run into the build (from plan
    // output) — validated against the PLAN node's published output contract
    // (step 04/05: never a blind cast with a silent `?? undefined` fallback)
    const planNode = await this.support.nodeByType(ctx.flow.id, NODE_KEYS.PLAN);
    const parsedPlanOutput = PlanOutput.safeParse(planNode?.output ?? null);
    const planModel = parsedPlanOutput.success ? (parsedPlanOutput.data.model ?? undefined) : undefined;

    // structured branches from the plan-meta (validated by the plan node at save time)
    let branches: PlanBranch[] | null = null;
    const meta = plan.meta ?? null;
    if (meta != null) {
      // step 05: a CORRUPT plan meta is a typed failure, not a silent
      // single-branch fallback — the branch decomposition would silently
      // vanish (parsePlanArtifactMeta returns null only for a shape the
      // schema rejects; legacy metas without branches still parse)
      const parsed = parsePlanArtifactMeta(meta);
      if (parsed == null) {
        throw new Error(`the approved plan artifact's meta does not satisfy the plan contract — re-approve a valid plan instead of building from corrupt meta`);
      }
      if (parsed.branches.length > 0) branches = parsed.branches;
    }

    if (branches && branches.length > 1) {
      const sorted = topoSortBranches(branches);
      // branch rows first (pending) — today's approvePlan behavior
      for (const [i, b] of sorted.entries()) {
        await branchStore.upsert(ctx.flow.id, b.name, { title: b.title, order: i, status: "pending" });
      }
      await this.support.emitLifecycle(ctx.flow.id, null, `plan approved with ${branches.length} branches — building sequentially`,
        { nodeKey: planNode?.nodeKey ?? NODE_KEYS.PLAN });
      return sorted.map((b) => ({
        input: {
          plan: planContent, prompt: null,
          branchInfo: { name: b.name, title: b.title, scope: b.scope },
          feedback: null, model: planModel ?? null,
        },
        before: () => { void branchStore.upsert(ctx.flow.id, b.name, { status: "building" }); },
        after: () => { void branchStore.upsert(ctx.flow.id, b.name, { status: "awaiting_approval" }); },
      }));
    }

    // single-branch fast path
    return [{
      input: { plan: planContent, prompt: null, branchInfo: null, feedback: null, model: planModel ?? null },
    }];
  }

  /**
   * The approved plan the build runs against — the same upstream read the
   * chain's approve path uses (the plan node's published plan artifact).
   * Shared by the engine trigger and the chat panel's first turn.
   */
  async approvedPlan(ctx: FlowCtx): Promise<{ id: string; version: number; content: string; meta: unknown }> {
    const plan = await this.support.latestArtifact(ctx.flow.id, "plan", { nodeType: NODE_KEYS.PLAN });
    if (!plan) throw new Error("no plan to build — approve the plan first");
    return plan;
  }
}
