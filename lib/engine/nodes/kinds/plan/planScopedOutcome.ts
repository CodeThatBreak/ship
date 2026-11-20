import 'server-only';

import { planSteps } from '../../../runtime/planStepStore';
import type { FlowCtx, RunOutcome } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import type { NodeRow } from '../../../../db/rows';
import { BranchRefinement } from './branchRefinement';
import { REFINED_FROM_SOURCE } from './constants/refine';
import type { PlanMeta, SubPlanPatch, SubPlanResponse } from './schema';
import type { ScopedRefine } from './types/planTypeExports';
import { readRunModel } from './utils/planOutcome';

/**
 * PlanScopedOutcome — the branch-scoped refine's tail: deterministic merge or
 * change-only patch of ONE branch's steps into the latest plan artifact, a new
 * artifact version (the whole-plan markdown is re-published verbatim), the
 * branch-scoped checklist replace (`planSteps.replaceBranch` — rows of other
 * branches are never touched), and the awaiting-approval outcome whose blob
 * points at the fresh version.
 *
 * Invariant: other branches are never rewritten — `BranchRefinement` keeps
 * unrelated steps/branches as the same object references and
 * `replaceBranch` deletes/recreates only the target branch's rows. Must never
 * publish a whole-plan version or mutate the plan markdown here.
 */
export class PlanScopedOutcome {
  constructor(private readonly support: NodeSupport) {}

  /**
   * A refined sub-plan for one branch: full replacement of that branch's
   * steps (merge is deterministic code, never full-plan regeneration).
   */
  async subPlanOutcome(ctx: FlowCtx, node: NodeRow, scoped: ScopedRefine, sub: SubPlanResponse): Promise<RunOutcome> {
    const branchName = scoped.branch.name;
    const merged = BranchRefinement.merge(scoped.latest.meta, branchName, sub);
    const { art, stepCount, diffNote } = await this.publishBranch(ctx, node, scoped, merged);
    return {
      status: 'awaiting_approval',
      output: this.outputBlob(node, art, merged, branchName, scoped.latest.art.version),
      event: `branch '${branchName}' sub-plan refined · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: sub.markdown,
    };
  }

  /** A change-only delta for one branch: upsert/remove steps, optional markdown replace. */
  async patchOutcome(ctx: FlowCtx, node: NodeRow, scoped: ScopedRefine, patch: SubPlanPatch): Promise<RunOutcome> {
    const branchName = scoped.branch.name;
    const merged = BranchRefinement.applyPatch(scoped.latest.meta, branchName, patch);
    const { art, stepCount, diffNote } = await this.publishBranch(ctx, node, scoped, merged);
    return {
      status: 'awaiting_approval',
      output: this.outputBlob(node, art, merged, branchName, scoped.latest.art.version),
      event: `branch '${branchName}' sub-plan patched · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: patch.markdown ?? `Updated branch "${branchName}".`,
    };
  }

  /**
   * The shared tail of both scoped shapes: publish the merged meta as a new
   * artifact version (rawMeta re-published verbatim plus scoped-refine
   * provenance), then replace only the target branch's step rows.
   */
  private async publishBranch(
    ctx: FlowCtx,
    node: NodeRow,
    scoped: ScopedRefine,
    merged: PlanMeta
  ): Promise<{ art: { id: string; version: number }; stepCount: number; diffNote: string }> {
    const branchName = scoped.branch.name;
    const art = await this.support.saveArtifact(node.id, ctx.flow.id, 'plan', scoped.latest.art.content, {
      ...scoped.latest.rawMeta,
      steps: merged.steps,
      branches: merged.branches,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version },
      refinedFrom: { version: scoped.latest.art.version, source: REFINED_FROM_SOURCE.BRANCH },
    });

    const branchSteps = merged.steps.filter(s => s.branch === branchName);
    const stepCount = await planSteps.replaceBranch(ctx.flow.id, art.id, branchName, branchSteps);

    const oldSteps = scoped.latest.meta.steps.filter(s => s.branch === branchName);
    const { added, removed, changed } = BranchRefinement.diffSteps(oldSteps, branchSteps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ''})`;
    return { art, stepCount, diffNote };
  }

  /** The scoped outcome blob: the fresh artifact version plus the merge result. */
  private outputBlob(
    node: NodeRow,
    art: { id: string; version: number },
    merged: PlanMeta,
    branchName: string,
    fromVersion: number
  ): Record<string, unknown> {
    const branchAgents = this.readBranchAgents(node);
    const model = readRunModel(node);
    return {
      latestArtifact: art.id,
      version: art.version,
      branches: merged.branches,
      steps: merged.steps,
      scopedRefine: { branch: branchName, from: fromVersion },
      ...(model != null ? { model } : {}),
      ...(branchAgents ? { branchAgents } : {}),
    };
  }

  private readBranchAgents(node: NodeRow): Record<string, string> | undefined {
    if (!node.output) return undefined;
    const raw = node.output as { branchAgents?: Record<string, string> };
    return raw.branchAgents;
  }
}
