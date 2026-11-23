import 'server-only';

import { z } from 'zod';

/**
 * Zod validators for the DB row shapes — the JSONB boundary.
 *
 * Column types come from Prisma (`prisma/schema.prisma`) — this module no
 * longer re-declares them. What remains is boundary validation for JSONB
 * payloads (the typed shapes the engine writes into `nodes.input/output`,
 * `artifacts.meta`, event `data`, trigger payloads, …): every ORM read that
 * crosses a JSONB column narrows its payload through these schemas (via
 * `lib/db/ormRowHelpers.ts`). Status vocabularies live in
 * `lib/db/constants/rowStatuses.ts`.
 *
 * Naming (Q11): all row shapes are camelCase — Postgres stays snake_case via
 * Prisma `@map`s.
 */

import {
  ARTIFACT_STATUSES,
  BRANCH_STATUSES,
  COMMENT_STATUSES,
  FLOW_KINDS,
  FLOW_STATUSES,
  NODE_STATUSES,
  PLAN_STEP_STATUSES,
  RUN_STATUSES,
} from './constants/rowStatuses';

// ── helpers ──────────────────────────────────────────────────────────────────
/** ISO 8601 timestamp string (raw queries surface timestamptz as Date — callers alias and convert). */
const isoTs = z.union([z.string(), z.date().transform((d) => d.toISOString())]);
const isoTsNullable = isoTs.nullable();
/** A JSONB payload of shape S (Prisma returns parsed values — no JSON.parse). */
const jsonCol = <S extends z.ZodTypeAny>(schema: S) => schema.nullable();
/** JSONB that decodes to null when the payload is the wrong shape (feed-safe reads). */
const jsonColTolerant = <S extends z.ZodTypeAny>(schema: S) =>
  z
    .unknown()
    .nullable()
    .transform((v): z.infer<S> | null => {
      if (v == null) return null;
      const result = schema.safeParse(v);
      return result.success ? result.data : null;
    });

// ── tasks ────────────────────────────────────────────────────────────────────
export const TaskRow = z.object({
  id: z.string(),
  key: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  issueType: z.string().nullable(),
  priority: z.string().nullable(),
  repoUrl: z.string().nullable(),
  parentKey: z.string().nullable(),
  externalUrl: z.string().nullable(),
  raw: z.string().nullable(),
  syncedAt: isoTsNullable,
  /** task type discriminator (provider kind; the provider/engine always sets it) */
  type: z.string(),
  /** provider-specific payload (JSONB object; jira keeps prd + figmaUrls here) */
  fields: jsonCol(z.record(z.string(), z.unknown())),
});
export type TaskRow = z.infer<typeof TaskRow>;

/**
 * App-facing task shape (camelCase, parsed fields).
 *
 * Provider-only payload (PRD text, figma links) hydrates from `fields` — the
 * jira provider writes `fields.prd` / `fields.figmaUrls` (Q11: JSONB payload
 * keys are camelCase; the data migration camelCases the legacy figma_urls).
 */
export const Task = TaskRow.transform(t => ({
  id: t.id,
  key: t.key,
  summary: t.summary,
  description: t.description,
  status: t.status,
  issueType: t.issueType,
  priority: t.priority,
  prdText: typeof t.fields?.prd === 'string' ? (t.fields.prd as string) : '',
  figmaUrls: Array.isArray(t.fields?.figmaUrls) ? (t.fields.figmaUrls as string[]) : [],
  repoUrl: t.repoUrl,
  parentKey: t.parentKey,
  externalUrl: t.externalUrl,
  syncedAt: t.syncedAt,
  type: t.type,
  fields: t.fields ?? {},
}));
export type Task = z.infer<typeof Task>;

