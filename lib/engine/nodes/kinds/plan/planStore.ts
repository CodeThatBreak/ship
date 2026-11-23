import "server-only";

import type { FlowCtx } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import { planSteps } from '../../../runtime/planStepStore';
import type { PlanStepRow } from '../../../runtime/planStepStore/types/planStep';
import { type NodeRow } from '../../../../db/rows';
import { type PlanMeta, type PlanBranch, parsePlanArtifactMeta } from './schema';
import type { RefinedFrom } from './constants/refine';
import type { LatestPlan, ScopedRefine } from './types/planTypeExports';

/**
 * The plan domain's data access + publish seam: the latest plan artifact (with
 * its parsed meta), the live checklist rows, the branch-scoped refine bundle,
 * and the two plan-version publish paths (a live run's version + a recovered
 * one — same artifact store, different provenance meta). The one place plan
 * artifacts and `plan_steps` rows are touched on behalf of the plan node;
 * injected into every collaborator so tests can stub it wholesale.
 */
export class PlanStore {
  constructor(private readonly support: NodeSupport) {}

  /**
   * Latest plan artifact + parsed meta. Unparseable/shapeless meta degrades to
   * an EMPTY meta (a branchless plan) — it never throws; the scoped refine
   * falls back to the whole-plan path on that.
   */
  async latestPlan(flowId: string): Promise<LatestPlan | null> {
    const row = await this.support.latestArtifact(flowId, 'plan');
    if (!row) return null;
    let meta: PlanMeta = { steps: [], branches: [] };
    let rawMeta: Record<string, unknown> = {};
    try {
      const m = row.meta ?? null;
      if (m && typeof m === 'object') {
        rawMeta = m as Record<string, unknown>;
        const parsed = parsePlanArtifactMeta(m);
        if (parsed) meta = parsed;
      }
    } catch {
      /* unparseable meta → treated as a branchless plan; scoped refine falls back */
    }
    return { art: { id: row.id, version: row.version, content: row.content }, meta, rawMeta };
  }

  /** Live checklist rows (validated) — hand edits included by construction. */
  async liveRows(flowId: string): Promise<PlanStepRow[]> {
    return planSteps.list(flowId);
  }

  /** Compact current-steps list from LIVE checklist rows (hand edits included). */
  stepsText(liveRows: PlanStepRow[]): string {
    if (!liveRows.length) return '(none yet)';
    return liveRows
      .map(r => `- ${r.metaId ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ''} (${r.files?.length ?? 0} files)`)
      .join('\n');
  }

  /** Sibling dependency summaries for a branch — what its sub-plan may assume exists. */
  dependencySummaries(latest: LatestPlan, branch: PlanBranch): string {
    const deps = latest.meta.branches.filter(d => branch.dependsOn.includes(d.name));
    return deps.map(d => `- \`${d.name}\` (${d.title}): ${d.scope || '(no scope)'}`).join('\n');
  }

  /**
   * Everything the scoped refine needs, or null when it must fall back.
   * The contract: the ref'd branch of the LATEST plan version plus that
   * branch's live rows (hand edits are input by construction, §2).
   */
  async scopedRefine(flowId: string, branchRef: string): Promise<ScopedRefine | null> {
    const latest = await this.latestPlan(flowId);
    const branch = latest?.meta.branches.find(b => b.name === branchRef);
    if (!latest || !branch) return null;
    return { latest, branch, liveRows: (await this.liveRows(flowId)).filter(s => s.branch === branch.name) };
  }

  /** Save the plan artifact and sync the editable step checklist from it (the run path). */
  async persistPlan(args: {
    ctx: Pick<FlowCtx, 'flow'>;
    node: NodeRow;
    userMessage: string;
    text: string;
    planMeta: PlanMeta | null;
    refined?: RefinedFrom;
  }): Promise<{ art: { id: string; version: number }; stepCount: number }> {
    const art = await this.publish(args, {
      feedback: args.userMessage,
      branches: args.planMeta?.branches ?? undefined,
      steps: args.planMeta?.steps ?? undefined,
      ...(args.refined ? { refinedFrom: args.refined } : {}),
    });
    return { art, stepCount: await this.syncSteps(args.ctx.flow.id, art, args.planMeta) };
  }

  /** The single artifact-write path both publish paths share. */
  private async publish(
    args: { ctx: Pick<FlowCtx, 'flow'>; node: NodeRow; text: string },
    meta: Record<string, unknown>
  ): Promise<{ id: string; version: number }> {
    return this.support.saveArtifact(args.node.id, args.ctx.flow.id, 'plan', args.text, meta);
  }

  /** Sync the checklist from a plan version's steps (no steps → no-op). */
  private async syncSteps(flowId: string, art: { id: string }, planMeta: PlanMeta | null): Promise<number> {
    return planMeta?.steps?.length ? planSteps.syncFromPlan(flowId, art.id, planMeta.steps) : 0;
  }
}
