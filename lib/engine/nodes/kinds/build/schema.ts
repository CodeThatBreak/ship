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

/** The unit item a build split child consumes (agent-node split plan §2.4):
 *  the branch's plan document + branch contract. `title`/`scope` are
 *  required — the old hand-narrow silently defaulted a missing title to the
 *  name and an empty scope (the audit's silent-default hole, closed here). */
export const SplitUnitItem = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  scope: z.string(),
  plan: z.string().nullable(),
});

export type SplitUnitItem = z.infer<typeof SplitUnitItem>;

/** The split child's trigger payload — `{ parentNodeKey, unit: {…, item } }`. */
export const SplitUnitPayload = z.object({ unit: z.object({ item: SplitUnitItem }) });

/**
 * The build's `consumes` contract (step 04): the upstream facts a build run's
 * materialized input carries. Whole runs carry the plan; split children carry
 * the `unit` (or their derived plan); fan-out step children carry the `step`
 * payload; the commit-fix loop carries `feedback` (approved → running
 * effect). At least one must be present — an empty build input is a contract
 * violation, not a silent no-op run.
 */
export const BuildConsumes = z
  .object({
    plan: z.string().min(1).nullable().optional(),
    unit: z.unknown().optional(),
    step: z.unknown().optional(),
    feedback: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v) => v.plan != null || v.unit != null || v.step != null || v.feedback != null,
    { message: "a build run carries its plan (whole or split unit), a fan-out step payload, or commit-fix feedback" },
  );

// ── step-build child trigger payload (fan-out) ───────────────────────────────

export const StepBuildSibling = z.object({
  id: z.string(),
  title: z.string(),
  files: z.array(z.string()).default([]),
  status: z.string().default("pending"),
  mergeStatus: z.string().optional(),
  summary: z.string().optional(),
});
export type StepBuildSibling = z.infer<typeof StepBuildSibling>;

export const StepBuildStepPayload = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  files: z.array(z.string()).default([]),
  branch: z.string().optional(),
});
export type StepBuildStepPayload = z.infer<typeof StepBuildStepPayload>;

export const StepBuildTriggerPayload = z.object({
  step: StepBuildStepPayload,
  siblings: z.array(StepBuildSibling).default([]),
});
export type StepBuildTriggerPayload = z.infer<typeof StepBuildTriggerPayload>;

/** Render sibling steps for the step-build context pack prompt section. */
export const formatStepBuildContextPack = (siblings: StepBuildSibling[]): string => {
  if (!siblings.length) return "(no sibling steps)";
  const lines = siblings.map((s) => {
    const files = s.files ?? [];
    const merge = s.mergeStatus ? ` · merge: ${s.mergeStatus}` : "";
    const summary = s.summary ? ` — summary: ${s.summary}` : "";
    return `- ${s.id}: ${s.title}${files.length ? ` (files: ${files.join(", ")})` : ""} — currently ${s.status}${merge}${summary}`;
  });
  return [
    ...lines,
    ``,
    `Do NOT modify files owned by other pending steps; if your step genuinely requires one, keep the change minimal and call it out in your summary.`,
  ].join("\n");
};
