import type { Task } from "../../db/rows";

/**
 * A task fetched live from the provider's source — never stored as-is. The
 * tasks table shows these at runtime (filter → refetch); a row is only
 * materialized in the DB (`upsertLive`) when a build actually starts, since
 * the flow engine needs the row for FK + context hydration.
 */
export interface LiveTask {
  /** provider kind discriminator (tasks.type when materialized) */
  type: string;
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  externalUrl: string;
  /** parent issue key (sub-task nesting) */
  parentKey: string;
  /** provider-specific payload — jira keeps `prd` and `figma_urls` here */
  fields: Record<string, unknown>;
  /** raw provider payload, kept for faithful re-materialization */
  raw: unknown;
}

/**
 * Structured task filters for the tasks table's predefined filter bar.
 * Omitted/empty values are ignored; a provider composes these into its own
 * query language (jira → JQL). With no filters set, the provider falls back
 * to its configured default query.
 */
export interface LiveTaskFilters {
  /** "me" (default) = current user; "any" = everyone */
  assignee?: "me" | "any";
  /** workflow-agnostic status bucket: "To Do" | "In Progress" | "Done" */
  statusCategory?: string;
  /** free-text search across the task */
  text?: string;
}

/**
 * One field a task type contributes to the `{{task.*}}` variable universe.
 *
 * Mirrors the start-contract field style (`nodes/start/contract.ts`): `key` is
 * the template-facing name, `type` is the JSON type the value evaluates to.
 * The list a provider declares becomes the lint vocabulary for `{{task.*}}`
 * refs (Phase 3 context-lint).
 */
export interface TaskField {
  /** exposed as {{task.<key>}} */
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  /** providers that always produce this field mark it required */
  required?: boolean;
}

/**
 * A task type — the integration that acquires tasks (Jira, Linear, …).
 *
 * Mirrors `NodeDefinition` (lib/engine/nodes/base/node-definition.ts): the
 * class owns everything specific to the task type — fetching, normalizing,
 * the upsert-into-`tasks` sync, and the external deep link. The sync route
 * (POST /api/tasks) and the import screen only know the registry.
 *
 * Storage contract (locked decision in docs/tasks-plan.md): common columns
 * (`key`, `summary`, `description`, `status`, `priority`, `issue_type`,
 * `repo_url`, `parent_key`, `raw`, `synced_at`) are the shared contract every
 * provider fills; provider-specific extras go into the `fields` JSON column,
 * keyed by the provider's own names (jira writes `fields.prd`,
 * `fields.figma_urls`).
 */
export abstract class TaskProvider {
  /** stable kind, e.g. "jira" — the `tasks.type` discriminator value */
  abstract readonly kind: string;
  /** UI label, e.g. "Jira" */
  abstract readonly label: string;
  /** What this task type contributes to the {{task.*}} universe. */
  abstract readonly contextFields: TaskField[];

  /**
   * Pull-based sync: fetch from the external source and upsert task rows
   * (idempotent on `key`, `type` = this kind). Returns the upserted task ids.
   */
  abstract sync(): Promise<string[]>;

  /**
   * Runtime fetch — the source of truth for the tasks table. Reads straight
   * from the provider's API (never the DB, never stored). Results are cached
   * by the /api/tasks/live route.
   */
  abstract liveFetch(filters?: LiveTaskFilters): Promise<LiveTask[]>;

  /**
   * Write one live task into the `tasks` table (idempotent on `key`). Only
   * called when a build starts — the engine needs a row to attach the flow to.
   */
  abstract upsertLive(task: LiveTask): string;

  /** Where to view this task externally (UI deep link). */
  abstract externalUrl(task: Task): string;

  /**
   * Whether the provider's credentials/config are present — drives the
   * "Connect" state on the import screen. Default true (no config needed).
   */
  configured(): boolean {
    return true;
  }
}
