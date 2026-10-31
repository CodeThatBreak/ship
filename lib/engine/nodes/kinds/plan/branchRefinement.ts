import "server-only";

import { SubPlanResponse, type PlanMeta, type PlanStep, type SubPlanPatch } from './schema';

/**
 * Pure helpers for refining a single branch of a plan.
 * Neither method mutates its inputs.
 */
class BranchRefinement {
  /**
   * Replaces one branch's steps with a refined sub-plan and returns the updated
   * plan.
   *
   * Guarantees:
   * - Steps and branches from other branches are returned as the same object
   *   references, so this code (not the prompt) makes sure unrelated branches
   *   are never changed.
   * - The refined steps go where the branch's old steps were, so the global
   *   step order is kept.
   * - Agent-supplied step ids are kept where possible, so `diffBranchSteps`
   *   can match unchanged steps by id.
   *
   * @throws if `branchName` does not exist in `meta.branches`.
   */
  static merge(meta: PlanMeta, branchName: string, sub: SubPlanResponse): PlanMeta {
    const idx = meta.branches.findIndex(b => b.name === branchName);
    if (idx === -1) throw new Error(`branch "${branchName}" not found`);

    // Assign ids to the incoming steps. Keep the agent's id unless it is
    // missing or clashes with a step in another branch; only then generate a
    // fresh `sN`. Re-assigning every id would make unchanged steps look like
    // remove + add in the diff.
    const taken = new Set(meta.steps.filter(s => s.branch !== branchName).map(s => s.id));
    const reId = (s: PlanStep, i: number) => {
      let id = s.id?.trim() || `s${i + 1}`;
      if (taken.has(id)) {
        let n = taken.size + 1;
        while (taken.has(`s${n}`)) n++;
        id = `s${n}`;
      }
      taken.add(id); // also prevents clashes between the incoming steps themselves
      return { ...s, id, branch: branchName };
    };
    const newSteps = sub.steps.map(reId);

    // Put the new steps where the branch's first old step was. Nothing before
    // that index belongs to this branch, so its position in `meta.steps` is
    // also the right position in `kept`. If the branch had no steps, append.
    const firstOld = meta.steps.findIndex(s => s.branch === branchName);
    const kept = meta.steps.filter(s => s.branch !== branchName);
    const insertAt = firstOld === -1 ? kept.length : firstOld;
    kept.splice(insertAt, 0, ...newSteps);
    const steps = kept;

    // Update only the target branch record. `subPlan.prompt` is kept as-is
    // because the agent does not currently return a revised prompt.
    const branches = meta.branches.map(b =>
      b.name === branchName
        ? {
            ...b,
            steps: newSteps.map(s => s.title),
            markdown: sub.markdown,
            subPlan: b.subPlan ? { ...b.subPlan, steps: newSteps } : undefined,
          }
        : b
    );

    return { steps, branches };
  }

  /**
   * Applies a change-only delta for one branch: optional markdown replace,
   * step upserts by id within the branch, and step removals by id.
   */
  static applyPatch(meta: PlanMeta, branchName: string, patch: SubPlanPatch): PlanMeta {
    const idx = meta.branches.findIndex(b => b.name === branchName);
    if (idx === -1) throw new Error(`branch "${branchName}" not found`);

    let steps = [...meta.steps];
    const removeIds = new Set(patch.removeStepIds ?? []);
    if (removeIds.size > 0) {
      steps = steps.filter(s => !(s.branch === branchName && s.id != null && removeIds.has(s.id)));
    }

    if (patch.upsertSteps?.length) {
      const taken = new Set(steps.filter(s => s.branch !== branchName).map(s => s.id));
      const reId = (s: PlanStep, i: number) => {
        let id = s.id?.trim() || `s${i + 1}`;
        if (taken.has(id)) {
          let n = taken.size + 1;
          while (taken.has(`s${n}`)) n++;
          id = `s${n}`;
        }
        taken.add(id);
        return { ...s, id, branch: branchName };
      };
      const normalized = patch.upsertSteps.map(reId);
      const pending = new Map(normalized.map((s) => [s.id, s] as const));

      steps = steps.map((s) => {
        if (s.branch !== branchName || s.id == null || !pending.has(s.id)) return s;
        const next = pending.get(s.id);
        if (!next) return s;
        pending.delete(s.id);
        return next;
      });

      if (pending.size > 0) {
        let insertAt = -1;
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].branch === branchName) {
            insertAt = i + 1;
            break;
          }
        }
        const at = insertAt === -1 ? steps.length : insertAt;
        steps.splice(at, 0, ...pending.values());
      }
    }

    const branchSteps = steps.filter(s => s.branch === branchName);
    const branches = meta.branches.map(b =>
      b.name === branchName
        ? {
            ...b,
            ...(patch.markdown != null ? { markdown: patch.markdown } : {}),
            steps: branchSteps.map(s => s.title),
            subPlan: b.subPlan ? { ...b.subPlan, steps: branchSteps } : undefined,
          }
        : b
    );

    return { steps, branches };
  }

  // ── Step diffing ───────────────────────────────────────────────────────────

  /** Two steps are equal if their title, detail and files all match (ids are ignored). */
  static stepContentEqual(a: PlanStep, b: PlanStep) {
    return (
      a.title === b.title && a.detail === b.detail && JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? [])
    );
  }

  /**
   * Compares a branch's steps before and after a refinement.
   *
   * 1. Match steps by id: a new id is `added`; a shared id whose content
   *    differs is `changed`.
   * 2. For old ids that have disappeared, look for an `added` step with the
   *    same content. If one exists, the agent only renamed the id: report it
   *    as `changed` with an `old → new` id, not as remove + add.
   * 3. Any old step still unmatched is `removed`.
   *
   * Steps without an id are ignored.
   */
  static diffSteps(
    oldSteps: PlanStep[],
    newSteps: PlanStep[]
  ): {
    added: PlanStep[];
    removed: PlanStep[];
    changed: { id: string; before: PlanStep; after: PlanStep }[];
  } {
    const byId = (arr: PlanStep[]) =>
      new Map(arr.filter((s): s is PlanStep & { id: string } => Boolean(s.id)).map(s => [s.id, s]));
    const oldById = byId(oldSteps);
    const newById = byId(newSteps);

    // Pass 1: match by id.
    const added: PlanStep[] = [];
    const changed: { id: string; before: PlanStep; after: PlanStep }[] = [];
    for (const [id, next] of newById) {
      const prev = oldById.get(id);
      if (!prev) added.push(next);
      else if (!BranchRefinement.stepContentEqual(prev, next)) changed.push({ id, before: prev, after: next });
    }

    // Pass 2: match unpaired old steps to added steps by content (detects renamed ids).
    const leftoversOld = [...oldById.values()].filter(s => !newById.has(s.id));
    const removed: PlanStep[] = [];
    for (const o of leftoversOld) {
      const idx = added.findIndex(n => n.title === o.title && BranchRefinement.stepContentEqual(o, n));
      if (idx >= 0) {
        changed.push({ id: `${o.id ?? '?'} → ${added[idx].id ?? '?'}`, before: o, after: added[idx] });
        added.splice(idx, 1);
      } else {
        removed.push(o);
      }
    }
    return { added, removed, changed };
  }
}

export { BranchRefinement };
