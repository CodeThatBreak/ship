import "server-only";

import type { Task } from "../../db/rows";
import type {
  LiveTask,
  LiveTaskFilters,
  TaskField,
  TaskInstanceStore,
} from "./types/taskProvider";

/**
 * A task type — the integration that acquires tasks (Jira, Linear, …).
 *
 * Mirrors `NodeDefinition` (lib/engine/nodes/shared/node-definition.ts): the
 * class owns everything specific to the task type — fetching, normalizing,
 * the upsert-into-`tasks` materialization, and the external deep link. The
 * tasks API and the settings UI only know the registry.
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
   * Runtime fetch — the source of truth for the tasks table. Reads straight
   * from the provider's API (never the DB, never stored). Results are cached
   * by the /api/tasks/live route.
   */
  abstract liveFetch(filters?: LiveTaskFilters): Promise<LiveTask[]>;

  /**
   * Write one live task into the `tasks` table (idempotent on `key`). Only
   * called when a build starts — the engine needs a row to attach the flow to.
   */
  abstract upsertLive(task: LiveTask): Promise<string>;

  /** Where to view this task externally (UI deep link). */
  abstract externalUrl(task: Task): Promise<string>;

  /**
   * Whether the provider's credentials/config are present — drives the
   * connect state in the settings UI. Default true (no config needed).
   */
  configured(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Instance admin surface for the settings UI (Integrations → Task), or
   * null when the provider has no instance registry. Providers that manage
   * credentials override this and implement `TaskInstanceStore`.
   */
  instanceStore(): TaskInstanceStore | null {
    return null;
  }
}
