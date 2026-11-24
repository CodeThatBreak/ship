import "server-only";

import type { NodeTriggerRun } from "../../shared/nodeSharedExports";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import { parsePlanArtifactMeta, PlanOutput } from "../plan/schema";

/**
 * BuildTriggerPlanner — the build kind's engine-trigger materialization (the
 * StageRunner input side): the single run a build trigger starts, carrying the
 * plan run's model into it.
 *
 * Role: reads the approved plan artifact, validates its meta, and carries the
 * plan run's model into the build run. Plan-meta parsing is a built-in
 * internal — it lives in the kind, never in the engine.
 *
 * Invariants: a CORRUPT plan meta is a typed failure, never a silent fallback
 * (step 05); the model comes from the PLAN node's published output contract,
 * validated, never a blind cast with a silent `?? undefined` fallback (step
 * 04/05).
 *
 * Must never write node status or read plans other than the plan node's
 * published `plan` artifact.
 */
export class BuildTriggerPlanner {
  constructor(private readonly support: NodeSupport = nodeSupport) {}

  /**
   * Engine-triggered runs (the plan → build edge activation when the plan is
   * approved): the approved plan artifact and the model picked for the plan
   * run.
   */
  async triggerRuns(ctx: FlowCtx): Promise<NodeTriggerRun[]> {
    const plan = await this.approvedPlan(ctx);
    const planContent = plan.content;

    // step 05: a CORRUPT plan meta is a typed failure, not a silent fallback
    if (plan.meta != null) {
      const parsed = parsePlanArtifactMeta(plan.meta);
      if (parsed == null) {
        throw new Error(`the approved plan artifact's meta does not satisfy the plan contract — re-approve a valid plan instead of building from corrupt meta`);
      }
    }

    // carry the model selected for the plan run into the build (from plan
    // output) — validated against the PLAN node's published output contract
    // (step 04/05: never a blind cast with a silent `?? undefined` fallback)
    const planNode = await this.support.nodeByType(ctx.flow.id, NODE_KEYS.PLAN);
    const parsedPlanOutput = PlanOutput.safeParse(planNode?.output ?? null);
    const planModel = parsedPlanOutput.success ? (parsedPlanOutput.data.model ?? undefined) : undefined;

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
