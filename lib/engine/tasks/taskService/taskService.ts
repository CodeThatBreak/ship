import "server-only";

import type { Database } from "@/lib/db/app";
import { Task } from "@/lib/db/rows";
import { parseRows } from "@/lib/db/ormRowHelpers";
import type { TaskProviderRegistry } from "../registry/taskProviderRegistry";

/** Task service (§1): the task list read model (rows joined with each provider's live `externalUrl`) and the repo-url update. Provider lookups go through the injected registry; the single write is the repo-url column — nothing else mutates task rows here. */
export class TaskService {
  constructor(
    private readonly database: Database,
    private readonly registry: TaskProviderRegistry,
  ) {}

  async list() {
    const taskRows = parseRows(
      Task,
      await this.database.prisma.task.findMany({
        // Postgres `ORDER BY synced_at DESC` defaults to NULLS FIRST — pinned
        // explicitly so Prisma's null ordering can't drift from the raw path
        orderBy: { syncedAt: { sort: "desc", nulls: "first" } },
      }),
      "tasks list",
    );
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
    // `updateMany` keeps the raw UPDATE's semantics: an unknown id is a silent
    // no-op (the route answers ok regardless) — `update` would throw P2025.
    await this.database.prisma.task.updateMany({ where: { id }, data: { repoUrl } });
    return { ok: true, updated_at: this.database.now() };
  }
}
