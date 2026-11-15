import "server-only";

import type { Database } from "@/lib/db/app";
import { db } from "@/lib/db/app";
import { processSingleton } from "@/lib/singleton";
import { Task, rows } from "@/lib/db/rows";
import type { TaskProviderRegistry } from "./registry";
import { taskRegistry } from "./registry";

export class TaskService {
  constructor(
    private readonly database: Database,
    private readonly registry: TaskProviderRegistry,
  ) {}

  list() {
    const tasks = rows.all(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks ORDER BY synced_at DESC`).map((t) => ({
      ...t,
      externalUrl: this.registry.maybe(t.type)?.externalUrl(t) ?? t.externalUrl ?? "",
    }));
    return {
      tasks,
      providers: Object.fromEntries(this.registry.list().map((p) => [p.kind, p.configured()])),
    };
  }

  updateRepoUrl(id: string, repoUrl: string): { ok: true; updated_at: string } {
    this.database.run(`UPDATE tasks SET repo_url=$1 WHERE id=$2`, repoUrl, id);
    return { ok: true, updated_at: this.database.now() };
  }
}

export const taskService = processSingleton(
  "taskService",
  () => new TaskService(db, taskRegistry),
);
