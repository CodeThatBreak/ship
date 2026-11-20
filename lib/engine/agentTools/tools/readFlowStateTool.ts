import "server-only";

import { db } from "../../../db/app";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { GATE_PROGRESS_ARTIFACT } from "../../nodes/kinds/pipeline/constants/waiting";
import { GateProgressSchema } from "../../nodes/kinds/pipeline/schema";
import type { AgentToolAuth, AgentToolExecutor } from "../types/tools";
import { AGENT_TOOL, AGENT_TOOL_DESCRIPTORS } from "../constants/agentTools";
import type { NodeStore } from "../../runtime/nodeStore";
import type { PlanStepStore } from "../../runtime/planStepStore/planStepStore";
import type { NodeSupport } from "../../nodes/shared/nodeSupport";

/**
 * `read_flow_state` (step 08, Invariant 10): the prompt-snapshot facts the
 * agent was frozen with — node statuses, open checklist steps, open
 * comments, pipeline state — queryable live at T+5min. Assembled from the
 * SAME read models the UI/cockpit consumes; no new query shapes.
 */
export class ReadFlowStateTool implements AgentToolExecutor {
  readonly name = AGENT_TOOL.READ_FLOW_STATE;
  readonly description = AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.READ_FLOW_STATE].description;

  constructor(
    private readonly nodeStore: NodeStore,
    private readonly planSteps: PlanStepStore,
    private readonly support: NodeSupport,
  ) {}

  async execute(auth: AgentToolAuth): Promise<unknown> {
    const [nodes, steps, comments] = await Promise.all([
      this.nodeStatuses(auth.flowId),
      this.openSteps(auth.flowId),
      this.support.openComments(auth.flowId),
    ]);
    return {
      nodes,
      openSteps: steps,
      openComments: comments.map((c) => ({
        id: c.id,
        mrIid: c.mrIid,
        author: c.author,
        body: c.body,
        filePath: c.filePath,
        line: c.line,
        status: c.status,
      })),
      pipeline: await this.pipelineState(auth.flowId),
    };
  }

  /** Node key + status pairs — the cockpit's node-state read (NodeStore). */
  private async nodeStatuses(flowId: string): Promise<{ key: string; status: string }[]> {
    const rows = await db.prisma.node.findMany({
      where: { flowId },
      select: { nodeKey: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((n) => ({ key: n.nodeKey, status: n.status }));
  }

  /** Open checklist steps — the same "not done" filter `finalizeBuild` gates on. */
  private async openSteps(flowId: string) {
    return (await this.planSteps.list(flowId))
      .filter((s) => s.status !== "done")
      .map((s) => ({ id: s.metaId ?? s.id, rowId: s.id, title: s.title, detail: s.detail, branch: s.branch, status: s.status }));
  }

  /** The pipeline gate's live state: the node's published output plus the
   *  durable wait ledger (the `gate_progress` artifact meta, step 05). */
  private async pipelineState(flowId: string) {
    const rows = await db.prisma.node.findMany({
      where: { flowId, type: NODE_KEYS.PIPELINE, status: { not: NODE_STATUS.PENDING } },
      select: { nodeKey: true, status: true, output: true },
    });
    if (rows.length === 0) return [];
    const art = await this.support.latestArtifact(flowId, GATE_PROGRESS_ARTIFACT, { nodeType: NODE_KEYS.PIPELINE });
    const gate = art ? GateProgressSchema.safeParse(art.meta) : null;
    return rows.map((row) => ({
      nodeKey: row.nodeKey,
      status: row.status,
      output: (row.output ?? null) as Record<string, unknown> | null,
      gateProgress: gate?.success ? gate.data : null,
    }));
  }
}
