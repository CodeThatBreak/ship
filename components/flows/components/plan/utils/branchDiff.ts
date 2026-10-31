import type { Artifact } from "@/types/flow";
import type { BranchPlan } from "../types/planTypes";
import {
  PLAN_TAB_CAPTION_BRANCH_PREFIX,
  PLAN_TAB_CAPTION_MAX,
  PLAN_TAB_CAPTION_REFINED_IN_CHAT,
  PLAN_REFINED_SOURCE_CHAT,
} from "../constants/planConstants";

/** A step as recorded in plan-meta `steps` (structural view for diffing). */
export interface DiffStep {
  id: string;
  title: string;
  detail?: string;
  files?: string[];
}

/** The same diff shape over any step record — the whole-plan rows carry
 *  their `branch` annotation through the identical comparator machinery. */
export interface StepDiff<T extends DiffStep = DiffStep> {
  added: T[];
  removed: T[];
  changed: { id: string; before: T; after: T }[];
}

export type BranchStepDiff = StepDiff;

/** The scoped-refine provenance record on a plan version's plan-meta. */
interface ScopedRefineMeta {
  branch?: unknown;
  from?: unknown;
}

const contentEqual = (a: DiffStep, b: DiffStep) =>
  a.title === b.title &&
  a.detail === b.detail &&
  JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []);

const byId = <T extends DiffStep>(arr: T[]): Map<string, T> => {
  const map = new Map<string, T>();
  for (const s of arr) if (s.id) map.set(s.id, s);
  return map;
};

/** Id-based diff with a title fallback — merge preserves ids for unchanged steps, so ids mean identity. */
export function diffBranchSteps<T extends DiffStep>(
  oldSteps: T[],
  newSteps: T[],
): StepDiff<T> {
  const oldById = byId(oldSteps);
  const newById = byId(newSteps);

  const added: T[] = [];
  const changed: { id: string; before: T; after: T }[] = [];
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) added.push(next);
    else if (!contentEqual(prev, next))
      changed.push({ id, before: prev, after: next });
  }
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id));
  const removed: T[] = [];
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

/** The shared plan-meta step → step-record mapping for both pickers. */
const diffStepOf = (s: Record<string, unknown>): WholeStep => ({
  id: typeof s.id === "string" ? s.id : "",
  title: typeof s.title === "string" ? s.title : "",
  detail: typeof s.detail === "string" ? s.detail : undefined,
  files: filesOf(s.files),
  branch: typeof s.branch === "string" ? s.branch : undefined,
});

/** Steps of one branch, read from a plan version's plan-meta `steps`. */
export function pickBranchSteps(meta: unknown, branch: string): DiffStep[] {
  const steps = isMeta(meta) ? meta.steps : undefined;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(
      (s): s is Record<string, unknown> =>
        s != null && typeof s === "object" && s.branch === branch,
    )
    .map(diffStepOf);
}

/** A whole-plan step row: the DiffStep plus its branch annotation (§6a). */
export interface WholeStep extends DiffStep {
  /** the branch the step belongs to; undefined for main-plan steps */
  branch?: string;
}

/** Steps of the ENTIRE plan (all branches + main), keeping each step's
 *  `branch` on the record so banner rows can be annotated `branch: auth`. */
export function pickWholeSteps(meta: unknown): WholeStep[] {
  const steps = isMeta(meta) ? meta.steps : undefined;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(
      (s): s is Record<string, unknown> => s != null && typeof s === "object",
    )
    .map(diffStepOf);
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

/** The `refinedFrom` provenance record on a plan version's plan-meta (§6c). */
interface RefinedFromMeta {
  version?: unknown;
  source?: unknown;
}

const refinedFromOf = (meta: unknown): RefinedFromMeta | undefined => {
  if (!isMeta(meta)) return undefined;
  const rf = meta.refinedFrom;
  return rf != null && typeof rf === "object" ? (rf as RefinedFromMeta) : undefined;
};

/** The whole-plan refine diff banner data (§6a). */
export interface WholePlanDiff {
  /** the version the refine was based on (latest − 1) */
  fromVersion: number;
  toVersion: number;
  /** the step rows carry their `branch` annotation for row rendering */
  diff: StepDiff<WholeStep>;
}

/**
 * Whole-plan refine diff banner data (§6a): computed client-side from the two
 * artifact versions' steps. Fires ONLY when the latest version carries a
 * refine provenance mark — `refinedFrom` (§6c) or a toggle-era `meta.feedback`
 * alone — and diffs it against the immediately-previous version. `from` =
 * `latest.version − 1`; null without the mark, without the previous version,
 * or when nothing changed.
 */
export function computeWholePlanDiff(plans: Artifact[]): WholePlanDiff | null {
  const latest = plans[plans.length - 1];
  if (!latest || !isMeta(latest.meta) || latest.meta.steps == null) return null;
  const refinedFrom = refinedFromOf(latest.meta);
  const hasFeedback =
    typeof latest.meta.feedback === "string" && latest.meta.feedback !== "";
  if (!refinedFrom && !hasFeedback) return null;
  const fromVersion = latest.version - 1;
  const prev = plans.find((a) => a.version === fromVersion);
  if (!prev || !prev.meta?.steps) return null;
  const diff = diffBranchSteps(
    pickWholeSteps(prev.meta),
    pickWholeSteps(latest.meta),
  );
  if (!diff.added.length && !diff.removed.length && !diff.changed.length)
    return null;
  return { fromVersion, toVersion: latest.version, diff };
}

/** The version tab caption built from plan-meta (§6b): the feedback echo when
 *  recorded, else the scoped-refine branch, else the chat-refine provenance. */
export function planTabCaption(meta: unknown): string | undefined {
  if (!isMeta(meta)) return undefined;
  const feedback = typeof meta.feedback === "string" ? meta.feedback.trim() : "";
  if (feedback) {
    const compact = feedback.replace(/\s+/g, " ");
    const short =
      compact.length > PLAN_TAB_CAPTION_MAX
        ? `${compact.slice(0, PLAN_TAB_CAPTION_MAX)}…`
        : compact;
    return `“${short}”`;
  }
  const sr = scopedRefineOf(meta);
  if (typeof sr?.branch === "string")
    return `${PLAN_TAB_CAPTION_BRANCH_PREFIX}${sr.branch}`;
  const refinedFrom = refinedFromOf(meta);
  if (refinedFrom?.source === PLAN_REFINED_SOURCE_CHAT)
    return PLAN_TAB_CAPTION_REFINED_IN_CHAT;
  return undefined;
}
