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
import type { FlowData, Node as FlowNode } from "@/types/flow";
import { declarativeDef } from "../nodes/declarative";
import { nodeRegistry } from "../nodes/registry";
import { uiCapabilities } from "../nodes/shared/capabilities";
import type { ChainRole, FlowCtx } from "../nodes/shared/nodeSharedExports";
import { appLayerConfig, mergeConfigLayers, parseConfigSnapshot } from "../templates/nodeConfig";
import { hookStore } from "./hookStore";
import { maskHookSecret } from "./hookStore/utils/maskHookSecret";
import { ArtifactListRow, buildNodeTemplateIndex, parseRow, parseRows, toFlowArtifact, toFlowTask } from "./flowReadModel/utils/ormRows";
import { templateStore, type TemplateGraph } from "../templates/templateStore";
import { NotFoundError } from "../../errors";
import { stepFlows } from "./fanout/stepFlowManager";
import { StepFlowManager } from "./fanout/stepFlowManager/stepFlowManager";
import { accumulateRunRow, emptyRunTokenBucket } from "../utils/runTokenRollup";
import type { WaitStore } from "./waits/waitStore";

/** Flow list/detail read model — batched ORM reads, artifact bodies lazy-loaded via GET /api/artifacts/:id. */
export class FlowReadModel {
  constructor(private readonly schedule: WaitStore) {}

