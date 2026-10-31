import "server-only";

import { z } from "zod";
import type { Database } from "./database";

/**
 * Zod schemas for every DB row + typed query helpers.
 *
 * Rows cross the DB boundary exactly once — here — so every consumer gets a
 * validated, fully-typed object instead of `any` + ad-hoc JSON.parse calls.
 * JSON-encoded columns (fields, input, output, meta, files, data, trigger, …)
 * are decoded to their real types by the schema. Opaque provider blobs (`raw`)
 * stay as TEXT strings.
 */

import { RowDecodeError, rowIdFromRaw } from "./row-decode-error";
import { getRowGateway } from "./row-gateway-access";

// ── helpers ──────────────────────────────────────────────────────────────────
/** A TEXT column holding a JSON value of shape S. */
const jsonCol = <S extends z.ZodTypeAny>(schema: S) =>
  z
    .string()
    .nullable()
    .transform((s, ctx): z.infer<S> | null => {
      if (s == null) return null;
      try {
        return schema.parse(JSON.parse(s));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid JSON column" });
        return z.NEVER;
      }
    });

/** JSON column that decodes to null when the cell is corrupt or the wrong shape (feed-safe reads). */
const jsonColTolerant = <S extends z.ZodTypeAny>(schema: S) =>
  z
    .string()
    .nullable()
    .transform((s): z.infer<S> | null => {
      if (s == null) return null;
      try {
        const parsed = JSON.parse(s);
        const result = schema.safeParse(parsed);
        return result.success ? result.data : null;
      } catch {
        return null;
      }
    });

// ── tasks ────────────────────────────────────────────────────────────────────
export const TaskRow = z.object({
  id: z.string(),
  key: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  issue_type: z.string().nullable(),
  priority: z.string().nullable(),
  repo_url: z.string().nullable(),
  parent_key: z.string().nullable(),
  external_url: z.string().nullable(),
  raw: z.string().nullable(),
  synced_at: z.string().nullable(),
  /** task type discriminator (provider kind; the provider/engine always sets it) */
  type: z.string(),
  /** provider-specific payload (JSON object; jira keeps prd + figma_urls here) */
  fields: jsonCol(z.record(z.string(), z.unknown())),
});
export type TaskRow = z.infer<typeof TaskRow>;

/**
 * App-facing task shape (camelCase, parsed fields).
 *
 * Provider-only payload (PRD text, figma links) hydrates from `fields` — the
 * jira provider writes `fields.prd` / `fields.figma_urls` (Phase 2+); the
 * Phase-4 data-fix migration copied the same values across from the retired
 * shared columns for rows synced before that.
 */
export const Task = TaskRow.transform((t) => ({
  id: t.id,
  key: t.key,
  summary: t.summary,
  description: t.description,
  status: t.status,
  issueType: t.issue_type,
  priority: t.priority,
  prdText: typeof t.fields?.prd === "string" ? (t.fields.prd as string) : "",
  figmaUrls: Array.isArray(t.fields?.figma_urls) ? (t.fields.figma_urls as string[]) : [],
  repoUrl: t.repo_url,
  parentKey: t.parent_key,
  externalUrl: t.external_url,
  syncedAt: t.synced_at,
  type: t.type,
  fields: t.fields ?? {},
}));
export type Task = z.infer<typeof Task>;

// ── flows ────────────────────────────────────────────────────────────────────
export const FLOW_STATUSES = ["active", "done", "failed"] as const;
export type FlowRowStatus = (typeof FLOW_STATUSES)[number];

export const FLOW_KINDS = ["sdlc", "step", "split"] as const;
export type FlowKindRow = (typeof FLOW_KINDS)[number];

