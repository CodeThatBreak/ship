import "server-only";

import { FLOW_STATUS } from "@/constants/flow";
import { RUN_MODE } from "@/constants/execution";
import { db, type Database } from "../db/app";
import { processSingleton } from "../singleton";

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
              f.currentNode, f.executionMode AS "executionMode", f.status, f.mrUrl AS "mrUrl", f.mrIid AS "mrIid"
       FROM flows f JOIN tasks t ON t.id = f.taskId
       WHERE f.status = $1
       ORDER BY f.updatedAt DESC`,
      FLOW_STATUS.ACTIVE,
    );

    const runsRunning =
      this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs WHERE status = $1`, FLOW_STATUS.RUNNING)
        ?.c ?? 0;
    const repoCount = this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM repos`)?.c ?? 0;

    const openMrs = agents.flatMap((a) =>
      a.mrUrl
        ? [
            {
              flowId: a.flowId,
              taskKey: a.task_key,
              summary: a.task_summary,
              mrUrl: a.mrUrl,
              mrIid: a.mrIid,
            },
          ]
        : [],
    );

    return {
      agents: agents.map((a) => ({
        flowId: a.flowId,
        taskKey: a.task_key,
        summary: a.task_summary,
        node: a.currentNode,
        mode: a.executionMode ?? RUN_MODE.CLOUD,
        status: a.status,
        mrOpen: Boolean(a.mrUrl),
      })),
      agentsRunning: agents.length,
      runsRunning,
      openMrs,
      openMrCount: openMrs.length,
      repoCount,
    };
  }
}

export const statusService = processSingleton("statusService", () => new StatusService(db));
