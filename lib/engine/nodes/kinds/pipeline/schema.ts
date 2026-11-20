import "server-only";

import { z } from "zod";

// ── input / output schemas ───────────────────────────────────────────────────
export const PipelineInput = z.object({
  /** multi-branch: watch the pipeline for a specific branch's MR */
  branchName: z.string().nullable().default(null),
  /** specific pipeline id to watch (defaults to the MR head pipeline) */
  pipelineId: z.number().int().positive().nullable().default(null),
  /** extra developer guidance for fix runs */
  guidance: z.string().nullable().default(null),
  /** verbatim prompt override (applied to fix runs) */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-edited body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  model: z.string().nullable().default(null),
});
export type PipelineInput = z.infer<typeof PipelineInput>;

export const PipelineOutput = z.object({
  pipelineId: z.number(),
  status: z.string(),
  fixes: z.number(),
  branchName: z.string().optional(),
});
export type PipelineOutput = z.infer<typeof PipelineOutput>;

/**
 * The gate's `consumes` contract (step 04): the branch/pipeline facts the run
 * watches. The MR (and its head pipeline) resolve from flow state at run time
 * (`mrTargetResolver` + the GitLab host) — the materialized input carries the
 * optional overrides, so the contract is deliberately thin here.
 */
export const PipelineConsumes = z.object({
  branchName: z.string().nullable().optional(),
  pipelineId: z.number().int().positive().nullable().optional(),
});
