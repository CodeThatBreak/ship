import "server-only";

import type { FlowCtx, SplitUnit } from '../../shared';
import type { PlanStore } from './plan-store';
import type { ExecutionKnob } from './plan-prompt';

/**
 * The plan's split source port (agent-node split plan §2.1): the plan's
 * branches as split units, scheduled purely by the branch DAG, plus the
 * published resolution recommendation consumers with `split_consume: "source"`
 * honor. The producer only answers "here are my units / my recommended
 * resolution" — it never spawns anything; the split runtime owns
 * expansion/scheduling/join.
 */
export class PlanSplitter {
  constructor(
    private readonly store: PlanStore,
    private readonly knobOf: (ctx: FlowCtx) => ExecutionKnob,
  ) {}

  /**
   * The plan's branches as split units (Phase 6): one unit per declared
   * branch, scheduled purely by the branch DAG. The unit's item carries the
   * branch contract plus the full plan document (`plan`) so the child build
   * run gets its complete context — the same input build's own multi-branch
   * triggerRuns decomposition passes. Null when there is no plan artifact
   * or no branches (the consumer then runs whole).
   */
  units(ctx: FlowCtx): SplitUnit[] | null {
    const latest = this.store.latestPlan(ctx.flow.id);
    if (!latest || !latest.meta.branches.length) return null;
    return latest.meta.branches.map(b => ({
      key: b.name,
      title: b.title,
      dependsOn: [...b.dependsOn],
      target: 'build',
      item: {
        name: b.name,
        title: b.title,
        scope: b.scope,
        files: b.files,
        dependsOn: b.dependsOn,
        subPlan: b.subPlan ?? null,
        markdown: b.markdown ?? null,
        plan: latest.art.content,
      },
    }));
  }

  /**
   * The published resolution recommendation (§2.4), honored by consumers
   * whose `split_consume` knob is "source": knob whole → whole; follow →
   * the published plan-version meta decides (execution "steps" ⇒ per-unit,
   * anything else whole). Total: a missing/unparseable plan artifact
   * resolves whole — never throws.
   */
  resolution(ctx: FlowCtx): 'whole' | 'per-unit' | null {
    const knob = this.knobOf(ctx);
    if (knob === 'follow') {
      const published = this.store.latestPlan(ctx.flow.id)?.rawMeta.execution;
      return published === 'steps' ? 'per-unit' : 'whole';
    }
    return 'whole';
  }
}
