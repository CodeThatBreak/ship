import "server-only";

import { FLOW_STATUS } from "@/constants/flow";
import { RUN_MODE } from "@/constants/execution";
import { db, type Database } from "../db/app";

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
    // joins-as-separate-typed-queries: active flows, their tasks and each
    // flow's first running node (the correlated subselect's ORDER BY/LIMIT 1)
    const flows = await this.database.prisma.flow.findMany({
      where: { status: FLOW_STATUS.ACTIVE },
      orderBy: { updatedAt: "desc" },
      select: { id: true, taskId: true, executionMode: true, status: true, mrUrl: true, mrIid: true },
    });
    const tasks = await this.database.prisma.task.findMany({
      where: { id: { in: flows.map((f) => f.taskId) } },
      select: { id: true, key: true, summary: true },
    });
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const runningNodes = await this.database.prisma.node.findMany({
      where: { flowId: { in: flows.map((f) => f.id) }, status: FLOW_STATUS.RUNNING },
      orderBy: [{ createdAt: "asc" }, { nodeKey: "asc" }],
      select: { flowId: true, nodeKey: true },
    });
    const firstRunningNodeByFlow = new Map<string, string>();
    for (const n of runningNodes) {
      if (!firstRunningNodeByFlow.has(n.flowId)) firstRunningNodeByFlow.set(n.flowId, n.nodeKey);
    }

    const agents = flows.flatMap((f) => {
      const task = taskById.get(f.taskId);
      if (!task) return [];
      return [{
        flowId: f.id,
        taskKey: task.key,
        taskSummary: task.summary,
        runningNode: firstRunningNodeByFlow.get(f.id) ?? null,
        executionMode: f.executionMode,
        status: f.status,
        mrUrl: f.mrUrl,
        mrIid: f.mrIid,
      }];
    });

    const runsRunning = await this.database.prisma.run.count({ where: { status: FLOW_STATUS.RUNNING } });
    const repoCount = await this.database.prisma.repo.count();

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
        node: a.runningNode,
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

/** Shared system-status service (stateless, db-injected — decision Q9, plain module const). */
export const statusService = new StatusService(db);
