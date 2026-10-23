import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { jiraClient } from "../../../lib/integrations/jira";
import { config } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const tickets = db.all<any>(`SELECT * FROM tickets ORDER BY synced_at DESC`).map((t) => ({
    ...t,
    issueType: t.issue_type ?? "",
    figmaUrls: JSON.parse(t.figma_urls ?? "[]"),
  }));
  return NextResponse.json({ tickets, jiraConfigured: config.jira.configured() });
}

/** Sync tickets from Jira into the local DB. */
export async function POST() {
  const remote = await jiraClient.fetchMyTickets();
  const ts = db.now();
  for (const t of remote) {
    const existing = db.get<any>(`SELECT id, repo_url FROM tickets WHERE key=?`, t.key);
    if (existing) {
      db.run(
        `UPDATE tickets SET summary=?,description=?,status=?,issue_type=?,priority=?,prd_text=?,figma_urls=?,jira_url=?,parent_key=?,raw=?,synced_at=? WHERE key=?`,
        t.summary, t.description, t.status, t.issueType, t.priority, t.prdText,
        JSON.stringify(t.figmaUrls), t.jiraUrl, t.parentKey || null, JSON.stringify(t.raw), ts, t.key
      );
    } else {
      db.run(
        `INSERT INTO tickets (id,key,summary,description,status,issue_type,priority,prd_text,figma_urls,repo_url,parent_key,jira_url,raw,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.id, t.key, t.summary, t.description, t.status, t.issueType, t.priority,
        t.prdText, JSON.stringify(t.figmaUrls), null, t.parentKey || null, t.jiraUrl, JSON.stringify(t.raw), ts
      );
    }
  }
  return NextResponse.json({ synced: remote.length });
}
