import 'server-only';

import { z } from 'zod';
import { rejectInvalidBranchNameShape } from '../../../../git/branchName';
import { PlanTurnKind } from './constants/planTurn';

// ── step schema (shared by every plan response) ──────────────────────────────

/** A single checklist step — the atom of every plan response. */
export const PlanStep = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().default(''),
  files: z.array(z.string()).default([]),
  branch: z
    .string()
    .nullable()
    .default(null)
    .superRefine((b, ctx) => {
      if (b == null) return;
      try {
        rejectInvalidBranchNameShape(b);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.addIssue({ code: 'custom', message: msg });
      }
    }),
});
export type PlanStep = z.infer<typeof PlanStep>;

/**
 * Fill missing step ids (s1, s2, …) — pure (returns new objects). The plan
 * contract allows the agent to omit ids; the id-based diff and the checklist's
 * cross-version identity need them filled.
 */
export function withStepIds(steps: PlanStep[]): PlanStep[] {
  return steps.map((s, i) => ({ ...s, id: s.id?.trim() || `s${i + 1}` }));
}

// ── plan meta (the steps store + artifact meta shape) ─────────────────────────

/**
 * The plan runtime meta: the checklist. Persisted in plan artifact meta and
 * consumed by the steps store.
 */
export type PlanMeta = {
  steps: PlanStep[];
};

/** Parsed plan artifact meta (`artifacts.meta` for kind=plan) — extra keys are ignored. */
export const PlanArtifactMetaSchema = z.object({
  steps: z.array(PlanStep).default([]),
});

/** Safe-parse persisted plan artifact meta; corrupt or legacy shapes → null. */
export const parsePlanArtifactMeta = (raw: unknown): PlanMeta | null => {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = PlanArtifactMetaSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { steps: parsed.data.steps };
};

// ── the whole-plan response (JSON-only) ──────────────────────────────────────

/**
 * The ONE plan response schema (§F1): markdown + steps. Duplicate step ids are
 * schema refinements so they ride the same issues payload — and the same retry
 * feedback — as every other violation.
 */
export const PlanResponse = z
  .object({
    /** The plan in Markdown — rendered to the user as the plan document. */
    markdown: z.string().min(1),
    /** The ordered checklist of work. */
    steps: z.array(PlanStep).min(1),
  })
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    val.steps.forEach((s, i) => {
      const id = s.id?.trim() || `s${i + 1}`;
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['steps'], message: `duplicate step id "${id}"` });
      }
      seen.add(id);
    });
  });
export type PlanResponse = z.infer<typeof PlanResponse>;

// ── unified turn envelope (JSON-only) ─────────────────────────────────────────

/** Every plan-mode agent turn — reply plus at most one publish payload. */
export const PlanTurnOutput = z.object({
  reply: z.string().min(1),
  plan: PlanResponse.nullish(),
});
export type PlanTurnOutput = z.infer<typeof PlanTurnOutput>;

// ── the response contracts the output-contract directive advertises ──────────

/**
 * JSON Schemas generated from the response schemas — carried into
 * `AgentOutputError.directive()` on the run and retry prompts. The schema
 * refinements above (uniqueness) are enforced server-side; the advertised
 * schema is the structural contract only.
 */
export const PLAN_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(PlanResponse);
export const PLAN_TURN_OUTPUT_JSON_SCHEMA: unknown = z.toJSONSchema(PlanTurnOutput);

// ── input / output schemas ───────────────────────────────────────────────────

export const PlanInput = z.object({
  /** verbatim prompt override (bypasses the template) — recorded on turn runs for retry fidelity */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-editable body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  /** per-run model override */
  model: z.string().nullable().default(null),
  /** unified turn kind for recovery replay (`applyTurnResult`). */
  planTurnKind: z.enum(PlanTurnKind).nullable().default(null),
  /** user message for unified-turn recovery replay. */
  turnUserMessage: z.string().nullable().default(null),
  /** node status before a turn run started (reply-only recovery). */
  previousStatus: z.string().nullable().default(null),
  /**
   * Ids of the context blocks to assemble into {{context}} (see the block
   * registry in plan-node). Unknown ids are dropped server-side.
   */
  contextBlocks: z.array(z.string()).default([]),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const PlanOutput = z.object({
  latestArtifact: z.string(),
  version: z.number(),
  /** model id selected for the plan run — propagated to build */
  model: z.string().nullable().optional(),
  steps: z.array(PlanStep).optional(),
});
export type PlanOutput = z.infer<typeof PlanOutput>;
