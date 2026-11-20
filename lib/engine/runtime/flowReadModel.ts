import "server-only";

import { db } from "../../db/app";
import {
  ArtifactRow,
  BranchRow,
  FlowRow,
  HookRow,
  NodeRow,
  PlanStepRow,
  RunRow,
  Task,
} from "../../db/rows";
import type { Artifact, FlowData, Node as FlowNode } from "@/types/flow";
import { declarativeDef } from "../nodes/declarative";
import { nodeRegistry } from "../nodes/registry";
import { uiCapabilities } from "../nodes/shared/capabilities";
import { hookStore, maskHookSecret } from "./hookStore";
import { templateStore } from "../templates/templateStore";
import { stepFlows, StepFlowManager } from "./fanout/stepFlowManager";
import { accumulateRunRow, emptyRunTokenBucket } from "../utils/runTokenRollup";
import type { FlowReadScheduleHost } from "./flowEngineHost";

type NodeTemplateRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  icon: string | null;
  isBuiltin: boolean;
};

const ARTIFACT_LIST_COLUMNS =
  `id, node_id AS "nodeId", flow_id AS "flowId", kind, version, '' AS content, meta, status, feedback, created_at AS "createdAt"`;

const buildNodeTemplateIndex = (ntRows: NodeTemplateRow[]) => {
  const byId = new Map<string, NodeTemplateRow>();
  const byBuiltinKey = new Map<string, NodeTemplateRow>();
  for (const r of ntRows) {
    byId.set(r.id, r);
    if (r.isBuiltin) byBuiltinKey.set(r.key, r);
  }
  return (type: string) => byId.get(type) ?? byBuiltinKey.get(type) ?? null;
};

const toFlowTask = (task: Task): FlowData["task"] => ({
  key: task.key,
  summary: task.summary,
  status: task.status ?? "",
  issueType: task.issueType ?? "",
  priority: task.priority ?? "",
  prdText: task.prdText,
  figmaUrls: task.figmaUrls,
  externalUrl: task.externalUrl ?? "",
});

const toFlowArtifact = (art: ArtifactRow): Artifact => ({
  id: art.id,
  kind: art.kind,
  version: art.version,
  status: art.status,
  created_at: art.createdAt,
  feedback: art.feedback ?? undefined,
  meta: art.meta ?? undefined,
});

/** Flow list/detail read model — batched SQL, artifact bodies lazy-loaded via GET /api/artifacts/:id. */
export class FlowReadModel {
  constructor(private readonly schedule: FlowReadScheduleHost) {}

