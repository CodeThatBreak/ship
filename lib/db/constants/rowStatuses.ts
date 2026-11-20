import "server-only";

/**
 * Status vocabularies mirroring the PG enums in `prisma/schema.prisma`.
 * Each closed set is the single source of truth for its column: the zod row
 * schemas (`lib/db/rows.ts`) validate against it and engine call sites use
 * the named constants, never raw literals (AGENTS §2.7).
 */

export const FLOW_STATUSES = ['active', 'done', 'failed', 'skipped'] as const;
export type FlowRowStatus = (typeof FLOW_STATUSES)[number];

export const FLOW_KINDS = ['sdlc', 'step', 'split'] as const;
export type FlowKindRow = (typeof FLOW_KINDS)[number];

export const NODE_STATUSES = [
  'pending',
  'waiting',
  'running',
  'awaiting_approval',
  'approved',
  'done',
  'failed',
  'skipped',
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const ARTIFACT_STATUSES = ['draft', 'approved', 'superseded'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const COMMENT_STATUSES = ['open', 'resolving', 'resolved', 'wontfix'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const PLAN_STEP_STATUSES = ['pending', 'done'] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const BRANCH_STATUSES = ['pending', 'building', 'awaiting_approval', 'approved', 'failed', 'done'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const RUN_STATUSES = ['running', 'finished', 'error', 'cancelled'] as const;
export type RunRowStatus = (typeof RUN_STATUSES)[number];

export const STEP_MERGE_STATUSES = ['running', 'conflict', 'rejected', 'merged', 'failed'] as const;
export type StepMergeStatus = (typeof STEP_MERGE_STATUSES)[number];