export const FlowRow = z.object({
  id: z.string(),
  task_id: z.string(),
  name: z.string(),
  status: z.enum(FLOW_STATUSES),
  mr_url: z.string().nullable(),
  mr_iid: z.number().nullable(),
  mr_branch: z.string().nullable(),
  repo_url: z.string().nullable(),
  gitlab_project_id: z.number().nullable(),
  current_node: z.string().nullable(),
  execution_mode: z.string().nullable().default("cloud"),
  repo_id: z.string().nullable(),
  /** flow template this flow instance snapshot came from (Phase 1) */
  template_id: z.string().nullable(),
  /** webhook/schedule trigger payload that started the flow (Phase 4) */
  trigger_payload: jsonCol(z.record(z.string(), z.unknown())),
  /** git worktree dir for local runs (Phase 1 worktrees); null = runs in the registered checkout */
  worktree_dir: z.string().nullable(),
  /** step sub-flows (plan fan-out): set on child flows — the parent's flow id */
  parent_flow_id: z.string().nullable(),
  /** sdlc | step (plan fan-out child) | split */
  kind: z.enum(FLOW_KINDS).nullable().default("sdlc"),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FlowRow = z.infer<typeof FlowRow>;

// ── nodes ────────────────────────────────────────────────────────────────────
export const NODE_STATUSES = [
  "pending",
  /** eligible but a `wait_for` event is still pending (Phase 1: reserved) */
  "waiting",
  "running",
  "awaiting_approval",
  "approved",
  "done",
  "failed",
  /** on a non-taken branch (Phase 3: decision/edge conditions) */
  "skipped",
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const ARTIFACT_STATUSES = ["draft", "approved", "superseded"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const COMMENT_STATUSES = ["open", "resolving", "resolved", "wontfix"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const PLAN_STEP_STATUSES = ["pending", "done"] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const BRANCH_STATUSES = [
  "pending",
  "building",
  "awaiting_approval",
  "approved",
  "failed",
  "done",
] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const RUN_STATUSES = ["running", "finished", "error", "cancelled"] as const;
export type RunRowStatus = (typeof RUN_STATUSES)[number];

export const STEP_MERGE_STATUSES = ["running", "conflict", "rejected", "merged", "failed"] as const;
export type StepMergeStatus = (typeof STEP_MERGE_STATUSES)[number];

export const NodeRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  node_key: z.string(),
  /** node template key (def key for built-ins; Phase 2 adds declarative kinds) */
  type: z.string(),
  status: z.enum(NODE_STATUSES),
  /** Set when the node is claimed for a run; fences terminal writes and late agent results. */
  attempt_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  /** runtime agent handle (cloud agent id / local session id) */
  agent_ref: z.string().nullable(),
  session_id: z.string().nullable(),
  prompt_override: z.string().nullable(),
  /** display name override from the template instance */
  label: z.string().nullable(),
  /** effective config snapshot (class defaults ← app settings ← template ← flow), merged at creation */
  config: jsonCol(z.record(z.string(), z.unknown())),
  /** join semantics for incoming edges: all | any */
  join_mode: z.string().nullable(),
  input: jsonCol(z.record(z.string(), z.unknown())),
  output: jsonCol(z.record(z.string(), z.unknown())),
  created_at: z.string(),
  updated_at: z.string(),
});
export type NodeRow = z.infer<typeof NodeRow>;

// ── artifacts ────────────────────────────────────────────────────────────────
export const ArtifactRow = z.object({
  id: z.string(),
  node_id: z.string(),
  flow_id: z.string(),
  kind: z.string(),
  version: z.number(),
  content: z.string(),
  meta: jsonCol(z.record(z.string(), z.unknown())),
  status: z.enum(ARTIFACT_STATUSES),
  feedback: z.string().nullable(),
  created_at: z.string(),
});
export type ArtifactRow = z.infer<typeof ArtifactRow>;

// ── comments ─────────────────────────────────────────────────────────────────
export const CommentRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  mr_iid: z.number().nullable(),
  discussion_id: z.string().nullable(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  file_path: z.string().nullable(),
  line: z.number().nullable(),
  status: z.enum(COMMENT_STATUSES),
  resolved_by: z.string().nullable(),
  raw: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CommentRow = z.infer<typeof CommentRow>;

// ── messages ─────────────────────────────────────────────────────────────────
export const MessageRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  node_key: z.string().nullable(),
  thread: z.string().nullable(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});
export type MessageRow = z.infer<typeof MessageRow>;

// ── events ───────────────────────────────────────────────────────────────────
export const EventRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  node_id: z.string().nullable(),
  type: z.string(),
  message: z.string().nullable(),
  data: jsonColTolerant(z.record(z.string(), z.unknown())),
  created_at: z.string(),
});
export type EventRow = z.infer<typeof EventRow>;

// ── plan_steps ───────────────────────────────────────────────────────────────
export const PlanStepRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  artifact_id: z.string().nullable(),
  meta_id: z.string().nullable(),
  position: z.number(),
  title: z.string(),
  detail: z.string().nullable(),
  files: jsonCol(z.array(z.string())),
  branch: z.string().nullable(),
  status: z.enum(PLAN_STEP_STATUSES),
  origin: z.string(),
  /** completed_by: manual | build | merge | skipped | null */
  completed_by: z.string().nullable(),
  /** step ⇄ sub-flow linkage (plan fan-out): the child flow building this step */
  sub_flow_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PlanStepRow = z.infer<typeof PlanStepRow>;

// ── branches ─────────────────────────────────────────────────────────────────
export const BranchRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  name: z.string(),
  git_branch: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(BRANCH_STATUSES),
  mr_url: z.string().nullable(),
  mr_iid: z.number().nullable(),
  order: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BranchRow = z.infer<typeof BranchRow>;

// ── runs ─────────────────────────────────────────────────────────────────────
export const RunRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  node_id: z.string(),
  /** runtime agent handle (cloud agent id / local session id) */
  agent_ref: z.string(),
  /** the runtime's run id */
  run_ref: z.string(),
  status: z.enum(RUN_STATUSES),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  cache_read_tokens: z.number().nullable(),
  cache_write_tokens: z.number().nullable(),
  duration_ms: z.number().nullable(),
  cost_cents: z.number().nullable(),
  usage: jsonCol(z.record(z.string(), z.unknown())),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RunRow = z.infer<typeof RunRow>;

// ── repos ────────────────────────────────────────────────────────────────────
export const RepoRow = z.object({
  id: z.string(),
  name: z.string(),
  cloud_url: z.string(),
  local_path: z.string().nullable(),
  default_branch: z.string(),
  // worktree setup policy (Phase 2)
  install_command: z.string().nullable(),
  skip_install: z.number().int(),
  sync_paths: z.string().nullable(),
  shared_dirs: z.string().nullable(),
  setup_command: z.string().nullable(),
  worktree_timeout_ms: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RepoRow = z.infer<typeof RepoRow>;
export type Repo = RepoRow;

// ── gitlab_instances ─────────────────────────────────────────────────────────
export const GitLabInstanceRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  base_url: z.string(),
  token: z.string(),
  created_at: z.string(),
});
export type GitLabInstanceRow = z.infer<typeof GitLabInstanceRow>;
export type GitLabInstance = GitLabInstanceRow;

// ── jira_instances ───────────────────────────────────────────────────────────
export const JiraInstanceRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  base_url: z.string(),
  email: z.string(),
  token: z.string(),
  created_at: z.string(),
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
  flow_id: z.string().nullable(),
  repo_path: z.string().nullable(),
  path: z.string(),
  branch: z.string().nullable(),
  delete_branch: z.number().int(),
  reason: z.string().nullable(),
  created_at: z.string(),
});
export type WorktreeRemovalRow = z.infer<typeof WorktreeRemovalRow>;
export type WorktreeRemovalRecord = WorktreeRemovalRow;

