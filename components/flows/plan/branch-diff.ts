import type { Artifact } from "@/types/flow";
import type { BranchPlan } from "./types";

/** A step as recorded in plan-meta `steps` (structural view for diffing). */
export interface DiffStep {
  id: string;
  title: string;
  detail?: string;
  files?: string[];
}

export interface BranchStepDiff {
  added: DiffStep[];
  removed: DiffStep[];
  changed: { id: string; before: DiffStep; after: DiffStep }[];
}

/** The scoped-refine provenance record on a plan version's plan-meta. */
interface ScopedRefineMeta {
  branch?: unknown;
  from?: unknown;
}

const contentEqual = (a: DiffStep, b: DiffStep) =>
  a.title === b.title &&
  a.detail === b.detail &&
  JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []);

const byId = (arr: DiffStep[]): Map<string, DiffStep> => {
  const map = new Map<string, DiffStep>();
  for (const s of arr) if (s.id) map.set(s.id, s);
  return map;
};

/** Id-based diff with a title fallback — merge preserves ids for unchanged steps, so ids mean identity. */
export function diffBranchSteps(
  oldSteps: DiffStep[],
  newSteps: DiffStep[],
): BranchStepDiff {
  const oldById = byId(oldSteps);
  const newById = byId(newSteps);

  const added: DiffStep[] = [];
  const changed: { id: string; before: DiffStep; after: DiffStep }[] = [];
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) added.push(next);
    else if (!contentEqual(prev, next))
      changed.push({ id, before: prev, after: next });
  }
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id));
  const removed: DiffStep[] = [];
  for (const o of leftoversOld) {
    // agents occasionally rename ids on unchanged steps — promote title matches
    const idx = added.findIndex(
      (n) => n.title === o.title && contentEqual(o, n),
    );
    if (idx >= 0) {
      changed.push({
        id: `${o.id} → ${added[idx].id}`,
        before: o,
        after: added[idx],
      });
      added.splice(idx, 1);
    } else {
      removed.push(o);
    }
  }
  return { added, removed, changed };
}

const isMeta = (m: unknown): m is Record<string, unknown> =>
  m != null && typeof m === "object";

const scopedRefineOf = (meta: unknown): ScopedRefineMeta | undefined => {
  if (!isMeta(meta)) return undefined;
  const sr = meta.scopedRefine;
  return sr != null && typeof sr === "object" ? (sr as ScopedRefineMeta) : undefined;
};

const filesOf = (files: unknown): string[] | undefined =>
  Array.isArray(files)
    ? files.filter((f): f is string => typeof f === "string")
    : undefined;

/** Steps of one branch, read from a plan version's plan-meta `steps`. */
export function pickBranchSteps(meta: unknown, branch: string): DiffStep[] {
  const steps = isMeta(meta) ? meta.steps : undefined;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(
      (s): s is Record<string, unknown> =>
        s != null && typeof s === "object" && s.branch === branch,
    )
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : "",
      title: typeof s.title === "string" ? s.title : "",
      detail: typeof s.detail === "string" ? s.detail : undefined,
      files: filesOf(s.files),
    }));
}

/** The scoped-refine diff banner data (§6/§7.3): which branch changed between two versions. */
export interface ScopedDiff {
  branch: string;
  from: number;
  to: number;
  diff: BranchStepDiff;
}

/**
 * Scoped-refine diff banner data (§6/§7.3): computed client-side from the two
 * artifact versions' steps — no server diff endpoint needed.
 */
export function computeScopedDiff(plans: Artifact[]): ScopedDiff | null {
  const latest = plans[plans.length - 1];
  const sr = latest ? scopedRefineOf(latest.meta) : undefined;
  if (!sr || typeof sr.branch !== "string" || !latest) return null;
  const branch: string = sr.branch;
  if (!isMeta(latest.meta) || latest.meta.steps == null) return null;
  const prev = plans.find((a) => a.version === sr.from);
  if (!prev || !prev.meta?.steps) return null;
  const diff = diffBranchSteps(
    pickBranchSteps(prev.meta, branch),
    pickBranchSteps(latest.meta, branch),
  );
  if (!diff.added.length && !diff.removed.length && !diff.changed.length)
    return null;
  if (typeof sr.from !== "number") return null;
  return { branch, from: sr.from, to: latest.version, diff };
}

/**
 * The latest version at which a branch's scoped markdown was written, from
 * artifact metas (scopedRefine provenance).
 */
export function latestScopedRefineVersion(
  arts: Artifact[],
  branchName: string,
): number {
  let v = 0;
  for (const a of arts) {
    const sr = scopedRefineOf(a.meta);
    if (sr?.branch === branchName && typeof sr.from === "number" && a.version > v)
      v = a.version;
  }
  return v;
}

/**
 * Staleness (§8): the overview prose is only rewritten by full-plan refines;
 * a scoped refine makes its branch doc newer than the overview.
 */
export function computeStaleBranches(
  plans: Artifact[],
  branches: BranchPlan[] | null,
  overviewVersion: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!branches || plans.length === 0) return out;
  for (const b of branches) {
    if (!b.markdown) continue;
    const v = latestScopedRefineVersion(plans, b.name);
    if (v > overviewVersion) out.set(b.name, v);
  }
  return out;
}
