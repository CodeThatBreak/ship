import { NextResponse } from "next/server";
import { config } from "../../../lib/config";
import { db } from "../../../lib/db";
import { Task, rows } from "../../../lib/db/rows";
import { taskRegistry } from "../../../lib/engine/tasks/registry";

/**
 * Shared handlers for the tasks API — served at /api/tasks.
 *
 * Sync dispatches through the task provider registry: POST {kind:"jira"} →
 * taskRegistry.get("jira").sync(). Without a kind, the single/first
 * registered provider runs (the UI passes kind explicitly once several exist).
 */

export function listTasks() {
  const tasks = rows.all(Task, `SELECT * FROM tasks ORDER BY synced_at DESC`).map((t) => ({
    ...t,
    // external deep link resolved by the task's provider (falls back to the
    // stored jira_url for rows whose provider kind is unknown)
    externalUrl: taskRegistry.maybe(t.type)?.externalUrl(t) ?? t.jiraUrl ?? "",
  }));
  return NextResponse.json({ tasks, jiraConfigured: config.jira.configured() });
}

/** Sync tasks from a provider (body {kind}, default: the first provider). */
export async function syncTasks(req?: Request) {
  let kind: string | undefined;
  if (req) {
    const body = await req.json().catch(() => null);
    if (body && typeof body.kind === "string" && body.kind) kind = body.kind;
  }
  const provider = kind ? taskRegistry.maybe(kind) : taskRegistry.first();
  if (!provider) {
    return NextResponse.json(
      { error: kind ? `unknown task provider kind: ${kind}` : "no task providers registered" },
      { status: kind ? 404 : 500 }
    );
  }
  try {
    const ids = await provider.sync();
    const tasks = ids
      .map((id) => rows.get(Task, `SELECT * FROM tasks WHERE id=?`, id))
      .filter((t): t is Task => Boolean(t))
      .map((t) => ({ id: t.id, key: t.key, summary: t.summary }));
    return NextResponse.json({ synced: tasks.length, kind: provider.kind, tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

/** Update task fields we manage locally (e.g. repo mapping). */
export async function updateTask(req: Request, id: string) {
  const body = await req.json();
  if (body.repoUrl !== undefined) {
    db.run(`UPDATE tasks SET repo_url=? WHERE id=?`, body.repoUrl, id);
  }
  return NextResponse.json({ ok: true, updated_at: db.now() });
}
