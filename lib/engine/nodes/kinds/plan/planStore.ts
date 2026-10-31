import "server-only";

import type { FlowCtx } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import { planSteps } from '../../../runtime/planStepStore';
import { PlanStepRow, rows, type NodeRow } from '../../../../db/rows';
import { type PlanInput, type PlanMeta, type PlanBranch, parsePlanArtifactMeta } from './schema';
import type { RefinedFrom } from './constants/refine';
import type { LatestPlan, ScopedRefine } from './types/planTypeExports';

/** The planner's execution decision out of a parsed plan response. */
export interface PlannerExecution {
  value: 'whole' | 'steps';
  rationale: string | null;
}

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
  latestPlan(flowId: string): LatestPlan | null {
    const row = this.support.latestArtifact(flowId, 'plan');
    if (!row) return null;
    let meta: PlanMeta = { steps: [], branches: [] };
    let rawMeta: Record<string, unknown> = {};
    try {
      const m = row.meta ? JSON.parse(row.meta) : null;
      if (m && typeof m === 'object') {
        rawMeta = m;
        const parsed = parsePlanArtifactMeta(m);
        if (parsed) meta = parsed;
      }
    } catch {
      /* unparseable meta → treated as a branchless plan; scoped refine falls back */
    }
    return { art: { id: row.id, version: row.version, content: row.content }, meta, rawMeta };
  }

  /** Live checklist rows (validated) — hand edits included by construction. */
  liveRows(flowId: string): PlanStepRow[] {
    return rows.all(PlanStepRow, `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`, flowId);
  }

  /** Compact current-steps list from LIVE checklist rows (hand edits included). */
  stepsText(liveRows: PlanStepRow[]): string {
    if (!liveRows.length) return '(none yet)';
    return liveRows
      .map(r => `- ${r.meta_id ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ''} (${r.files?.length ?? 0} files)`)
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
  scopedRefine(flowId: string, branchRef: string): ScopedRefine | null {
    const latest = this.latestPlan(flowId);
    const branch = latest?.meta.branches.find(b => b.name === branchRef);
    if (!latest || !branch) return null;
    return { latest, branch, liveRows: this.liveRows(flowId).filter(s => s.branch === branch.name) };
  }

  /**
   * The planner's execution decision out of a parsed plan response (`execution`
   * + `execution_rationale` are OPTIONAL top-level response fields) —
   * unknown/missing values normalize to `whole` with no rationale, and nothing
   * here can fail the plan (the parse pipeline is not extended with a
   * requirement).
   */
  normalizePlannerExecution(whole: { execution?: unknown; execution_rationale?: unknown } | null | undefined): PlannerExecution {
    const rationale = this.rationaleOf(whole?.execution_rationale);
    if (whole?.execution === 'steps') return { value: 'steps', rationale };
    return { value: 'whole', rationale };
  }

  /** Save the plan artifact and sync the editable step checklist from it (the run path). */
  persistPlan(args: {
    ctx: Pick<FlowCtx, 'flow'>;
    node: NodeRow;
    userMessage: string;
    text: string;
    planMeta: PlanMeta | null;
    plannerExecution?: PlannerExecution | null;
    knob: 'whole' | 'follow';
    refined?: RefinedFrom;
  }): { art: { id: string; version: number }; stepCount: number } {
    // plan fan-out (§1 "who decides the mode"): the published execution
    // resolution rides every plan version in artifacts.meta (`execution`) —
    // precedence: the knob (whole) > the planner's follow value > whole.
    // Sources (auditable per version): "knob" (explicit planning knob),
    // "planner" (follow + the planner decided this version), "default"
    // (follow + the planner published nothing valid ⇒ whole). Re-refining
    // re-publishes; the approve-time override (approve_plan action) writes
    // executionSource "override" into the same meta afterwards.
    let execution: 'whole' | 'steps' = 'whole';
    let source: 'knob' | 'planner' | 'default' = 'knob';
    let rationale: string | undefined;
    if (args.knob === 'follow') {
      execution = args.plannerExecution?.value ?? 'whole';
      source = args.plannerExecution ? 'planner' : 'default';
      rationale = args.plannerExecution?.rationale ?? undefined;
    } else {
      execution = args.knob;
      source = 'knob';
    }
    const art = this.publish(args, {
      feedback: args.userMessage,
      branches: args.planMeta?.branches ?? undefined,
      steps: args.planMeta?.steps ?? undefined,
      execution,
      executionSource: source,
      ...(rationale ? { execution_rationale: rationale } : {}),
      ...(args.refined ? { refinedFrom: args.refined } : {}),
    });
    return { art, stepCount: this.syncSteps(args.ctx.flow.id, art, args.planMeta) };
  }

  /** The single artifact-write path both publish paths share. */
  private publish(
    args: { ctx: Pick<FlowCtx, 'flow'>; node: NodeRow; text: string },
    meta: Record<string, unknown>
  ): { id: string; version: number } {
    return this.support.saveArtifact(args.node.id, args.ctx.flow.id, 'plan', args.text, meta);
  }

  /** Sync the checklist from a plan version's steps (no steps → no-op). */
  private syncSteps(flowId: string, art: { id: string }, planMeta: PlanMeta | null): number {
    return planMeta?.steps?.length ? planSteps.syncFromPlan(flowId, art.id, planMeta.steps) : 0;
  }

  /** One-line rationale, trimmed and capped — missing/blank → null. */
  private rationaleOf(raw: unknown): string | null {
    return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 280) : null;
  }
}
