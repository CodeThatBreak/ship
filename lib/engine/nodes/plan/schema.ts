import { z } from "zod";

// ── step schema (shared by simple and complex plans) ─────────────────────────

/**
 * Recursive step schema — defined with explicit type annotation to avoid
 * TS circular-initializer errors with z.lazy.
 */
const PlanStepBase = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().default(""),
  files: z.array(z.string()).default([]),
  branch: z.string().nullable().default(null),
});

export type PlanStep = z.infer<typeof PlanStepBase> & {
  subSteps?: PlanStep[];
};

export const PlanStep: z.ZodType<PlanStep> = PlanStepBase.extend({
  subSteps: z.lazy(() => z.array(PlanStep)).optional(),
}) as z.ZodType<PlanStep>;

// ── branch schema (complex plans only) ───────────────────────────────────────

export const PlanBranch = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "branch names must be lowercase alphanumeric + hyphens"),
  title: z.string().min(1),
  scope: z.string().default(""),
  files: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  /**
   * Sub-plan: when present, this branch gets its own dedicated planning
   * agent run before the build, producing a refined sub-plan.
   */
  subPlan: z
    .object({
      prompt: z.string().min(1),
      steps: z.array(PlanStep).optional(),
    })
    .optional(),
  /**
   * This branch's own plan document — written by a branch-scoped refine,
   * shown in the branch tab. Absent until the first scoped refine.
   */
  markdown: z.string().optional(),
});
export type PlanBranch = z.infer<typeof PlanBranch>;

// ── simple plan response (JSON-only) ─────────────────────────────────────────

/** Simple plan: JSON with markdown + steps only. No branches. */
export const SimplePlanResponse = z.object({
  /** The plan in Markdown — rendered to the user as the plan document. */
  markdown: z.string().min(1),
  /** The ordered checklist of work. */
  steps: z.array(PlanStep).min(1),
});
export type SimplePlanResponse = z.infer<typeof SimplePlanResponse>;

// ── branch-scoped sub-plan response (JSON-only) ──────────────────────────────

/**
 * Response for a branch-scoped refine: this branch's sub-plan only.
 * The agent re-emits ONE branch, not the whole plan — merge is deterministic
 * code (`mergeBranchRefine`), never a full-plan regeneration.
 */
export const SubPlanResponse = z.object({
  /** This branch's implementation detail in Markdown (rendered in the branch tab). */
  markdown: z.string().min(1),
  /** Refined steps for THIS branch; "branch" is forced to the ref'd branch on merge. */
  steps: z.array(PlanStep).min(1),
});
export type SubPlanResponse = z.infer<typeof SubPlanResponse>;

// ── complex plan response (JSON-only) ────────────────────────────────────────

/** Complex plan: JSON with markdown + steps + branches + sub-plans. */
export const ComplexPlanResponse = z.object({
  /** The plan in Markdown — rendered to the user as the plan document. */
  markdown: z.string().min(1),
  /** The ordered checklist of work. */
  steps: z.array(PlanStep).min(1),
  /** Branch decomposition for multi-part work. */
  branches: z.array(PlanBranch).optional().default([]),
});
export type ComplexPlanResponse = z.infer<typeof ComplexPlanResponse>;

// ── validation errors ────────────────────────────────────────────────────────

export interface PlanValidationError {
  path: string;
  message: string;
}

const PlanValidationErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

// ── validators ───────────────────────────────────────────────────────────────

/** Shared branch pre-check: unique names, dependsOn references resolve. */
function validateBranchConstraints(
  raw: unknown,
  errCtor: (errs: PlanValidationError[]) => { errors: PlanValidationError[] },
): PlanValidationError[] | null {
  if (typeof raw !== "object" || raw == null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.branches) || !r.branches.length) return null;

  const names = new Set<string>();
  for (const b of r.branches) {
    const name = (b as Record<string, unknown>)?.name;
    if (typeof name !== "string" || !name) {
      return [{ path: "branches[].name", message: "each branch must have a name" }];
    }
    if (names.has(name)) {
      return [{ path: "branches[].name", message: `duplicate branch name "${name}"` }];
    }
    names.add(name);
  }
  for (const b of r.branches) {
    const deps = (b as Record<string, unknown>)?.dependsOn;
    if (Array.isArray(deps)) {
      for (const dep of deps) {
        if (typeof dep === "string" && !names.has(dep)) {
          return [{ path: `branches[name=${(b as Record<string, unknown>).name}].dependsOn`, message: `dependsOn references unknown branch "${dep}"` }];
        }
      }
    }
  }
  return null;
}

/** Normalize step ids: fill in missing, ensure unique. Returns errors on duplicates. */
function normalizeStepIds(steps: PlanStep[]): PlanValidationError[] | null {
  if (!steps.length) return null;
  const ids = new Set<string>();
  const normalized = steps.map((s, i) => {
    const id = s.id?.trim() || `s${i + 1}`;
    return { ...s, id };
  });
  for (const s of normalized) {
    if (ids.has(s.id!)) {
      return [{ path: "steps[].id", message: `duplicate step id "${s.id}"` }];
    }
    ids.add(s.id!);
  }
  // mutate in place
  for (let i = 0; i < steps.length; i++) Object.assign(steps[i], normalized[i]);
  return null;
}