  async get(id: string): Promise<FlowData | null> {
    const flow = await db.rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, id);
    if (!flow) return null;
    const task = await db.rows.get(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks WHERE id=$1`, flow.taskId);
    if (!task) return null;

    const runs = await db.rows.all(RunRow,
      `SELECT id, flow_id AS "flowId", node_id AS "nodeId", agent_ref AS "agentRef", run_ref AS "runRef", branch_id AS "branchId", status, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens", cache_read_tokens AS "cacheReadTokens", cache_write_tokens AS "cacheWriteTokens", duration_ms AS "durationMs", cost_cents AS "costCents", usage, created_at AS "createdAt", updated_at AS "updatedAt" FROM runs WHERE flow_id=$1 ORDER BY created_at, id`, id);
    const nodeCosts = new Map<string, ReturnType<typeof emptyRunTokenBucket>>();
    for (const r of runs) {
      const c = nodeCosts.get(r.nodeId) ?? emptyRunTokenBucket();
      accumulateRunRow(c, r);
      nodeCosts.set(r.nodeId, c);
    }
    const flowCost = {
      totalCents: [...nodeCosts.values()].reduce((s, c) => s + c.totalCents, 0),
      tokens: [...nodeCosts.values()].reduce((s, c) => s + c.tokens, 0),
      runCount: runs.length,
    };

    const stepRunStats = new Map<string, { costCents: number; tokens: number; durationMs: number; runCount: number }>();
    const branches = await db.rows.all(BranchRow, `SELECT id, flow_id AS "flowId", name, git_branch AS "gitBranch", title, status, mr_url AS "mrUrl", mr_iid AS "mrIid", "order", created_at AS "createdAt", updated_at AS "updatedAt" FROM branches WHERE flow_id=$1 ORDER BY "order", created_at`, id);
    const mergeStateMap = await stepFlows.mergeStates(id);
    const steps = (await db.rows.all(PlanStepRow, `SELECT id, flow_id AS "flowId", artifact_id AS "artifactId", meta_id AS "metaId", position, title, detail, files, branch, status, origin, completed_by AS "completedBy", sub_flow_id AS "subFlowId", created_at AS "createdAt", updated_at AS "updatedAt" FROM plan_steps WHERE flow_id=$1 ORDER BY position, created_at`, id))
      .map((s) => ({ ...s, files: s.files ?? [] }));

    /** rows.ts rows are camelCase; the UI read model keeps its snake_case shape. */
    const toUiStep = (s: (typeof steps)[number]) => ({
      id: s.id,
      flow_id: s.flowId,
      artifact_id: s.artifactId,
      meta_id: s.metaId,
      position: s.position,
      title: s.title,
      detail: s.detail,
      files: s.files,
      branch: s.branch,
      status: s.status,
      origin: s.origin,
      completed_by: s.completedBy,
      sub_flow_id: s.subFlowId,
    });

    const childFlowIds = steps.map((s) => s.subFlowId).filter((v): v is string => Boolean(v));
    const childFlowById = new Map<string, FlowRow>();
    const childNodesByFlowId = new Map<string, NodeRow[]>();
    if (childFlowIds.length) {
      const placeholders = childFlowIds.map((_, i) => `$${i + 1}`).join(",");
      for (const child of await db.rows.all(FlowRow,
        `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id IN (${placeholders})`, ...childFlowIds)) {
        childFlowById.set(child.id, child);
      }
      for (const node of await db.rows.all(NodeRow,
        `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id IN (${placeholders}) ORDER BY created_at`, ...childFlowIds)) {
        const list = childNodesByFlowId.get(node.flowId);
        if (list) list.push(node);
        else childNodesByFlowId.set(node.flowId, [node]);
      }
      const childRuns = await db.rows.all(RunRow,
        `SELECT id, flow_id AS "flowId", node_id AS "nodeId", agent_ref AS "agentRef", run_ref AS "runRef", branch_id AS "branchId", status, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens", cache_read_tokens AS "cacheReadTokens", cache_write_tokens AS "cacheWriteTokens", duration_ms AS "durationMs", cost_cents AS "costCents", usage, created_at AS "createdAt", updated_at AS "updatedAt" FROM runs WHERE flow_id IN (${placeholders}) ORDER BY created_at, id`, ...childFlowIds);
      for (const r of childRuns) {
        const c = stepRunStats.get(r.flowId) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 };
        if (r.costCents != null) c.costCents += r.costCents;
        if (r.durationMs != null) c.durationMs += r.durationMs;
        const bucket = emptyRunTokenBucket();
        accumulateRunRow(bucket, r);
        c.tokens += bucket.tokens;
        c.runCount++;
        stepRunStats.set(r.flowId, c);
      }
      for (const c of stepRunStats.values()) {
        flowCost.totalCents += c.costCents;
        flowCost.tokens += c.tokens;
        flowCost.runCount += c.runCount;
      }
    }

