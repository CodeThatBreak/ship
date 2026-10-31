import "server-only";

import type { Database } from "@/lib/db";
import { Task, rows } from "@/lib/db/rows";
import type { TaskProviderRegistry } from "./registry";

export class TaskService {
  constructor(
    private readonly database: Database,
    private readonly registry: TaskProviderRegistry,
  ) {}

  list() {
    const tasks = rows.all(Task, `SELECT * FROM tasks ORDER BY synced_at DESC`).map((t) => ({
      ...t,
      externalUrl: this.registry.maybe(t.type)?.externalUrl(t) ?? t.externalUrl ?? "",
    }));
    return {
      tasks,
      providers: Object.fromEntries(this.registry.list().map((p) => [p.kind, p.configured()])),
    };
  }

  updateRepoUrl(id: string, repoUrl: string): { ok: true; updated_at: string } {
    this.database.run(`UPDATE tasks SET repo_url=? WHERE id=?`, repoUrl, id);
    return { ok: true, updated_at: this.database.now() };
  }
}
