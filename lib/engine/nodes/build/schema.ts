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
    /** approved plan content (required for a fresh build; omit for a chat refine) */
    plan: z.string().min(1).nullable().default(null),
    /** verbatim prompt override */
    prompt: z.string().nullable().default(null),
    /** multi-branch: which branch of the plan to build */
    branchInfo: BuildBranchInfo.nullable().default(null),
    /** chat refine: developer feedback for a follow-up run */
    feedback: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
  })
  .refine((v) => v.feedback != null || (v.plan != null && v.plan.length > 0), {
    message: "plan is required for a build (or pass feedback for a refine)",
  });
export type BuildInput = z.infer<typeof BuildInput>;

export const BuildOutput = z.object({
  branch: z.string(),
  latestArtifact: z.string(),
  branchName: z.string().optional(),
});
export type BuildOutput = z.infer<typeof BuildOutput>;