// ── flow templates (Phase 1: template layer) ─────────────────────────────────
export const NodeTemplateRow = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  kind: z.enum(["builtin", "agent", "http", "script", "decision"]),
  version: z.number(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  /** declarative kinds: full definition; builtin: knob overrides */
  config: jsonCol(z.record(z.string(), z.unknown())),
  is_builtin: z.number(),
  /** NULL = global Library row shared across templates; set = private to that template */
  template_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type NodeTemplateRow = z.infer<typeof NodeTemplateRow>;

export const FlowTemplateRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number(),
  is_builtin: z.number(),
  /** flow trigger: { type: manual | webhook | schedule, ... } */
  trigger: jsonCol(z.record(z.string(), z.unknown())),
  /** next fire time for a `schedule` flow trigger (Phase 4C); null = not scheduled */
  schedule_next_at: z.string().nullable(),
  /** auto-wrapped child templates (plan fan-out); excluded from the gallery */
  hidden: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FlowTemplateRow = z.infer<typeof FlowTemplateRow>;

export interface TemplateNodeTrigger {
  /** auto | manual | approval | debounced */
  type: string;
  /** debounced quiet-period minutes */
  minutes?: number;
  /** event source the node waits on before it can run: pipeline | comments | webhook | timer */
  wait_for?: string;
}

export const FlowTemplateNodeRow = z.object({
  id: z.string(),
  template_id: z.string(),
  node_key: z.string(),
  node_template_id: z.string(),
  label: z.string().nullable(),
  trigger: jsonCol(z.record(z.string(), z.unknown())),
  join_mode: z.string(),
  config: jsonCol(z.record(z.string(), z.unknown())),
  input_map: jsonCol(z.record(z.string(), z.unknown())),
  x: z.number().nullable(),
  y: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FlowTemplateNodeRow = z.infer<typeof FlowTemplateNodeRow>;

export const FlowTemplateEdgeRow = z.object({
  id: z.string(),
  template_id: z.string(),
  from_key: z.string(),
  to_key: z.string(),
  kind: z.enum(["next", "loop"]),
  label: z.string().nullable(),
  condition: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FlowTemplateEdgeRow = z.infer<typeof FlowTemplateEdgeRow>;

export const HookRow = z.object({
  id: z.string(),
  template_id: z.string().nullable(),
  flow_id: z.string().nullable(),
  node_key: z.string().nullable(),
  secret: z.string(),
  filter: z.string().nullable(),
  created_at: z.string(),
});
export type HookRow = z.infer<typeof HookRow>;

/** Seen webhook-ids per hook (Phase 4A dedup; TTL'd by HookStore). */
export const HookDeliveryRow = z.object({
  hook_id: z.string(),
  webhook_id: z.string(),
  created_at: z.string(),
});
export type HookDeliveryRow = z.infer<typeof HookDeliveryRow>;

// ── step_merges (plan fan-out, Phase 1) ──────────────────────────────────────
// Durable merge-back record per code child (a def with a `mergeBack` hook):
// written BEFORE the git merge runs, updated after, so restarts/reconcile can
// resume or flag. NULL `branch` ⇒ non-code children create no rows.
export const StepMergeRow = z.object({
  id: z.string(),
  flow_id: z.string(),
  parent_flow_id: z.string(),
  parent_node: z.string(),
  branch: z.string().nullable(),
  status: z.enum(STEP_MERGE_STATUSES),
  attempts: z.number(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type StepMergeRow = z.infer<typeof StepMergeRow>;

// ── typed query helpers ──────────────────────────────────────────────────────
/**
 * Schema-validated access to DB rows. Like `db.get`/`db.all`, but each
 * returned row is parsed through the given schema. Unknown columns are
 * stripped (zod default) — SELECT * is fine.
 */
export class RowGateway {
  constructor(private readonly database: Database) {}

  private parseRow<S extends z.ZodTypeAny>(
    schema: S,
    raw: unknown,
    sql: string,
    mode: "get" | "all",
  ): z.infer<S> | undefined {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    const rowId = rowIdFromRaw(raw);
    if (mode === "get") {
      throw new RowDecodeError(sql, rowId, result.error);
    }
    console.error("[rows] skipping undecodable row", {
      sql,
      rowId,
      issues: result.error.issues,
    });
    return undefined;
  }

  get<S extends z.ZodTypeAny>(
    schema: S,
    sql: string,
    ...args: unknown[]
  ): z.infer<S> | undefined {
    const row = this.database.get<unknown>(sql, ...(args as never[]));
    if (row == null) return undefined;
    return this.parseRow(schema, row, sql, "get");
  }

  all<S extends z.ZodTypeAny>(
    schema: S,
    sql: string,
    ...args: unknown[]
  ): z.infer<S>[] {
    const decoded: z.infer<S>[] = [];
    for (const raw of this.database.all<unknown>(sql, ...(args as never[]))) {
      const row = this.parseRow(schema, raw, sql, "all");
      if (row !== undefined) decoded.push(row);
    }
    return decoded;
  }
}

/** Backward-compatible accessor — prefer `import { rows } from "@/lib/db"`. */
export const rows: RowGateway = new Proxy({} as RowGateway, {
  get(_target, prop: keyof RowGateway) {
    const gateway = getRowGateway();
    const value = gateway[prop];
    return typeof value === "function"
      ? (value as (...args: never[]) => unknown).bind(gateway)
      : value;
  },
});