    const stepsEnriched = steps.map((s) => {
      const base = toUiStep(s);
      if (!s.subFlowId) return base;
      const child = childFlowById.get(s.subFlowId);
      if (!child) return base;
      const childNodes = childNodesByFlowId.get(s.subFlowId) ?? [];
      let parentNodeKey: string | null = null;
      const p = child.triggerPayload ?? {};
      parentNodeKey = typeof p.parentNodeKey === "string" ? p.parentNodeKey : null;
      const ms = mergeStateMap[s.subFlowId] ?? null;
      return {
        ...base,
        sub_flow: {
          id: child.id,
          name: child.name,
          status: child.status,
          branch: child.mrBranch,
          nodeStatus: StepFlowManager.childRollup(childNodes.map((n) => n.status), child.status),
          nodeKey: childNodes[0]?.nodeKey ?? null,
          parentNodeKey,
          ...(stepRunStats.get(s.subFlowId) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 }),
          mergeStatus: ms?.mergeStatus ?? null,
          mergeAttempts: ms?.mergeAttempts ?? 0,
          mergeError: ms?.mergeError ?? null,
          staleBase: ms?.staleBase ?? false,
        },
      };
    });

    const order = (await templateStore.graphForFlow(id))?.nodes.map((n) => n.key) ?? nodeRegistry.order();
    const ntRows = await db.prisma.nodeTemplate.findMany({
      select: { id: true, key: true, name: true, kind: true, icon: true, isBuiltin: true },
    });
    const ntOf = buildNodeTemplateIndex(ntRows as NodeTemplateRow[]);

    const nodeRows = (await db.rows.all(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1`, id))
      .sort((a, b) => order.indexOf(a.nodeKey) - order.indexOf(b.nodeKey));

    const artifactsByNodeId = new Map<string, ArtifactRow[]>();
    if (nodeRows.length) {
      const nodeIds = nodeRows.map((n) => n.id);
      const artPlaceholders = nodeIds.map((_, i) => `$${i + 1}`).join(",");
      const allArtifacts = await db.rows.all(ArtifactRow,
        `SELECT ${ARTIFACT_LIST_COLUMNS} FROM artifacts WHERE node_id IN (${artPlaceholders}) ORDER BY kind, version`,
        ...nodeIds);
      for (const art of allArtifacts) {
        const list = artifactsByNodeId.get(art.nodeId);
        if (list) list.push(art);
        else artifactsByNodeId.set(art.nodeId, [art]);
      }
    }

    return {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      mr_url: flow.mrUrl ?? undefined,
      mr_iid: flow.mrIid ?? undefined,
      mr_branch: flow.mrBranch ?? undefined,
      repo_url: flow.repoUrl ?? undefined,
      execution_mode: flow.executionMode ?? undefined,
      cost: flowCost,
      branches: branches.map((b) => ({
        id: b.id,
        flow_id: b.flowId,
        name: b.name,
        title: b.title ?? undefined,
        status: b.status,
        mr_url: b.mrUrl ?? undefined,
        mr_iid: b.mrIid ?? undefined,
        order: b.order,
      })),
      planSteps: stepsEnriched,
      resolveScheduleAt: await this.schedule.resolveScheduleAt(id),
      task: toFlowTask(task),
      hooks: (await hookStore.hooksForFlow(id)).flatMap((h: HookRow) =>
        h.flowId == null
          ? []
          : [{ id: h.id, flow_id: h.flowId, node_key: h.nodeKey, secret: maskHookSecret(h.secret), filter: h.filter }],
      ),
      nodes: await Promise.all(nodeRows.map(async (n): Promise<FlowNode> => {
        const nt = ntOf(n.type);
        const def = nodeRegistry.maybe(n.type)
          ?? (nt?.isBuiltin ? nodeRegistry.maybe(nt.key) : undefined)
          ?? await declarativeDef(n.type, n.nodeKey);
        const cost = nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] };
        return {
          id: n.id,
          node_key: n.nodeKey,
          type: n.type,
          status: n.status,
          agent_id: n.agentId,
          label: n.label,
          template_name: nt?.name ?? null,
          kind: nt?.kind ?? null,
          icon: nt?.icon ?? null,
          config: n.config,
          capabilities: uiCapabilities(def?.capabilities),
          join_mode: n.joinMode,
          input: n.input,
          output: n.output,
          artifacts: (artifactsByNodeId.get(n.id) ?? []).map(toFlowArtifact),
          cost,
        };
      })),
    };
  }

  async list() {
    const flows = await db.prisma.flow.findMany({
      where: { kind: { not: "step" }, parentFlowId: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
        mrBranch: true, repoUrl: true, gitlabProjectId: true,
        executionMode: true, repoId: true, templateId: true, templateGraph: true,
        triggerPayload: true, worktreeDir: true, parentFlowId: true, kind: true,
        createdAt: true, updatedAt: true,
        task: { select: { key: true, summary: true } },
      },
    });
    const fanoutByFlow = new Map<string, { steps: number; done: number }>();
    for (const r of await db.prisma.planStep.groupBy({
      by: ["flowId"],
      where: { subFlowId: { not: null } },
      _count: { _all: true },
    })) {
      // done counts need a filtered count — compute per flow
      const done = await db.prisma.planStep.count({ where: { flowId: r.flowId, subFlowId: { not: null }, status: "done" } });
      fanoutByFlow.set(r.flowId, { steps: r._count._all, done });
    }
    if (fanoutByFlow.size) {
      for (const f of flows) {
        const fo = fanoutByFlow.get(f.id);
        if (fo) (f as Record<string, unknown>).fanout = { ...fo, active: fo.done < fo.steps };
      }
    }
    return flows;
  }
}
