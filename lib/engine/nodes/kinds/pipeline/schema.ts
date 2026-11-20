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
  /** the last pipeline the gate watched — null when none was ever seen (the
   *  deadline-timeout terminal publishes this fully-populated shape instead
   *  of the old bare `{}`; step 05) */
  pipelineId: z.number().nullable(),
  status: z.string(),
  fixes: z.number(),
  branchName: z.string().optional(),
  /** set on the deadline-timeout terminal */
  timedOut: z.boolean().optional(),
});
export type PipelineOutput = z.infer<typeof PipelineOutput>;

/**
 * The gate's durable wait progress (step 05): the Zod mirror of
 * `types/gateProgress.ts` — every write and read of the `gate_progress`
 * artifact meta goes through this, so a corrupt blob can never silently
 * become an empty loop state.
 */
export const GateProgressSchema = z.object({
  watchedId: z.number().nullable(),
  lastSeen: z.string().nullable(),
  fixedIds: z.array(z.number()),
  triggerAttempted: z.boolean(),
  fixWaitStart: z.number().nullable(),
  manualPlays: z.record(z.string(), z.object({ plays: z.number(), warned: z.boolean() })),
  fixes: z.number(),
  deadlineAt: z.number().nullable(),
});

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
