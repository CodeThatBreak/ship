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
  rows,
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
  is_builtin: number;
};

const ARTIFACT_LIST_COLUMNS =
  `id, node_id, flow_id, kind, version, '' AS content, meta, status, feedback, created_at`;

const buildNodeTemplateIndex = (ntRows: NodeTemplateRow[]) => {
  const byId = new Map<string, NodeTemplateRow>();
  const byBuiltinKey = new Map<string, NodeTemplateRow>();
  for (const r of ntRows) {
    byId.set(r.id, r);
    if (r.is_builtin) byBuiltinKey.set(r.key, r);
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
  created_at: art.created_at,
  feedback: art.feedback ?? undefined,
  meta: art.meta ?? undefined,
});

/** Flow list/detail read model — batched SQL, artifact bodies lazy-loaded via GET /api/artifacts/:id. */
export class FlowReadModel {
  constructor(private readonly schedule: FlowReadScheduleHost) {}

  get(id: string): FlowData | null {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return null;
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) return null;

    const runs = rows.all(RunRow,
      `SELECT * FROM runs WHERE flow_id=? ORDER BY created_at, id`, id);
    const nodeCosts = new Map<string, ReturnType<typeof emptyRunTokenBucket>>();
    for (const r of runs) {
      const c = nodeCosts.get(r.node_id) ?? emptyRunTokenBucket();
      accumulateRunRow(c, r);
      nodeCosts.set(r.node_id, c);
    }
    const flowCost = {
      totalCents: [...nodeCosts.values()].reduce((s, c) => s + c.totalCents, 0),
      tokens: [...nodeCosts.values()].reduce((s, c) => s + c.tokens, 0),
      runCount: runs.length,
    };

    const stepRunStats = new Map<string, { costCents: number; tokens: number; durationMs: number; runCount: number }>();
    const branches = rows.all(BranchRow, `SELECT * FROM branches WHERE flow_id=? ORDER BY "order", created_at`, id);
    const mergeStateMap = stepFlows.mergeStates(id);
    const steps = rows.all(PlanStepRow, `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`, id)
      .map((s) => ({ ...s, files: s.files ?? [] }));

