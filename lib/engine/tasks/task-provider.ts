import type { Task } from "../../db/rows";

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
