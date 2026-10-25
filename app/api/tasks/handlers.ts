import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { Task, rows } from "../../../lib/db/rows";
import { taskRegistry } from "../../../lib/engine/tasks/registry";

/**
 * Shared handlers for the tasks API — served at /api/tasks. Tasks are read
 * from the DB (materialized at build start) and resolved through the task
 * provider registry for external links.
 */

export function listTasks() {
  const tasks = rows.all(Task, `SELECT * FROM tasks ORDER BY synced_at DESC`).map((t) => ({
    ...t,
    // external deep link resolved by the task's provider (blank for rows whose
    // provider kind is unknown)
    externalUrl: taskRegistry.maybe(t.type)?.externalUrl(t) ?? t.externalUrl ?? "",
  }));
  return NextResponse.json({
    tasks,
    // per-provider configured status (the settings UI's connect state)
    providers: Object.fromEntries(taskRegistry.list().map((p) => [p.kind, p.configured()])),
  });
}

/** Update task fields we manage locally (e.g. repo mapping). */
export async function updateTask(req: Request, id: string) {
  const body = await req.json();
  if (body.repoUrl !== undefined) {
    db.run(`UPDATE tasks SET repo_url=? WHERE id=?`, body.repoUrl, id);
  }
  return NextResponse.json({ ok: true, updated_at: db.now() });
}
