import "server-only";

import type { Database } from "@/lib/db/app";
import { Task, rows } from "@/lib/db/rows";
import type { TaskProviderRegistry } from "../registry/taskProviderRegistry";

export class TaskService {
  constructor(
    private readonly database: Database,
    private readonly registry: TaskProviderRegistry,
  ) {}

  async list() {
    const taskRows = await rows.all(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks ORDER BY synced_at DESC`);
    const tasks = await Promise.all(
      taskRows.map(async (t) => ({
        ...t,
        externalUrl: (await this.registry.maybe(t.type)?.externalUrl(t)) ?? t.externalUrl ?? "",
      })),
    );
    return {
      tasks,
      providers: Object.fromEntries(
        await Promise.all(this.registry.list().map(async (p) => [p.kind, await p.configured()] as const)),
      ),
    };
  }

  async updateRepoUrl(id: string, repoUrl: string): Promise<{ ok: true; updated_at: string }> {
    await this.database.run(`UPDATE tasks SET repo_url=$1 WHERE id=$2`, repoUrl, id);
    return { ok: true, updated_at: this.database.now() };
  }
}
