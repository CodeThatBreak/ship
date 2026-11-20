import "server-only";

import type { z } from "zod";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { FlowCtx, RunOutcome } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { nodeSupport } from "@/lib/composition/container";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import { planSteps } from "../../../runtime/planStepStore";
import { branchStore } from "./branchStore";
import { BuildRunSupport } from "./buildRunSupport";
import { parseBuildProgressReport } from "./utils/buildProgress";
import { type BuildBranchInfo, BuildOutput } from "./schema";

/**
 * BuildFinalizer — the build kind's terminal: turns a finished build agent
 * run into the `awaiting_approval` outcome and its side effects.
 *
 * Role: applies the agent's build-progress report to the plan checklist
 * (step 08: progress acceptance is API claims ∪ fence parse — the API's
 * claims are already persisted on plan_steps; the fence adds whatever it
 * still carries, idempotently, and logs that the `claim_checklist_progress`
 * API was bypassed), records the branch row + tags the run row (per-branch
 * cost attribution), points the flow at the result branch, and saves the
 * per-branch review diff artifact.
 *
 * Invariants: a missing/unparseable `build-progress` report with plan steps
 * still pending is a typed `output_contract_violation` event + a FAILED
 * outcome (step 05) — never a silent empty list that fakes checklist
 * progress.
 *
 * Must never: write node status (it only RETURNS the outcome — the caller
 * applies it through `applyOutcome`, the ONE persistence path), or mark a
 * plan step done the report did not claim.
 */
export class BuildFinalizer {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly buildRun: BuildRunSupport = new BuildRunSupport(),
    private readonly outputSchema: z.ZodType<BuildOutput> = BuildOutput,
    private readonly nodeKey: string = NODE_KEYS.BUILD,
  ) {}

  async finalize(
    ctx: FlowCtx,
    result: AgentRunResult,
    branch: string,
    branchInfo: BuildBranchInfo | null,
    nodeId: string,
    runRowId: string,
  ): Promise<RunOutcome> {
    // step 05: the build-progress report through the shared validation — a
    // missing/unparseable report with steps still pending is a FAILED node
    // (typed event), never a silent empty list that fakes checklist progress
    const report = parseBuildProgressReport(result.result ?? "");
    const pending = (await planSteps.list(ctx.flow.id)).filter((s) => s.status !== "done");
    if (report == null && pending.length > 0) {
      const message = `the build agent's response carries no parseable "build-progress" report and ${pending.length} plan step(s) ${pending.length === 1 ? "is" : "are"} still open — the checklist was not updated`;
      await this.support.emit(ctx.flow.id, nodeId, EVENT_KIND.OUTPUT_CONTRACT_VIOLATION, message, {
        nodeKey: this.nodeKey,
        pending: pending.length,
      });
      return {
        status: "failed" as const,
        output: {},
        event: `build failed — no parseable build-progress report with ${pending.length} step(s) pending`,
        eventData: { error: message, pending: pending.length },
        reply: message,
      };
    }

    // apply the build agent's structured progress report to the plan checklist
    // (step 08: progress acceptance is API claims ∪ fence parse — the API's
    // claims are already persisted on plan_steps; the fence adds whatever it
    // still carries, idempotently). The fence path logs that the API was
    // bypassed — the prompt-snapshot fallback it is.
    // step 08: the fence path logs that the API was bypassed (its fallback note)
    if (report != null) await this.support.emit(ctx.flow.id, nodeId, EVENT_KIND.LOG, `build-progress accepted via the prose fence — the claim_checklist_progress API was bypassed`, { nodeKey: this.nodeKey, fenceCompleted: report.completed.length });
    await planSteps.markDone(ctx.flow.id, nodeId, report?.completed ?? []);

    const resultBranch = await this.buildRun.resultBranch(ctx, result, branch);

    await this.support.setFlowBranch(ctx.flow.id, resultBranch);
    ctx.flow.mrBranch = resultBranch;

    if (branchInfo) {
      const branchRowId = await branchStore.upsert(ctx.flow.id, branchInfo.name, {
        title: branchInfo.title,
        status: "building",
        gitBranch: resultBranch,
      });
      await branchStore.tagRun(runRowId, branchRowId);
    }

    const art = await this.buildRun.diffArtifact(ctx, nodeId, resultBranch, {
      noDiffContent: "(diff unavailable — fetch from GitLab)",
      extraMeta: { branchName: branchInfo?.name ?? undefined },
    });

    return {
      status: "awaiting_approval",
      output: this.outputSchema.parse({
        branch: resultBranch,
        latestArtifact: art.id,
        branchName: branchInfo?.name ?? undefined,
      }),
      event: `build pushed branch ${resultBranch}; diff ready for review`,
      eventData: { stat: art.stat },
      reply: result.result ?? "",
    };
  }
}
