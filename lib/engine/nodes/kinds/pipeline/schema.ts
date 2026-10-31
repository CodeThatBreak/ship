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