    const childFlowIds = steps.map((s) => s.sub_flow_id).filter((v): v is string => Boolean(v));
    const childFlowById = new Map<string, FlowRow>();
    const childNodesByFlowId = new Map<string, NodeRow[]>();
    if (childFlowIds.length) {
      const placeholders = childFlowIds.map(() => "?").join(",");
      for (const child of rows.all(FlowRow,
        `SELECT * FROM flows WHERE id IN (${placeholders})`, ...childFlowIds)) {
        childFlowById.set(child.id, child);
      }
      for (const node of rows.all(NodeRow,
        `SELECT * FROM nodes WHERE flow_id IN (${placeholders}) ORDER BY created_at`, ...childFlowIds)) {
        const list = childNodesByFlowId.get(node.flow_id);
        if (list) list.push(node);
        else childNodesByFlowId.set(node.flow_id, [node]);
      }
      const childRuns = rows.all(RunRow,
        `SELECT * FROM runs WHERE flow_id IN (${placeholders}) ORDER BY created_at, id`, ...childFlowIds);
      for (const r of childRuns) {
        const c = stepRunStats.get(r.flow_id) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 };
        if (r.cost_cents != null) c.costCents += r.cost_cents;
        if (r.duration_ms != null) c.durationMs += r.duration_ms;
        const bucket = emptyRunTokenBucket();
        accumulateRunRow(bucket, r);
        c.tokens += bucket.tokens;
        c.runCount++;
        stepRunStats.set(r.flow_id, c);
      }
      for (const c of stepRunStats.values()) {
        flowCost.totalCents += c.costCents;
        flowCost.tokens += c.tokens;
        flowCost.runCount += c.runCount;
      }
    }

    const stepsEnriched = steps.map((s) => {
      if (!s.sub_flow_id) return s;
      const child = childFlowById.get(s.sub_flow_id);
      if (!child) return s;
      const childNodes = childNodesByFlowId.get(s.sub_flow_id) ?? [];
      let parentNodeKey: string | null = null;
      const p = child.trigger_payload ?? {};
      parentNodeKey = typeof p.parentNodeKey === "string" ? p.parentNodeKey : null;
      const ms = mergeStateMap[s.sub_flow_id] ?? null;
      return {
        ...s,
        sub_flow: {
          id: child.id,
          name: child.name,
          status: child.status,
          branch: child.mr_branch,
          nodeStatus: StepFlowManager.childRollup(childNodes.map((n) => n.status), child.status),
          nodeKey: childNodes[0]?.node_key ?? null,
          parentNodeKey,
          ...(stepRunStats.get(s.sub_flow_id) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 }),
          mergeStatus: ms?.mergeStatus ?? null,
          mergeAttempts: ms?.mergeAttempts ?? 0,
          mergeError: ms?.mergeError ?? null,
          staleBase: ms?.staleBase ?? false,
        },
      };
    });

    const order = templateStore.graphForFlow(id)?.nodes.map((n) => n.key) ?? nodeRegistry.order();
    const ntRows = db.all<NodeTemplateRow>(
      `SELECT id, key, name, kind, icon, is_builtin FROM node_templates`,
    );
    const ntOf = buildNodeTemplateIndex(ntRows);

    const nodeRows = rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, id)
      .sort((a, b) => order.indexOf(a.node_key) - order.indexOf(b.node_key));

    const artifactsByNodeId = new Map<string, ArtifactRow[]>();
    if (nodeRows.length) {
      const nodeIds = nodeRows.map((n) => n.id);
      const artPlaceholders = nodeIds.map(() => "?").join(",");
      const allArtifacts = rows.all(ArtifactRow,
        `SELECT ${ARTIFACT_LIST_COLUMNS} FROM artifacts WHERE node_id IN (${artPlaceholders}) ORDER BY kind, version`,
        ...nodeIds);
      for (const art of allArtifacts) {
        const list = artifactsByNodeId.get(art.node_id);
        if (list) list.push(art);
        else artifactsByNodeId.set(art.node_id, [art]);
      }
    }

    return {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      current_node: flow.current_node ?? undefined,
      mr_url: flow.mr_url ?? undefined,
      mr_iid: flow.mr_iid ?? undefined,
      mr_branch: flow.mr_branch ?? undefined,
      repo_url: flow.repo_url ?? undefined,
      execution_mode: flow.execution_mode ?? undefined,
      cost: flowCost,
      branches: branches.map((b) => ({
        id: b.id,
        flow_id: b.flow_id,
        name: b.name,
        title: b.title ?? undefined,
        status: b.status,
        mr_url: b.mr_url ?? undefined,
        mr_iid: b.mr_iid ?? undefined,
        order: b.order,
      })),
      planSteps: stepsEnriched,
      resolveScheduleAt: this.schedule.resolveScheduleAt(id),
      task: toFlowTask(task),
      hooks: hookStore.hooksForFlow(id).flatMap((h: HookRow) =>
        h.flow_id == null
          ? []
          : [{ id: h.id, flow_id: h.flow_id, node_key: h.node_key, secret: maskHookSecret(h.secret), filter: h.filter }],
      ),
      nodes: nodeRows.map((n): FlowNode => {
        const nt = ntOf(n.type);
        const def = nodeRegistry.maybe(n.type)
          ?? (nt?.is_builtin ? nodeRegistry.maybe(nt.key) : undefined)
          ?? declarativeDef(n.type, n.node_key);
        const cost = nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] };
        return {
          id: n.id,
          node_key: n.node_key,
          type: n.type,
          status: n.status,
          agent_id: n.agent_id,
          label: n.label,
          template_name: nt?.name ?? null,
          kind: nt?.kind ?? null,
          icon: nt?.icon ?? null,
          config: n.config,
          capabilities: uiCapabilities(def?.capabilities),
          join_mode: n.join_mode,
          input: n.input,
          output: n.output,
          artifacts: (artifactsByNodeId.get(n.id) ?? []).map(toFlowArtifact),
          cost,
        };
      }),
    };
  }

  list() {
    const flows = db.all<Record<string, unknown>>(`
      SELECT f.*, t.key AS task_key, t.summary AS task_summary
      FROM flows f JOIN tasks t ON t.id=f.task_id
      WHERE (f.kind IS NULL OR f.kind <> 'step') AND f.parent_flow_id IS NULL
      ORDER BY f.updated_at DESC`);
    const fanoutByFlow = new Map<string, { steps: number; done: number }>();
    for (const r of db.all<{ flow_id: string; steps: number; done: number }>(`
      SELECT ps.flow_id,
        COUNT(*) AS steps,
        SUM(CASE WHEN ps.status='done' THEN 1 ELSE 0 END) AS done
      FROM plan_steps ps
      WHERE ps.sub_flow_id IS NOT NULL
      GROUP BY ps.flow_id`)) {
      fanoutByFlow.set(r.flow_id, { steps: r.steps, done: r.done });
    }
    if (fanoutByFlow.size) {
      for (const f of flows) {
        const fo = fanoutByFlow.get(f.id as string);
        if (fo) f.fanout = { ...fo, active: fo.done < fo.steps };
      }
    }
    return flows;
  }
}
