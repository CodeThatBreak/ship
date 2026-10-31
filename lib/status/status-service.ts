import "server-only";

import { FLOW_STATUS } from "@/constants/flow";
import { RUN_MODE } from "@/constants/execution";
import type { Database } from "../db";

export type StatusSnapshot = {
  agents: {
    flowId: string;
    taskKey: string;
    summary: string;
    node: string | null;
    mode: string;
    status: string;
    mrOpen: boolean;
  }[];
  agentsRunning: number;
  runsRunning: number;
  openMrs: {
    flowId: string;
    taskKey: string;
    summary: string;
    mrUrl: string;
    mrIid: number | null;
  }[];
  openMrCount: number;
  repoCount: number;
};

export class StatusService {
  constructor(private readonly database: Database) {}

  snapshot(): StatusSnapshot {
    const agents = this.database.all<{
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
       WHERE f.status = ?
       ORDER BY f.updated_at DESC`,
      FLOW_STATUS.ACTIVE,
    );

    const runsRunning =
      this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs WHERE status = ?`, FLOW_STATUS.RUNNING)
        ?.c ?? 0;
    const repoCount = this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM repos`)?.c ?? 0;

    const openMrs = agents.flatMap((a) =>
      a.mr_url
        ? [
            {
              flowId: a.flow_id,
              taskKey: a.task_key,
              summary: a.task_summary,
              mrUrl: a.mr_url,
              mrIid: a.mr_iid,
            },
          ]
        : [],
    );

    return {
      agents: agents.map((a) => ({
        flowId: a.flow_id,
        taskKey: a.task_key,
        summary: a.task_summary,
        node: a.current_node,
        mode: a.execution_mode ?? RUN_MODE.CLOUD,
        status: a.status,
        mrOpen: Boolean(a.mr_url),
      })),
      agentsRunning: agents.length,
      runsRunning,
      openMrs,
      openMrCount: openMrs.length,
      repoCount,
    };
  }
}
