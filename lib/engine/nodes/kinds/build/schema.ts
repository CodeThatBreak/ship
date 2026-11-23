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
    /** chat first turn: the message is the user-edited body only (the build template is body-only) */
    promptIsBody: z.boolean().default(false),
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

/**
 * The build agent's trailing ` ```json build-progress` ` report (step 05): the
 * ids of the plan steps the run fully completed. The contract the shared
 * agent-output validator enforces — a missing or unparseable report with
 * pending steps is a failed node, never a silent empty list.
 */
export const BuildProgressReport = z.object({
  completed: z.array(z.string()),
});
export type BuildProgressReport = z.infer<typeof BuildProgressReport>;

/**
 * The build's `consumes` contract (step 04): the upstream facts a build run's
 * materialized input carries — the approved plan, or the commit-fix loop's
 * `feedback` (approved → running effect). At least one must be present — an
 * empty build input is a contract violation, not a silent no-op run.
 */
export const BuildConsumes = z
  .object({
    plan: z.string().min(1).nullable().optional(),
    feedback: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v) => v.plan != null || v.feedback != null,
    { message: "a build run carries its plan or commit-fix feedback" },
  );
