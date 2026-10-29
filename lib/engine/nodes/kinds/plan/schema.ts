import { z } from "zod";
import { detectUnitCycle } from "../../shared";

// ── step schema (shared by every plan response) ──────────────────────────────

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

/**
 * Fill missing step ids (s1, s2, …) — pure (returns new objects). The plan
 * contract allows the agent to omit ids; the id-based scoped-refine diff and
 * the checklist's cross-version identity need them filled.
 */
export function withStepIds(steps: PlanStep[]): PlanStep[] {
  return steps.map((s, i) => ({ ...s, id: s.id?.trim() || `s${i + 1}` }));
}

// ── plan meta (the steps store + artifact meta shape) ─────────────────────────

/**
 * The plan runtime meta: the checklist plus the optional branch decomposition.
 * Persisted in plan artifact meta and consumed by the steps store / fan-out.
 */
export type PlanMeta = {
  steps: PlanStep[];
  branches: PlanBranch[];
};

// ── branch schema ─────────────────────────────────────────────────────────────

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

// ── the whole-plan response (JSON-only) ──────────────────────────────────────

/**
 * The ONE plan response schema (§F1): markdown + steps + optional branches.
 * The plan-domain cross-checks (unique branch names, dependsOn resolution,
 * step.branch membership, duplicate step ids) are schema refinements so they
 * ride the same issues payload — and the same retry feedback — as every other
 * violation. A `branch`-less plan is just every step's `branch` left null.
 */
export const PlanResponse = z
  .object({
    /** The plan in Markdown — rendered to the user as the plan document. */
    markdown: z.string().min(1),
    /** The ordered checklist of work. */
    steps: z.array(PlanStep).min(1),
    /** Branch decomposition for multi-part work. */
    branches: z.array(PlanBranch).optional(),
    /**
     * Phase 3B (`execution_default: follow`): the planner's execution
     * resolution for this plan version — a plain STRING on purpose: an
     * unexpected value must never fail the plan (normalizePlannerExecution
     * maps unknown/missing to `whole`).
     */
    execution: z.string().optional(),
    /** One-line rationale published with the execution under `follow` (Phase 3B). */
    execution_rationale: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const branchNames = new Set<string>();
    for (const b of val.branches ?? []) {
      if (branchNames.has(b.name)) {
        ctx.addIssue({ code: "custom", path: ["branches"], message: `duplicate branch name "${b.name}"` });
      }
      branchNames.add(b.name);
    }
    if (branchNames.size > 0) {
      for (const b of val.branches ?? []) {
        for (const dep of b.dependsOn) {
          if (!branchNames.has(dep)) {
            ctx.addIssue({
              code: "custom",
              path: ["branches"],
              message: `dependsOn references unknown branch "${dep}"`,
            });
          }
        }
      }
      // branch DAG: a dependency cycle would deadlock the per-branch
      // scheduler — the split runtime fails expansion on one (§3), so the
      // plan contract rejects it here, where the retry feedback can fix it
      const cycle = detectUnitCycle(
        (val.branches ?? []).map((b) => ({ key: b.name, title: b.title, dependsOn: b.dependsOn, item: b })),
      );
      if (cycle) {
        ctx.addIssue({
          code: "custom",
          path: ["branches"],
          message: `branch dependency cycle: ${cycle.join(" → ")}`,
        });
      }
      for (const s of val.steps) {
        if (s.branch != null && !branchNames.has(s.branch)) {
          // the id as the agent would have filled it (withStepIds) — the same
          // identity the checklist publishes
          const id = s.id?.trim() || `s${val.steps.indexOf(s) + 1}`;
          ctx.addIssue({
            code: "custom",
            path: ["steps"],
            message: `step "${id}" references unknown branch "${s.branch}"`,
          });
        }
      }
    }
    const seen = new Set<string>();
    val.steps.forEach((s, i) => {
      const id = s.id?.trim() || `s${i + 1}`;
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", path: ["steps"], message: `duplicate step id "${id}"` });
      }
      seen.add(id);
    });
  });
export type PlanResponse = z.infer<typeof PlanResponse>;

// ── the conversation follow-up response (JSON-only, §1) ─────────────────────

/**
 * A plan conversation turn's response (docs/plan-conversation-refine.md §1):
 * always a reply, optionally a plan. `plan` present ⇒ the engine applies it as
 * a new version (§3 — the same whole-plan persist path as a refine, state-
 * guarded); absent (or an explicit `null`) ⇒ reply only — node status,
 * artifacts and checklist untouched.
 *
 * NOTE — parse-time strictness (§1): the pipeline ({@link ./plan-followup})
 * does NOT `safeParse` whole turns against this schema, because it couples the
 * envelope shape to the plan payload's schema refinements — a turn whose plan
 * carries a refinement violation would degrade silently to reply-only. The
 * turn kind is decided envelope-shape-only; `PlanNode.applyPlanVersion`
 * validates the plan payload itself and drives the §3c bounded retry.
 * This schema stays the canonical contract: the retry directive advertises it.
 */
export const PlanFollowUp = z.object({
  reply: z.string().min(1),
  // .nullish(): an explicit "plan": null and an omitted "plan" mean the same (reply only)
  plan: PlanResponse.nullish(),
});
export type PlanFollowUp = z.infer<typeof PlanFollowUp>;

// ── branch-scoped sub-plan response (JSON-only) ──────────────────────────────

/**
 * Response for a branch-scoped refine: this branch's sub-plan only.
 * The agent re-emits ONE branch, not the whole plan — merge is deterministic
 * code (`mergeBranchRefine`), never a full-plan regeneration.
 */
export const SubPlanResponse = z
  .object({
    /** This branch's implementation detail in Markdown (rendered in the branch tab). */
    markdown: z.string().min(1),
    /** Refined steps for THIS branch; "branch" is forced to the ref'd branch on merge. */
    steps: z.array(PlanStep).min(1),
  })
  .superRefine((val, ctx) => {
    // the only plan-domain rule in scope: unique filled step ids (a scoped
    // retry stays scoped — no branch cross-checks exist here)
    const seen = new Set<string>();
    val.steps.forEach((s, i) => {
      const id = s.id?.trim() || `s${i + 1}`;
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", path: ["steps"], message: `duplicate step id "${id}"` });
      }
      seen.add(id);
    });
  });
export type SubPlanResponse = z.infer<typeof SubPlanResponse>;

// ── the response contracts the output-contract directive advertises ──────────

/**
 * JSON Schemas generated from the response schemas — carried into
 * `AgentOutputError.directive()` on the run and retry prompts. The schema
 * refinements above (uniqueness, cross-references) are enforced server-side;
 * the advertised schema is the structural contract only.
 */
export const PLAN_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(PlanResponse);
export const SUB_PLAN_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(SubPlanResponse);
/** The conversation follow-up contract (§1) — the chat retry's directive schema. */
export const PLAN_FOLLOWUP_JSON_SCHEMA: unknown = z.toJSONSchema(PlanFollowUp);

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
