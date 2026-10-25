import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Workspace status snapshot for the IDE-style footer: running agents (active
 * flows + live cursor runs), open MRs, and repo count. Cheap local queries
 * only — polled by the footer every few seconds.
 */
export async function GET() {
  const agents = db.all<{
    flow_id: string;
    task_key: string;
    task_summary: string;
    current_node: string | null;
    execution_mode: string | null;
    status: string;
    mr_url: string | null;
    mr_iid: number | null;
  }>(
    `SELECT f.id AS flow_id, t.key AS task_key, t.summary AS task_summary,
            f.current_node, f.execution_mode, f.status, f.mr_url, f.mr_iid
     FROM flows f JOIN tasks t ON t.id = f.task_id
     WHERE f.status = 'active'
     ORDER BY f.updated_at DESC`,
  );

  const [runsRunning, repos] = await Promise.all([
    db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs WHERE status = 'running'`),
    db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM repos`),
  ]);

  const openMrs = agents
    .filter((a) => a.mr_url)
    .map((a) => ({
      flowId: a.flow_id,
      taskKey: a.task_key,
      summary: a.task_summary,
      mrUrl: a.mr_url!,
      mrIid: a.mr_iid,
    }));

  return NextResponse.json({
    agents: agents.map((a) => ({
      flowId: a.flow_id,
      taskKey: a.task_key,
      summary: a.task_summary,
      node: a.current_node,
      mode: a.execution_mode ?? "cloud",
      status: a.status,
      mrOpen: Boolean(a.mr_url),
    })),
    agentsRunning: agents.length,
    runsRunning: runsRunning?.c ?? 0,
    openMrs,
    openMrCount: openMrs.length,
    repoCount: repos?.c ?? 0,
  });
}