/** Validate raw JSON as a SimplePlanResponse. */
export function validateSimplePlan(raw: unknown): { plan: SimplePlanResponse; errors: [] } | { plan: null; errors: PlanValidationError[] } {
  const parsed = SimplePlanResponse.safeParse(raw);
  if (!parsed.success) {
    return { plan: null, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const stepErr = normalizeStepIds(parsed.data.steps);
  if (stepErr) return { plan: null, errors: stepErr };
  return { plan: parsed.data, errors: [] };
}

/**
 * Validate raw JSON as a SubPlanResponse (branch-scoped refine).
 * Mirrors `validateSimplePlan`: safeParse + normalizeStepIds only — no
 * branch-name/dependsOn cross-checks, since there are no branches in scope.
 * A step's "branch" may be null OR the ref'd branch name — an agent echoing
 * the branch name must not fail validation (merge forces it either way).
 * A failure costs one small retry, not a full plan regeneration.
 */
export function validateSubPlan(raw: unknown): { plan: SubPlanResponse; errors: [] } | { plan: null; errors: PlanValidationError[] } {
  const parsed = SubPlanResponse.safeParse(raw);
  if (!parsed.success) {
    return { plan: null, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const stepErr = normalizeStepIds(parsed.data.steps);
  if (stepErr) return { plan: null, errors: stepErr };
  return { plan: parsed.data, errors: [] };
}

/** Validate raw JSON as a ComplexPlanResponse. */
export function validateComplexPlan(raw: unknown): { plan: ComplexPlanResponse; errors: [] } | { plan: null; errors: PlanValidationError[] } {
  const branchErr = validateBranchConstraints(raw, (e) => ({ errors: e }));
  if (branchErr) return { plan: null, errors: branchErr };

  const parsed = ComplexPlanResponse.safeParse(raw);
  if (!parsed.success) {
    return { plan: null, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }

  // steps must reference valid branches
  const data = parsed.data;
  if (data.branches.length > 0) {
    const branchNames = new Set(data.branches.map((b) => b.name));
    for (const s of data.steps) {
      if (s.branch != null && !branchNames.has(s.branch)) {
        return { plan: null, errors: [{ path: `steps[${s.id}].branch`, message: `step "${s.id}" references unknown branch "${s.branch}"` }] };
      }
    }
  }

  const stepErr = normalizeStepIds(data.steps);
  if (stepErr) return { plan: null, errors: stepErr };
  return { plan: data, errors: [] };
}

// ── legacy compat (PlanMeta used by steps store, artifact meta) ──────────────

/** Backwards-compat alias: PlanMeta is now just the steps+branches subset. */
export const PlanMeta = z.object({
  steps: z.array(PlanStep).min(1),
  branches: z.array(PlanBranch).optional().default([]),
});
export type PlanMeta = z.infer<typeof PlanMeta>;

/** Backwards-compat alias. */
export const PlanMetaStep = PlanStep;
export type PlanMetaStep = PlanStep;

/** Backwards-compat: validate PlanMeta (used by PlanMetaParser for old format). */
export function validatePlanMeta(raw: unknown): { meta: PlanMeta; errors: [] } | { meta: null; errors: PlanValidationError[] } {
  const branchErr = validateBranchConstraints(raw, (e) => ({ errors: e }));
  if (branchErr) return { meta: null, errors: branchErr };
  const parsed = PlanMeta.safeParse(raw);
  if (!parsed.success) {
    return { meta: null, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const stepErr = normalizeStepIds(parsed.data.steps);
  if (stepErr) return { meta: null, errors: stepErr };
  return { meta: parsed.data, errors: [] };
}

/** Backwards-compat alias. */
export type PlanMetaValidationError = PlanValidationError;

// ── input / output schemas ───────────────────────────────────────────────────

export const PlanInput = z.object({
  /** developer feedback when refining an existing plan */
  feedback: z.string().nullable().default(null),
  /** verbatim prompt override (bypasses the template) */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-editable body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  /** decompose into sub-agents for repo exploration */
  decompose: z.boolean().default(false),
  /** per-run model override */
  model: z.string().nullable().default(null),
  /** complex plan mode — JSON with branches + sub-plans (false = simple plan) */
  complex: z.boolean().default(false),
  /** when refining a specific branch's sub-plan: the branch name */
  branchRef: z.string().nullable().default(null),
  /**
   * Start a clean agent instead of following up on the node's existing one.
   * Null = per-mode default: scoped refines default to fresh (their template
   * is self-contained, §3); whole-plan refines default to follow-up. Explicit
   * true always wins — `fresh` beats a follow-up even if an agent exists.
   */
  fresh: z.boolean().nullable().default(null),
  /**
   * Ids of the context blocks to assemble into {{context}} (see the block
   * registry in plan-node). Unknown ids are dropped server-side; the pinned
   * `contract` block is always included for scoped refines regardless.
   */
  contextBlocks: z.array(z.string()).default([]),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const PlanOutput = z.object({
  latestArtifact: z.string(),
  version: z.number(),
  branches: z.array(PlanBranch).optional(),
  steps: z.array(PlanStep).optional(),
  /** true when the response failed validation even after retry */
  malformed: z.boolean().optional(),
  /** validation errors from the failed parse */
  validationErrors: z.array(PlanValidationErrorSchema).optional(),
  /** true when this plan was generated in complex mode */
  complex: z.boolean().optional(),
  /** set on the artifact version a branch-scoped refine produced */
  scopedRefine: z
    .object({
      branch: z.string(),
      /** artifact version the refine was based on (diff banner source) */
      from: z.number(),
    })
    .optional(),
});
export type PlanOutput = z.infer<typeof PlanOutput>;
