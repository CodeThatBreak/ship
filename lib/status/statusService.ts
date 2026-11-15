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

  async snapshot(): Promise<StatusSnapshot> {
    const agents = await this.database.all<{
      flowId: string;
      taskKey: string;
      taskSummary: string;
      currentNode: string | null;
      executionMode: string | null;
      status: string;
      mrUrl: string | null;
      mrIid: number | null;
    }>(
      `SELECT f.id AS "flowId", t.key AS "taskKey", t.summary AS "taskSummary",
              f.current_node AS "currentNode", f.execution_mode AS "executionMode", f.status, f.mr_url AS "mrUrl", f.mr_iid AS "mrIid"
       FROM flows f JOIN tasks t ON t.id = f.task_id
       WHERE f.status = $1
       ORDER BY f.updated_at DESC`,
      FLOW_STATUS.ACTIVE,
    );

    const runsRunning =
      Number((await this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM runs WHERE status = $1`, FLOW_STATUS.RUNNING))
        ?.c ?? 0);
    const repoCount = Number((await this.database.get<{ c: number }>(`SELECT COUNT(*) AS c FROM repos`))?.c ?? 0);

    const openMrs = agents.flatMap((a) =>
      a.mrUrl
        ? [
            {
              flowId: a.flowId,
              taskKey: a.taskKey,
              summary: a.taskSummary,
              mrUrl: a.mrUrl,
              mrIid: a.mrIid,
            },
          ]
        : [],
    );

    return {
      agents: agents.map((a) => ({
        flowId: a.flowId,
        taskKey: a.taskKey,
        summary: a.taskSummary,
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
