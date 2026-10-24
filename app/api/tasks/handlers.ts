import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { jiraClient } from "../../../lib/integrations/jira";
import { config } from "../../../lib/config";

/**
 * Shared handlers for the tasks API — consumed by /api/tasks and the
 * deprecated /api/tickets shim (dropped in the Phase 4 cleanup).
 */

export function listTasks() {
  const tasks = db.all<any>(`SELECT * FROM tasks ORDER BY synced_at DESC`).map((t) => ({
    ...t,
    issueType: t.issue_type ?? "",
    figmaUrls: JSON.parse(t.figma_urls ?? "[]"),
  }));
  return NextResponse.json({ tasks, jiraConfigured: config.jira.configured() });
}

/** Sync tasks from Jira into the local DB. */
export async function syncTasks() {
  const remote = await jiraClient.fetchMyTickets();
  const ts = db.now();
  for (const t of remote) {
    const existing = db.get<any>(`SELECT id, repo_url FROM tasks WHERE key=?`, t.key);
    if (existing) {
      db.run(
        `UPDATE tasks SET summary=?,description=?,status=?,issue_type=?,priority=?,prd_text=?,figma_urls=?,jira_url=?,parent_key=?,raw=?,synced_at=? WHERE key=?`,
        t.summary, t.description, t.status, t.issueType, t.priority, t.prdText,
        JSON.stringify(t.figmaUrls), t.jiraUrl, t.parentKey || null, JSON.stringify(t.raw), ts, t.key
      );
    } else {
      db.run(
        `INSERT INTO tasks (id,key,summary,description,status,issue_type,priority,prd_text,figma_urls,repo_url,parent_key,jira_url,raw,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.id, t.key, t.summary, t.description, t.status, t.issueType, t.priority,
        t.prdText, JSON.stringify(t.figmaUrls), null, t.parentKey || null, t.jiraUrl, JSON.stringify(t.raw), ts
      );
    }
  }
  return NextResponse.json({ synced: remote.length });
}

/** Update task fields we manage locally (e.g. repo mapping). */
export async function updateTask(req: Request, id: string) {
  const body = await req.json();
  if (body.repoUrl !== undefined) {
    db.run(`UPDATE tasks SET repo_url=? WHERE id=?`, body.repoUrl, id);
  }
  return NextResponse.json({ ok: true, updated_at: db.now() });
}
