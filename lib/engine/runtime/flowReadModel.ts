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
import { parseRowTolerant, parseRows } from "@/lib/db/ormRowHelpers";
import { ArtifactListRow, buildNodeTemplateIndex, toFlowArtifact, toFlowTask } from "./flowReadModel/utils/ormRows";
import { sumUsageArtifacts } from "./flowReadModel/utils/usageRollup";
import { templateStore, type TemplateGraph } from "../templates/templateStore";
import { NotFoundError } from "../../errors";
import { accumulateRunRow, emptyRunTokenBucket } from "../utils/runTokenRollup";
import { ARTIFACT_KIND } from "../constants/vocabulary";
import type { WaitStore } from "./waits/waitStore";

/** Flow list/detail read model — batched ORM reads, artifact bodies lazy-loaded via GET /api/artifacts/:id. */
export class FlowReadModel {
  constructor(private readonly schedule: WaitStore) {}

  async get(id: string): Promise<FlowData | null> {
    const flow = parseRowTolerant(FlowRow, await db.prisma.flow.findUnique({ where: { id } }));
    if (!flow) return null;
    const task = parseRowTolerant(Task, await db.prisma.task.findUnique({ where: { id: flow.taskId } }));
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

    // Task 21 (use case 8d): the flow's `usage` artifacts rolled up across
    // runs — every stored version is one run's usage, so the sum is the
    // flow's true token/cost spend, queryable per model
    const usage = sumUsageArtifacts(
      (await db.prisma.artifact.findMany({
        where: { node: { flowId: id }, kind: ARTIFACT_KIND.USAGE },
        select: { content: true },
      })).map((r) => r.content),
    );

    const branches = parseRows(
      BranchRow,
      await db.prisma.branch.findMany({
        where: { flowId: id },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
    );
    const steps = parseRows(
      PlanStepRow,
      await db.prisma.planStep.findMany({
        where: { flowId: id },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ).map((s) => ({ ...s, files: s.files ?? [] }));

    /** rows.ts rows and the UI read model both use camelCase keys. */
    const stepsEnriched = steps.map((s) => ({
      id: s.id,
      flowId: s.flowId,
      artifactId: s.artifactId,
      metaId: s.metaId,
      position: s.position,
      title: s.title,
      detail: s.detail,
      files: s.files,
      branch: s.branch,
      status: s.status,
      origin: s.origin,
      completedBy: s.completedBy,
    }));

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
      mrUrl: flow.mrUrl ?? undefined,
      mrIid: flow.mrIid ?? undefined,
      mrBranch: flow.mrBranch ?? undefined,
      repoUrl: flow.repoUrl ?? undefined,
      executionMode: flow.executionMode ?? undefined,
      cost: flowCost,
      usage: usage ?? undefined,
      branches: branches.map((b) => ({
        id: b.id,
        flowId: b.flowId,
        name: b.name,
        title: b.title ?? undefined,
        status: b.status,
        mrUrl: b.mrUrl ?? undefined,
        mrIid: b.mrIid ?? undefined,
        order: b.order,
      })),
      planSteps: stepsEnriched,
      resolveScheduleAt: await this.schedule.resolveScheduleAt(id),
      task: toFlowTask(task),
      hooks: (await hookStore.hooksForFlow(id)).flatMap((h: HookRow) =>
        h.flowId == null
          ? []
          : [{ id: h.id, flowId: h.flowId, nodeKey: h.nodeKey, secret: maskHookSecret(h.secret), filter: h.filter }],
      ),
      nodes: await Promise.all(nodeRows.map(async (n): Promise<FlowNode> => {
        const nt = ntOf(n.type);
        const def = nodeRegistry.maybe(n.type)
          ?? (nt?.isBuiltin ? nodeRegistry.maybe(nt.key) : undefined)
          ?? await declarativeDef(n.type, n.nodeKey);
        const cost = nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] };
        return {
          id: n.id,
          nodeKey: n.nodeKey,
          type: n.type,
          status: n.status,
          agentId: n.agentId,
          label: n.label,
          templateName: nt?.name ?? null,
          kind: nt?.kind ?? null,
          icon: nt?.icon ?? null,
          config: n.config,
          capabilities: uiCapabilities(def?.capabilities),
          joinMode: n.joinMode,
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
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, taskId: true, name: true, status: true, mrUrl: true, mrIid: true,
        mrBranch: true, repoUrl: true, gitlabProjectId: true,
        executionMode: true, repoId: true, templateId: true, templateGraph: true,
        triggerPayload: true, worktreeDir: true, kind: true,
        createdAt: true, updatedAt: true,
        task: { select: { key: true, summary: true } },
      },
    });
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
    const flow = parseRowTolerant(FlowRow, await db.prisma.flow.findUnique({ where: { id: flowId } }));
    if (!flow) throw new NotFoundError('flow', flowId);
    const task = parseRowTolerant(Task, await db.prisma.task.findUnique({ where: { id: flow.taskId } }));
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
   * approval flow consume. The ORM read returns the full row and every caller
   * picks its fields.
   */
  async latestResourceArtifact<T>(flowId: string, role: ChainRole): Promise<T | undefined> {
    const kinds = this.resourceKinds(role);
    if (!kinds.length) return undefined;
    const artifact = await db.prisma.artifact.findFirst({
      where: { node: { flowId }, kind: { in: [...kinds] } },
      orderBy: { version: "desc" },
    });
    const parsed = artifact ? parseRowTolerant(ArtifactRow, artifact) : undefined;
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
    const node = parseRowTolerant(
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