// ── flows ────────────────────────────────────────────────────────────────────
export const FlowRow = z.object({
  id: z.string(),
  taskId: z.string(),
  name: z.string(),
  status: z.enum(FLOW_STATUSES),
  mrUrl: z.string().nullable(),
  mrIid: z.number().nullable(),
  mrBranch: z.string().nullable(),
  repoUrl: z.string().nullable(),
  gitlabProjectId: z.number().nullable(),
  executionMode: z.string().nullable().default('cloud'),
  repoId: z.string().nullable(),
  /** flow template this flow instance snapshot came from */
  templateId: z.string().nullable(),
  /** webhook/schedule trigger payload that started the flow */
  triggerPayload: jsonCol(z.record(z.string(), z.unknown())),
  /** git worktree dir for local runs; null = runs in the registered checkout */
  worktreeDir: z.string().nullable(),
  /** how the flow instance was created */
  kind: z.enum(FLOW_KINDS).nullable().default('sdlc'),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type FlowRow = z.infer<typeof FlowRow>;

// ── nodes ────────────────────────────────────────────────────────────────────
export const NodeRow = z.object({
  id: z.string(),
  flowId: z.string(),
  nodeKey: z.string(),
  /** node template key (def key for built-ins) */
  type: z.string(),
  status: z.enum(NODE_STATUSES),
  /** Set when the node is claimed for a run; fences terminal writes and late agent results. */
  attemptId: z.string().nullable(),
  agentId: z.string().nullable(),
  /** runtime agent handle (cloud agent id / local session id) */
  agentRef: z.string().nullable(),
  sessionId: z.string().nullable(),
  /** display name override from the template instance */
  label: z.string().nullable(),
  /** effective config snapshot (class defaults ← app settings ← template ← flow), merged at creation */
  config: jsonCol(z.record(z.string(), z.unknown())),
  /** join semantics for incoming edges: all | any */
  joinMode: z.string().nullable(),
  input: jsonCol(z.record(z.string(), z.unknown())),
  output: jsonCol(z.record(z.string(), z.unknown())),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type NodeRow = z.infer<typeof NodeRow>;

// ── artifacts ────────────────────────────────────────────────────────────────
export const ArtifactRow = z.object({
  id: z.string(),
  nodeId: z.string(),
  flowId: z.string(),
  kind: z.string(),
  version: z.number(),
  content: z.string(),
  meta: jsonCol(z.record(z.string(), z.unknown())),
  status: z.enum(ARTIFACT_STATUSES),
  feedback: z.string().nullable(),
  createdAt: isoTs,
});
export type ArtifactRow = z.infer<typeof ArtifactRow>;

// ── comments ─────────────────────────────────────────────────────────────────
export const CommentRow = z.object({
  id: z.string(),
  flowId: z.string(),
  mrIid: z.number().nullable(),
  discussionId: z.string().nullable(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  filePath: z.string().nullable(),
  line: z.number().nullable(),
  status: z.enum(COMMENT_STATUSES),
  resolvedBy: z.string().nullable(),
  raw: z.string().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type CommentRow = z.infer<typeof CommentRow>;

// ── messages ─────────────────────────────────────────────────────────────────
export const MessageRow = z.object({
  id: z.string(),
  flowId: z.string(),
  nodeKey: z.string().nullable(),
  thread: z.string().nullable(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: isoTs,
});
export type MessageRow = z.infer<typeof MessageRow>;

// ── events ───────────────────────────────────────────────────────────────────
export const EventRow = z.object({
  id: z.string(),
  flowId: z.string(),
  nodeId: z.string().nullable(),
  type: z.string(),
  message: z.string().nullable(),
  data: jsonColTolerant(z.record(z.string(), z.unknown())),
  createdAt: isoTs,
});
export type EventRow = z.infer<typeof EventRow>;

// ── plan_steps ───────────────────────────────────────────────────────────────
export const PlanStepRow = z.object({
  id: z.string(),
  flowId: z.string(),
  artifactId: z.string().nullable(),
  metaId: z.string().nullable(),
  position: z.number(),
  title: z.string(),
  detail: z.string().nullable(),
  files: jsonCol(z.array(z.string())),
  branch: z.string().nullable(),
  status: z.enum(PLAN_STEP_STATUSES),
  origin: z.string(),
  /** completedBy: manual | build | merge | skipped | null */
  completedBy: z.string().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type PlanStepRow = z.infer<typeof PlanStepRow>;

// ── branches ─────────────────────────────────────────────────────────────────
export const BranchRow = z.object({
  id: z.string(),
  flowId: z.string(),
  name: z.string(),
  gitBranch: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(BRANCH_STATUSES),
  mrUrl: z.string().nullable(),
  mrIid: z.number().nullable(),
  order: z.number(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type BranchRow = z.infer<typeof BranchRow>;

// ── runs ─────────────────────────────────────────────────────────────────────
export const RunRow = z.object({
  id: z.string(),
  flowId: z.string(),
  nodeId: z.string(),
  /** runtime agent handle (cloud agent id / local session id) */
  agentRef: z.string(),
  /** the runtime's run id */
  runRef: z.string(),
  branchId: z.string().nullable(),
  status: z.enum(RUN_STATUSES),
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  durationMs: z.number().nullable(),
  costCents: z.number().nullable(),
  usage: jsonCol(z.record(z.string(), z.unknown())),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type RunRow = z.infer<typeof RunRow>;

// ── repos ────────────────────────────────────────────────────────────────────
export const RepoRow = z.object({
  id: z.string(),
  name: z.string(),
  cloudUrl: z.string(),
  localPath: z.string().nullable(),
  defaultBranch: z.string(),
  useWorktrees: z.boolean(),
  // worktree setup policy (Phase 2)
  installCommand: z.string().nullable(),
  skipInstall: z.boolean(),
  syncPaths: z.string().nullable(),
  sharedDirs: z.string().nullable(),
  setupCommand: z.string().nullable(),
  worktreeTimeoutMs: z.number().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type RepoRow = z.infer<typeof RepoRow>;
export type Repo = RepoRow;

// ── gitlab_instances ─────────────────────────────────────────────────────────
export const GitLabInstanceRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  baseUrl: z.string(),
  token: z.string(),
  createdAt: isoTs,
});
export type GitLabInstanceRow = z.infer<typeof GitLabInstanceRow>;
export type GitLabInstance = GitLabInstanceRow;

// ── jira_instances ───────────────────────────────────────────────────────────
export const JiraInstanceRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  baseUrl: z.string(),
  email: z.string(),
  token: z.string(),
  createdAt: isoTs,
});
export type JiraInstanceRow = z.infer<typeof JiraInstanceRow>;
export type JiraInstance = JiraInstanceRow;

// ── settings ─────────────────────────────────────────────────────────────────
export const SettingRow = z.object({
  key: z.string(),
  value: z.string(),
});
export type SettingRow = z.infer<typeof SettingRow>;

// ── worktree_removals ────────────────────────────────────────────────────────
export const WorktreeRemovalRow = z.object({
  id: z.string(),
  flowId: z.string().nullable(),
  repoPath: z.string().nullable(),
  path: z.string(),
  branch: z.string().nullable(),
  deleteBranch: z.boolean(),
  reason: z.string().nullable(),
  createdAt: isoTs,
});
export type WorktreeRemovalRow = z.infer<typeof WorktreeRemovalRow>;
export type WorktreeRemovalRecord = WorktreeRemovalRow;

// ── flow templates ───────────────────────────────────────────────────────────
export const NodeTemplateRow = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  kind: z.enum(['builtin', 'agent', 'http', 'script', 'decision']),
  version: z.number(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  /** declarative kinds: full definition; builtin: knob overrides */
  config: jsonCol(z.record(z.string(), z.unknown())),
  isBuiltin: z.boolean(),
  /** NULL = global Library row shared across templates; set = private to that template */
  templateId: z.string().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type NodeTemplateRow = z.infer<typeof NodeTemplateRow>;

export const FlowTemplateRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number(),
  isBuiltin: z.boolean(),
  /** flow trigger: { type: manual | webhook | schedule, ... } */
  trigger: jsonCol(z.record(z.string(), z.unknown())),
  /** next fire time for a `schedule` flow trigger; null = not scheduled */
  scheduleNextAt: isoTsNullable,
  /** auto-wrapped child templates (plan fan-out); excluded from the gallery */
  hidden: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type FlowTemplateRow = z.infer<typeof FlowTemplateRow>;

export interface TemplateNodeTrigger {
  /** auto | manual | approval | debounced */
  type: string;
  /** debounced quiet-period minutes */
  minutes?: number;
  /** event source the node waits on before it can run: pipeline | comments | webhook | timer */
  waitFor?: string;
}

export const FlowTemplateNodeRow = z.object({
  id: z.string(),
  templateId: z.string(),
  nodeKey: z.string(),
  nodeTemplateId: z.string(),
  label: z.string().nullable(),
  trigger: jsonCol(z.record(z.string(), z.unknown())),
  joinMode: z.string(),
  config: jsonCol(z.record(z.string(), z.unknown())),
  inputMap: jsonCol(z.record(z.string(), z.unknown())),
  x: z.number().nullable(),
  y: z.number().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type FlowTemplateNodeRow = z.infer<typeof FlowTemplateNodeRow>;

export const FlowTemplateEdgeRow = z.object({
  id: z.string(),
  templateId: z.string(),
  fromKey: z.string(),
  toKey: z.string(),
  kind: z.enum(['next', 'loop']),
  label: z.string().nullable(),
  condition: z.string().nullable(),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type FlowTemplateEdgeRow = z.infer<typeof FlowTemplateEdgeRow>;

export const HookRow = z.object({
  id: z.string(),
  templateId: z.string().nullable(),
  flowId: z.string().nullable(),
  nodeKey: z.string().nullable(),
  secret: z.string(),
  filter: z.string().nullable(),
  createdAt: isoTs,
});
export type HookRow = z.infer<typeof HookRow>;

/** Seen webhook-ids per hook (dedup; TTL'd by HookStore). */
export const HookDeliveryRow = z.object({
  hookId: z.string(),
  webhookId: z.string(),
  createdAt: isoTs,
});
export type HookDeliveryRow = z.infer<typeof HookDeliveryRow>;

