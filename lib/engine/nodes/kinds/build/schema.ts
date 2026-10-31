import "server-only";

import { z } from "zod";

// ── input / output schemas ───────────────────────────────────────────────────
export const BuildBranchInfo = z.object({
  name: z.string(),
  title: z.string().optional(),
  scope: z.string().optional(),
});
export type BuildBranchInfo = z.infer<typeof BuildBranchInfo>;

export const BuildInput = z
  .object({
    /** approved plan content (required for a fresh whole build; omit for a chat refine) */
    plan: z.string().min(1).nullable().default(null),
    /** verbatim prompt override */
    prompt: z.string().nullable().default(null),
    /** multi-branch: which branch of the plan to build */
    branchInfo: BuildBranchInfo.nullable().default(null),
    /** chat refine: developer feedback for a follow-up run */
    feedback: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    /**
     * plan fan-out (Phase 1C): the step payload step children run against
     * (`{id,title,detail,files,branch}`). Whole-mode builds never set it —
     * its presence (absent plan) is what makes a run a STEP build, and the
     * step_build def consumes it; the engine validates one schema for both.
     */
    step: z.unknown().optional(),
  })
  .refine((v) => v.feedback != null || v.step != null || (v.plan != null && v.plan.length > 0), {
    message: "plan is required for a build (or pass feedback for a refine / a step payload for a fan-out step child)",
  });
export type BuildInput = z.infer<typeof BuildInput>;

export const BuildOutput = z.object({
  branch: z.string(),
  latestArtifact: z.string(),
  branchName: z.string().optional(),
});
export type BuildOutput = z.infer<typeof BuildOutput>;
