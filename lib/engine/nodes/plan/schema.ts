import { z } from "zod";

// ── structured plan-meta (emitted by the agent in a ```json plan-meta block) ─
export const PlanBranch = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "branch names must be lowercase alphanumeric + hyphens"),
  title: z.string().default(""),
  scope: z.string().default(""),
  files: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});
export type PlanBranch = z.infer<typeof PlanBranch>;

export const PlanMetaStep = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().default(""),
  files: z.array(z.string()).default([]),
  branch: z.string().nullable().default(null),
});
export type PlanMetaStep = z.infer<typeof PlanMetaStep>;

export const PlanMeta = z.object({
  steps: z.array(PlanMetaStep).optional(),
  branches: z.array(PlanBranch).optional(),
});
export type PlanMeta = z.infer<typeof PlanMeta>;

// ── input / output schemas ───────────────────────────────────────────────────
export const PlanInput = z.object({
  /** developer feedback when refining an existing plan */
  feedback: z.string().nullable().default(null),
  /** verbatim prompt override (bypasses the template) */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-edited body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  /** decompose into sub-agents for repo exploration */
  decompose: z.boolean().default(false),
  /** per-run model override */
  model: z.string().nullable().default(null),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const PlanOutput = z.object({
  latestArtifact: z.string(),
  version: z.number(),
  branches: z.array(PlanBranch).optional(),
  steps: z.array(PlanMetaStep).optional(),
});
export type PlanOutput = z.infer<typeof PlanOutput>;