  async get(id: string): Promise<FlowData | null> {
    const flow = parseRow(FlowRow, await db.prisma.flow.findUnique({ where: { id } }));
    if (!flow) return null;
    const task = parseRow(Task, await db.prisma.task.findUnique({ where: { id: flow.taskId } }));
    if (!task) return null;

    const runs = parseRows(
      RunRow,
      await db.prisma.run.findMany({
        where: { flowId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
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
    const branches = parseRows(
      BranchRow,
      await db.prisma.branch.findMany({
        where: { flowId: id },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
    );
    const mergeStateMap = await stepFlows.mergeStates(id);
    const steps = parseRows(
      PlanStepRow,
      await db.prisma.planStep.findMany({
        where: { flowId: id },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ).map((s) => ({ ...s, files: s.files ?? [] }));

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
      for (const child of parseRows(
        FlowRow,
        await db.prisma.flow.findMany({ where: { id: { in: childFlowIds } } }),
      )) {
        childFlowById.set(child.id, child);
      }
      for (const node of parseRows(
        NodeRow,
        await db.prisma.node.findMany({
          where: { flowId: { in: childFlowIds } },
          orderBy: { createdAt: "asc" },
        }),
      )) {
        const list = childNodesByFlowId.get(node.flowId);
        if (list) list.push(node);
        else childNodesByFlowId.set(node.flowId, [node]);
      }
      const childRuns = parseRows(
        RunRow,
        await db.prisma.run.findMany({
          where: { flowId: { in: childFlowIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      );
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
    const ntOf = buildNodeTemplateIndex(ntRows);

    const nodeRows = parseRows(
      NodeRow,
      await db.prisma.node.findMany({ where: { flowId: id } }),
    ).sort((a, b) => order.indexOf(a.nodeKey) - order.indexOf(b.nodeKey));

    const artifactsByNodeId = new Map<string, ArtifactRow[]>();
    if (nodeRows.length) {
      const nodeIds = nodeRows.map((n) => n.id);
      const allArtifacts = parseRows(
        ArtifactListRow,
        await db.prisma.artifact.findMany({
          where: { nodeId: { in: nodeIds } },
          orderBy: [{ kind: "asc" }, { version: "asc" }],
        }),
      ).map((a): ArtifactRow => ({ ...a, content: "" }));
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

  // ── engine lookups (step 07 facade collapse) ──────────────────────────────
  // The read-side lookups the orchestrator surfaces and the runtime host
  // interfaces consume — moved here so the FlowEngine facade stays
  // composition + delegation (target-architecture §12).

  /** The flow's resolved template graph (null when the flow runs the builtin template). */
  async graph(flowId: string): Promise<TemplateGraph | null> {
    return templateStore.graphForFlow(flowId);
  }

  /** The flow context one run/trigger evaluates against (flow + task + repo). */
  async ctx(flowId: string): Promise<FlowCtx> {
    const flow = parseRow(FlowRow, await db.prisma.flow.findUnique({ where: { id: flowId } }));
    if (!flow) throw new NotFoundError('flow', flowId);
    const task = parseRow(Task, await db.prisma.task.findUnique({ where: { id: flow.taskId } }));
    if (!task) throw new NotFoundError('task', flow.taskId);
    const repo = flow.repoId ? (await db.repoById(flow.repoId) ?? null) : null;
    return { flow, task, repo };
  }

  /** Instance keys of a def key in the flow (graph first, node-table fallback). */
  async keysOfType(flowId: string, defKey: string): Promise<string[]> {
    const g = await this.graph(flowId);
    if (g) return g.nodes.filter(n => n.defKey === defKey).map(n => n.key);
    const nodeRows = parseRows(
      NodeRow,
      await db.prisma.node.findMany({ where: { flowId } }),
    );
    return nodeRows.filter(n => n.type === defKey).map(n => n.nodeKey);
  }

  /** Instance keys → first instance of a def key. */
  async firstKeyOfType(flowId: string, defKey: string): Promise<string | null> {
    return (await this.keysOfType(flowId, defKey))[0] ?? null;
  }

  /** The catalog def holding a chain role (plan/build/review/resolve), or undefined. */
  private roleDef(role: ChainRole) {
    return nodeRegistry.all().find(d => d.chainRole === role);
  }

  /** The instance key of the flow's node holding a chain role — the
   *  metadata-routed lookup the SDLC chain module and panel entries consume. */
  async keyOfRole(flowId: string, role: ChainRole): Promise<string | null> {
    const def = this.roleDef(role);
    return def ? this.firstKeyOfType(flowId, def.key) : null;
  }

  /** Artifact kinds a chain role's def publishes as first-class engine
   *  resources (§T3/F3) — resource queries scope through this, not a literal kind. */
  private resourceKinds(role: ChainRole): readonly string[] {
    return this.roleDef(role)?.resourceArtifacts ?? [];
  }

  /**
   * The latest artifact version a chain role's def published as a first-class
   * resource (§T3/F3) — e.g. the plan document the plan editor and the
   * approval flow consume. Also on the StepFlowManager's engine surface
   * (publishedExecution reads the plan version through it). The ORM read
   * returns the full row and every caller picks its fields.
   */
  async latestResourceArtifact<T>(flowId: string, role: ChainRole): Promise<T | undefined> {
    const kinds = this.resourceKinds(role);
    if (!kinds.length) return undefined;
    const artifact = await db.prisma.artifact.findFirst({
      where: { node: { flowId }, kind: { in: [...kinds] } },
      orderBy: { version: "desc" },
    });
    const parsed = artifact ? parseRow(ArtifactRow, artifact) : undefined;
    return parsed as unknown as T | undefined;
  }

  /** Role lookups: the CI gate node (waits on the wait-source def's event
   *  source — the pipeline kind declares `waitForKind`, §T3/F1). */
  async gateKey(flowId: string): Promise<string | null> {
    const source = nodeRegistry.all().find(d => d.waitForKind);
    if (!source?.waitForKind) return null;
    return (await templateStore.waitNodeKey(flowId, source.waitForKind)) ?? (await this.firstKeyOfType(flowId, source.key));
  }

  /** def key of a node instance (for def resolution). */
  async defKeyOf(flowId: string, nodeKey: string): Promise<string> {
    const g = await this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    if (spec) return spec.defKey;
    const node = parseRow(
      NodeRow,
      await db.prisma.node.findUnique({ where: { flowId_nodeKey: { flowId, nodeKey } } }),
    );
    return node?.type ?? nodeKey;
  }

  /** The node instance's own config snapshot (nodes.config JSONB; legacy
   *  string-encoded rows still parse). */
  async flowNodeConfig(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    const raw = (await db.prisma.node.findUnique({
      where: { flowId_nodeKey: { flowId, nodeKey } },
      select: { config: true },
    }))?.config;
    if (raw == null) return {};
    if (typeof raw === 'string') return parseConfigSnapshot(raw);
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot. */
  async nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    const def = await nodeRegistry.resolve(await this.defKeyOf(flowId, nodeKey), nodeKey);
    const appKey = await this.defKeyOf(flowId, nodeKey);
    return mergeConfigLayers(def.defaultConfig(), await appLayerConfig(appKey), await this.flowNodeConfig(flowId, nodeKey));
  }
}
