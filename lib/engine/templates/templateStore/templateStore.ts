import "server-only";

import { FLOW_STATUS } from "@/constants/flow";
import { db } from "../../../db/app";
import type { Prisma } from "@prisma/client";
import {
  FlowTemplateRow,
  NodeTemplateRow,
  type TemplateNodeTrigger,
} from "../../../db/rows";
import {
  jsonPayload,
  templateEdgeSpecFromRow,
  templateNodeSpecFromRow,
} from "./utils/ormRows";
import { jsonInput, parseRow, parseRows } from "@/lib/db/ormRowHelpers";
import { isDeclarativeKind } from "../../nodes/declarativeRegistry/utils/isDeclarativeKind";
import type {
  EditorCatalogEntry,
  EditorNodeRow,
  TemplateCatalogDetail,
  TemplateEditorDetail,
} from "@/types/templateEditor";
import type { NodeRow } from "@/types/templates";
import { parseDeclarativeConfig } from "../../nodes/declarativeConfigParser";
import { catalogForNodeTemplateIds, lintTemplate, type LintProblem, type TaskUniverse } from "../templateLint";
import { graphStructureError, lintGraphStructure } from "../graphStructure";
import { hydrateFlowTemplateGraph, serializeFlowTemplateGraph } from "../flowGraphSnapshot";
import { hookStore } from "../../runtime/hookStore";
import { taskRegistry } from "../../tasks/registry";
import {
  FLOW_TRIGGER_TYPES,
  NO_TASK_TYPE,
  NODE_TRIGGER_TYPES,
  WAIT_FOR_SOURCES,
} from "../../constants/triggers";
import { ConflictError, NotFoundError, ValidationError } from "../../../errors";
import { SDLC_TEMPLATE_ID } from "../../constants/nodeKeys";
import {
  DeclarativeNodeKind,
  KINDED_NODE_TEMPLATE_KINDS,
  NODE_KIND_LABELS,
} from "./constants/nodeKinds";
import { serializeNodeTemplate } from "./utils/serializeNodeTemplate";
import type { DraftNodeTemplateInput } from "./types/templateStore";
import type {
  TemplateEdgeInput,
  TemplateGraph,
  TemplateInput,
  TemplateNodeInput,
} from "../../types/template";
/**
 * Design-time template store: reads flow templates (+ their node instances and
 * edges) and resolves the runtime roles the engine needs from that graph
 * instead of node-key constants.
 *
 * Phase 1: templates were seeded only. Phase 2 added the full CRUD surface the
 * UI builder and YAML import/export drive — create/duplicate/update/delete
 * (meta + node instances + edges), plus declarative node-template CRUD
 * (kind=agent). Phase 3 adds the decision / http / script kinds, static
 * template linting (§5), decision-edge label validation at save time, and the
 * flow trigger's declared task type (`trigger.taskType`, default = the first
 * registered task provider).
 */
export class TemplateStore {
  /** Load a template's graph, or null when the template does not exist. */
  async graph(templateId: string): Promise<TemplateGraph | null> {
    const tpl = await db.prisma.flowTemplate.findUnique({ where: { id: templateId }, select: { version: true, trigger: true } });
    if (!tpl) return null;

    const nodes = (await db.prisma.flowTemplateNode.findMany({
      where: { templateId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { nodeTemplate: true },
    })).map(templateNodeSpecFromRow);

    const edges = (await db.prisma.flowTemplateEdge.findMany({
      where: { templateId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })).map(templateEdgeSpecFromRow);

    return {
      templateId,
      version: tpl.version,
      // normalized on read: an absent task_type parses back as the default
      // (the first registered provider) — trigger rows need no migration
      flowTrigger: TemplateStore.flowTrigger(jsonPayload(FlowTemplateRow.shape.trigger, tpl.trigger)),
      nodes,
      edges,
      byKey: new Map(nodes.map((n) => [n.key, n])),
    };
  }

  /**
   * The graph a flow instance runs against. New flows persist a JSON snapshot
   * at creation (`flows.templateGraph`); legacy rows without one fall back to
   * the live template (same as pre-snapshot behavior).
   */
  async graphForFlow(flowId: string): Promise<TemplateGraph | null> {
    const row = await db.prisma.flow.findUnique({ where: { id: flowId }, select: { templateId: true, templateGraph: true } });
    if (!row) return null;
    // Json columns arrive parsed from Prisma; the snapshot helper still speaks
    // its serialized form, so re-stringify the object at this boundary
    const snapshotted = hydrateFlowTemplateGraph(typeof row.templateGraph === "string"
      ? row.templateGraph : row.templateGraph != null ? JSON.stringify(row.templateGraph) : null);
    if (snapshotted) return snapshotted;
    const tid = row.templateId ?? SDLC_TEMPLATE_ID;
    return this.graph(tid);
  }

  /** Persist the template graph snapshot taken when a flow is created. */
  async persistFlowGraphSnapshot(flowId: string, graph: TemplateGraph, tx?: Prisma.TransactionClient): Promise<void> {
    // the snapshot helper speaks its serialized form — parse it back so the
    // jsonb column keeps storing the object (not a string scalar)
    await (tx ?? db.prisma).flow.updateMany({
      where: { id: flowId },
      data: { templateGraph: JSON.parse(serializeFlowTemplateGraph(graph)) as Prisma.InputJsonValue },
    });
  }

  /**
   * The node instance the flow waits on for a given event source — the
   * role-based replacement for the `node_key='pipeline'` lookups the poller
   * and GitLab webhook made directly.
   */
  async waitNodeKey(flowId: string, eventSource: string): Promise<string | null> {
    const g = await this.graphForFlow(flowId);
    if (!g) return null;
    return g.nodes.find((n) => (n.trigger as TemplateNodeTrigger | undefined)?.waitFor === eventSource)?.key ?? null;
  }

  /**
   * The post-MR chain: the wait-node plus every downstream node reachable via
   * `next` edges whose trigger is automatic (auto/debounced). Today's
   * chainBusy guard covered pipeline|review|resolve — this is the same set,
   * derived from the template instead of constants.
   */
  async chainNodeKeys(flowId: string): Promise<string[]> {
    const g = await this.graphForFlow(flowId);
    if (!g) return [];
    const head = g.nodes.find((n) => (n.trigger as TemplateNodeTrigger | undefined)?.waitFor === "pipeline");
    if (!head) return g.nodes.map((n) => n.key); // no gate — treat the graph as the chain
    const out = [head.key];
    const seen = new Set(out);
    let frontier = [head.key];
    for (;;) {
      const nextKeys = new Set<string>();
      for (const k of frontier) {
        for (const e of g.edges) {
          if (e.kind !== "next" || e.from !== k) continue;
          const target = g.byKey.get(e.to);
          if (!target || seen.has(e.to)) continue;
          const tt = target.trigger.type;
          if (tt !== "auto" && tt !== "debounced") continue; // manual stop points end the walk
          nextKeys.add(e.to);
        }
      }
      if (!nextKeys.size) break;
      for (const k of nextKeys) {
        seen.add(k);
        out.push(k);
      }
      frontier = [...nextKeys];
    }
    return out;
  }

  // ── flow-template CRUD (Phase 2) ─────────────────────────────────────────

  /** All templates, newest first, with instance counts for the gallery.
   *  `opts.includeHidden` brings back the auto-wrapped fan-out child templates
   *  (hidden=1) — the gallery excludes them by default. */
  async list(opts: { includeHidden?: boolean } = {}): Promise<(FlowTemplateRow & { nodeCount: number })[]> {
    const templates = parseRows(
      FlowTemplateRow,
      await db.prisma.flowTemplate.findMany({
        where: opts.includeHidden ? undefined : { hidden: false },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      "flowTemplate.list",
    );
    const counts = await db.prisma.flowTemplateNode.groupBy({
      by: ["templateId"],
      _count: { _all: true },
    });
    const nodeCountByTemplate = new Map(counts.map((c) => [c.templateId, c._count._all]));
    return templates.map((t) => ({ ...t, nodeCount: nodeCountByTemplate.get(t.id) ?? 0 }));
  }

  /** One template row (or undefined). Tx-scoped inside a transaction. */
  async flowTemplate(id: string, tx?: Prisma.TransactionClient): Promise<FlowTemplateRow | undefined> {
    const row = await (tx ?? db.prisma).flowTemplate.findUnique({ where: { id } });
    return row ? parseRow(FlowTemplateRow, row, "flowTemplate.flowTemplate") : undefined;
  }

  /**
   * The template editor's full payload (the GET /api/templates/[id] body):
   * template meta, the always-provisioned flow hook and the graph as
   * snake_case row slices. Null when the template or its graph is missing.
   * Shared by the route and the server page's SSR boot (single mapping).
   */
  async editorPayload(id: string): Promise<TemplateEditorDetail | null> {
    const t = await this.flowTemplate(id);
    const g = await this.graph(id);
    if (!t || !g) return null;
    // the flow-trigger hook (always provisioned, §6) — url path + secret for
    // the sender's curl example
    const hook = await hookStore.hookForTemplate(id);
    const nodes: EditorNodeRow[] = [];
    for (const n of g.nodes) {
      const nt = await this.nodeTemplate(n.nodeTemplateId);
      nodes.push({
        key: n.key,
        node_template_id: n.nodeTemplateId,
        label: n.label,
        trigger: { ...n.trigger },
        join_mode: n.joinMode,
        config: n.config,
        input_map: n.inputMap,
        kind: nt?.kind ?? null,
        icon: nt?.icon ?? null,
        catalog_name: nt?.name ?? null,
        /** node_templates row key ("plan"/"start"/...): the fan-out UI gates
         *  on builtin plan nodes the same way the save-time lint does */
        catalog_key: nt?.key ?? null,
        is_builtin: Boolean(nt?.isBuiltin),
        is_local: Boolean(nt?.templateId),
        x: n.x ?? null,
        y: n.y ?? null,
      });
    }
    return {
      template: {
        id: t.id,
        name: t.name,
        description: t.description,
        version: t.version,
        is_builtin: Boolean(t.isBuiltin),
        trigger: g.flowTrigger,
      },
      hook: hook ? { id: hook.id, secret: hook.secret, filter: hook.filter } : null,
      nodes,
      edges: g.edges,
    };
  }

  /**
   * The builder palette's catalog payload (GET /api/node-templates):
   * `nodeTemplates` carries built-ins + the global Library rows,
   * `templateNodeTemplates` the rows private to the template. Shared by the
   * route and the server page's SSR boot (single mapping).
   */
  async paletteCatalog(templateId?: string): Promise<TemplateCatalogDetail> {
    const { library, templateLocal } = await this.listNodeTemplatesForPalette(templateId);
    return {
      nodeTemplates: [
        ...(await this.listNodeTemplates()).filter((nt) => Boolean(nt.isBuiltin)),
        ...library,
      ].map((nt) => this.toCatalogEntry(nt)),
      templateNodeTemplates: templateLocal.map((nt) => this.toCatalogEntry(nt)),
    };
  }

  /** One node_templates row as GET /api/node-templates and the catalog page serialize it. */
  toCatalogEntry(nt: NodeTemplateRow): EditorCatalogEntry {
    return serializeNodeTemplate(nt);
  }

  /** One row for GET/POST/PATCH node-template API responses. */
  toNodeCatalogRow(nt: NodeTemplateRow): NodeRow {
    return {
      id: nt.id,
      key: nt.key,
      name: nt.name,
      kind: nt.kind,
      version: nt.version,
      description: nt.description,
      icon: nt.icon,
      is_builtin: Boolean(nt.isBuiltin),
      config: nt.config ?? {},
      template_id: nt.templateId,
      is_local: Boolean(nt.templateId),
      updated_at: nt.updatedAt,
    };
  }

  /** Gallery/catalog page rows — same shape as `loadNodeCatalog`. */
  async listNodeCatalogRows(): Promise<NodeRow[]> {
    return (await this.listNodeTemplates()).map((nt) => this.toNodeCatalogRow(nt));
  }

  /**
   * Create a declarative node template from the API body (optional auto-name
   * when `name` is omitted).
   */
  async createNodeTemplateFromRequest(input: {
    key?: string;
    name?: string;
    kind?: string;
    icon?: string | null;
    description?: string | null;
    config?: Record<string, unknown>;
  }): Promise<NodeTemplateRow> {
    const kind = (input.kind ?? "agent").trim();
    let name = (input.name ?? "").trim();
    let description = input.description ?? null;
    if (!name) {
      const label =
        NODE_KIND_LABELS[kind as DeclarativeNodeKind] ?? "Custom node";
      description ??= `Blank ${kind} node — connect it, then author it in the drawer`;
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? label : `${label} ${n}`;
        const slug = TemplateStore.slugify(candidate);
        if (!(await this.nodeTemplateByKey(slug))) {
          name = candidate;
          break;
        }
      }
    }
    return this.createNodeTemplate({
      key: input.key,
      name,
      kind,
      icon: input.icon ?? null,
      description,
      config: input.config ?? {},
    });
  }

  /** Live lint of an editor draft — same logic as POST /api/templates/[id]/validate. */
  async lintDraft(body: {
    trigger?: Record<string, unknown>;
    nodes?: {
      key?: string;
      nodeTemplateId?: string;
      config?: unknown;
      input_map?: unknown;
      trigger?: unknown;
    }[];
    edges?: {
      from?: string;
      to?: string;
      kind?: string;
      label?: string | null;
      condition?: string | null;
    }[];
    new_node_templates?: { draft_id?: string; kind?: string; config?: unknown }[];
  }): Promise<LintProblem[]> {
    const lintNodes = (body.nodes ?? []).map((n) => ({
      key: (typeof n.key === "string" ? n.key : "").trim(),
      nodeTemplateId: typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : "",
      inputMap: (n.input_map ?? {}) as Record<string, unknown>,
      config: (n.config ?? {}) as Record<string, unknown>,
      trigger: n.trigger,
    }));

    const lintEdges = (body.edges ?? []).map((e) => ({
      from: e.from ?? "",
      to: e.to ?? "",
      kind: e.kind === "loop" ? "loop" : "next",
      label: e.label ?? null,
      condition: e.condition ?? null,
    }));

    const realIds = lintNodes
      .map((n) => n.nodeTemplateId)
      .filter((id) => id && !id.startsWith("draft:"));
    const catalog = await catalogForNodeTemplateIds(realIds);
    for (const d of body.new_node_templates ?? []) {
      if (typeof d?.draft_id === "string" && d.draft_id.startsWith("draft:")) {
        catalog[d.draft_id] = {
          kind: d.kind ?? "agent",
          config: d.config ?? {},
          key: "",
          isBuiltin: false,
        };
      }
    }

    const structureProblems = lintGraphStructure(lintNodes, lintEdges, (node) => {
      const entry = catalog[node.nodeTemplateId];
      if (!entry) return null;
      let decisionChoices: string[] | undefined;
      if (entry.kind === "decision") {
        const cfg = parseDeclarativeConfig("decision", { ...(entry.config ?? {}), ...(node.config ?? {}) }, node.key) as {
          choices?: { label: string }[];
        };
        decisionChoices = (cfg.choices ?? []).map((c) => c.label);
      }
      return {
        kind: entry.kind,
        key: entry.key,
        isBuiltin: entry.isBuiltin,
        decisionChoices,
      };
    });

    const trigger = TemplateStore.normalizeFlowTrigger(body.trigger);
    const task = TemplateStore.lintTaskUniverse(trigger);
    const lint = await lintTemplate(lintNodes, lintEdges, catalog, task);
    return [...structureProblems, ...lint.problems];
  }

  /** Create a template (meta + node instances + edges). Validates the graph.
   *  `opts.skipLint`: the StepFlowManager's auto-wrap path only — it writes a
   *  single-node template from an EXISTING catalog row with copied config
   *  (cross-node refs etc. are meaningless in the child's context family;
   *  the node's own refs resolve as fan-out step variables at child runtime). */
  async create(input: TemplateInput, opts: { isBuiltin?: boolean; id?: string; skipLint?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<string> {
    const { nodes, edges, trigger } = await this.validated(input, { skipLint: opts.skipLint === true }, tx);
    const id = opts.id ?? db.uid("tpl_");
    const ts = new Date();
    await db.transaction(async (exec) => {
      await exec.flowTemplate.createMany({
        data: {
          id, name: input.name?.trim() || "Untitled flow", description: input.description ?? null,
          version: 1, isBuiltin: Boolean(opts.isBuiltin), trigger: jsonInput(trigger),
          createdAt: ts, updatedAt: ts,
        },
        skipDuplicates: true,
      });
      await this.writeNodesAndEdges(id, nodes, edges, {}, exec);
      await TemplateStore.syncTriggers(id, trigger, exec);
    }, tx);
    return id;
  }

  /**
   * Update a template. Node/edge arrays, when present, replace the existing
   * ones wholesale (the editor sends its full draft); otherwise only the
   * meta fields are touched. Running flows keep the graph snapshot taken at
   * creation; only node config/join_mode on their node rows were frozen then
   * (structural template edits are blocked while flows are active).
   */
  async update(templateId: string, patch: Partial<TemplateInput>, tx?: Prisma.TransactionClient): Promise<void> {
    const tpl = await this.flowTemplate(templateId, tx);
    if (!tpl) throw new NotFoundError("template", templateId);
    await this.assertEditable(templateId, tx);
    if (patch.name !== undefined || patch.description !== undefined || patch.trigger !== undefined) {
      await (tx ?? db.prisma).flowTemplate.update({
        where: { id: templateId },
        data: {
          name: patch.name?.trim() || tpl.name,
          description: patch.description !== undefined ? patch.description : tpl.description,
          trigger: patch.trigger !== undefined ? jsonInput(TemplateStore.flowTrigger(patch.trigger)) : jsonInput(tpl.trigger),
          updatedAt: new Date(),
        },
      });
    }
    if (patch.nodes !== undefined && patch.edges !== undefined) {
      const { nodes, edges } = await this.validated({ name: patch.name, nodes: patch.nodes, edges: patch.edges }, {}, tx);
      await this.assertNotRunning(templateId, tx);
      await this.writeNodesAndEdges(templateId, nodes, edges, { replace: true }, tx);
    } else if (patch.nodes !== undefined || patch.edges !== undefined) {
      throw new ValidationError("nodes and edges must be replaced together");
    }
    // flow-trigger side data — the template's inbound hook (always) and the
    // schedule timer (schedule trigger) — whenever the trigger was touched
    if (patch.trigger !== undefined) {
      await TemplateStore.syncTriggers(templateId, TemplateStore.flowTrigger(patch.trigger), tx);
    }
  }

  /** Editor save with pending draft node templates — one atomic transaction (CR-050). */
  async saveWithDrafts(
    templateId: string,
    patch: Partial<TemplateInput> & {
      nodes?: TemplateNodeInput[];
      edges?: TemplateEdgeInput[];
      new_node_templates?: DraftNodeTemplateInput[];
    },
  ): Promise<void> {
    const drafts = Array.isArray(patch.new_node_templates) ? patch.new_node_templates : [];
    if (
      !drafts.length &&
      patch.nodes?.some((n) => typeof n.nodeTemplateId === "string" && n.nodeTemplateId.startsWith("draft:"))
    ) {
      throw new ValidationError(
        "a node references an unsaved node template — send it in new_node_templates",
      );
    }
    await db.transaction(async (exec) => {
      const remapped = { ...patch };
      delete remapped.new_node_templates;
      if (drafts.length) {
        if (!remapped.nodes) {
          throw new ValidationError("new_node_templates requires the nodes array (a full graph save)");
        }
        remapped.nodes = await this.remapDraftNodeTemplates(templateId, remapped.nodes, drafts, exec);
      }
      await this.update(templateId, remapped, exec);
    });
  }

  private async remapDraftNodeTemplates(
    templateId: string,
    nodes: TemplateNodeInput[],
    drafts: DraftNodeTemplateInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<TemplateNodeInput[]> {
    const byDraftId = new Map<string, string>();
    for (const d of drafts) {
      const draftId = typeof d?.draft_id === "string" ? d.draft_id : "";
      if (!draftId.startsWith("draft:")) {
        throw new ValidationError("new_node_templates entry is missing its draft_id");
      }
      if (byDraftId.has(draftId)) continue;
      const { id: rowId } = await this.createOrReuseNodeTemplate({
        name: (d.name ?? "").trim() || "Untitled node",
        kind: d.kind ?? "agent",
        icon: d.icon ?? null,
        description: d.description ?? null,
        config: d.config ?? {},
      }, { templateId }, tx);
      byDraftId.set(draftId, rowId);
    }
    return nodes.map((n) => {
      const ntId = typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : "";
      if (!ntId.startsWith("draft:")) return n;
      const rowId = byDraftId.get(ntId);
      if (!rowId) {
        throw new ValidationError(
          `node "${n.key}" references unsaved node template "${ntId}" — it wasn't included in new_node_templates`,
        );
      }
      return { ...n, nodeTemplateId: rowId };
    });
  }

  /** Delete a template (built-ins are protected; in-use templates are locked). */
  async delete(templateId: string): Promise<void> {
    await this.assertEditable(templateId);
    const used = await db.prisma.flow.count({ where: { templateId } });
    if (used > 0) {
      throw new ConflictError(
        `this template is used by ${used} flow${used > 1 ? "s" : ""} — delete the flows first`,
      );
    }
    await hookStore.removeTemplate(templateId);
    await db.transaction(async (exec) => {
      await exec.flowTemplateNode.deleteMany({ where: { templateId } });
      await exec.flowTemplateEdge.deleteMany({ where: { templateId } });
      // Template-local node templates (the canvas creator's rows): gone with
      // their template — but only when no OTHER template's node still
      // references one (belt-and-braces: Add to Library promotes without
      // touching references, so a promoted row must survive here). Runs BEFORE
      // the flow_templates delete (the FK is enforced); a stray external
      // reference detaches the row to the shared Library instead of blocking
      // the delete forever.
      const locals = await exec.nodeTemplate.findMany({ where: { templateId, isBuiltin: false }, select: { id: true } });
      for (const l of locals) {
        const usedElsewhere = await exec.flowTemplateNode.count({ where: { nodeTemplateId: l.id, templateId: { not: templateId } } });
        if (usedElsewhere === 0) await exec.nodeTemplate.deleteMany({ where: { id: l.id } });
        else await exec.nodeTemplate.updateMany({ where: { id: l.id }, data: { templateId: null } });
      }
      await exec.flowTemplate.deleteMany({ where: { id: templateId } });
    });
  }

  /** Built-in seeded templates (the SDLC loop) can be duplicated, not edited. */
  async assertEditable(templateId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const t = await this.flowTemplate(templateId, tx);
    if (!t) throw new NotFoundError("template", templateId);
    if (t.isBuiltin) {
      throw new ValidationError("the built-in template is read-only — duplicate it to make changes");
    }
  }

  /**
   * Whether any node instance still references an unsaved draft node template
   * (Phase 2's `draft:<n>` ids). `graph()` can't see these (its catalog JOIN
   * drops them), so the export path asks directly: a template with draft nodes
   * can't be exported — its YAML would reference rows that don't exist.
   */
  async hasDraftNodes(templateId: string): Promise<boolean> {
    return (
      (await db.prisma.flowTemplateNode.count({ where: { templateId, nodeTemplateId: { startsWith: "draft:" } } })) > 0
    );
  }

  /** Structural edits are refused while flows are active on this template. */
  private async assertNotRunning(templateId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const active = await (tx ?? db.prisma).flow.count({ where: { templateId, status: FLOW_STATUS.ACTIVE } });
    if (active > 0) {
      throw new ConflictError(
        `${active} flow${active > 1 ? "s are" : " is"} active on this template — cancel/finish them before restructuring`,
      );
    }
  }

  /**
   * Position-only update (Phase 5 visual builder): drag re-layout syncs x/y
   * without touching the graph. Positions are display metadata — no validated()
   * walk, no assertNotRunning (the flow's graph snapshot is fixed at creation).
   */
  async updatePositions(templateId: string, positions: Record<string, { x: number; y: number }>): Promise<void> {
    if (!(await this.flowTemplate(templateId))) throw new NotFoundError("template", templateId);
    await this.assertEditable(templateId);
    const entries = Object.entries(positions).filter(
      (kv) => kv[0] && Number.isFinite(kv[1]?.x) && Number.isFinite(kv[1]?.y),
    );
    if (!entries.length) return;
    const known = await db.prisma.flowTemplateNode.findMany({ where: { templateId }, select: { nodeKey: true } });
    const keys = new Set(known.map((k) => k.nodeKey));
    const ts = new Date();
    for (const [key, pos] of entries) {
      if (!keys.has(key)) continue; // don't create rows for stray keys
      await db.prisma.flowTemplateNode.updateMany({
        where: { templateId, nodeKey: key },
        data: { x: pos.x, y: pos.y, updatedAt: ts },
      });
    }
    await db.prisma.flowTemplate.updateMany({ where: { id: templateId }, data: { updatedAt: ts } });
  }

  // ── node-template (catalog) CRUD ──────────────────────────────────────────

  /** The node-type catalog, grouped for the configurator palette. */
  async listNodeTemplates(): Promise<NodeTemplateRow[]> {
    return parseRows(
      NodeTemplateRow,
      await db.prisma.nodeTemplate.findMany({ orderBy: [{ isBuiltin: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
      "nodeTemplate.listNodeTemplates",
    );
  }

  /**
   * The palette's node-template slices, split by locality: `library` = global
   * declarative rows (the shared Library, `template_id IS NULL`),
   * `templateLocal` = rows owned by the given template (the canvas creator's
   * rows) — an absent templateId means no local slice. Built-ins are excluded
   * from both (the palette renders them from the full catalog listing).
   */
  async listNodeTemplatesForPalette(templateId?: string): Promise<{
    library: NodeTemplateRow[];
    templateLocal: NodeTemplateRow[];
  }> {
    const paletteWhere = (owner: string | null) => ({ isBuiltin: false, templateId: owner });
    return {
      library: parseRows(
        NodeTemplateRow,
        await db.prisma.nodeTemplate.findMany({ where: paletteWhere(null), orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        "nodeTemplate.listNodeTemplatesForPalette",
      ),
      templateLocal: templateId !== undefined
        ? parseRows(
            NodeTemplateRow,
            await db.prisma.nodeTemplate.findMany({ where: paletteWhere(templateId), orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
            "nodeTemplate.listNodeTemplatesForPalette",
          )
        : [],
    };
  }

  async nodeTemplate(id: string, tx?: Prisma.TransactionClient): Promise<NodeTemplateRow | undefined> {
    const row = await (tx ?? db.prisma).nodeTemplate.findUnique({ where: { id } });
    return row ? parseRow(NodeTemplateRow, row, "nodeTemplate.nodeTemplate") : undefined;
  }

  async nodeTemplateByKey(key: string, tx?: Prisma.TransactionClient): Promise<NodeTemplateRow | undefined> {
    const row = await (tx ?? db.prisma).nodeTemplate.findFirst({ where: { key } });
    return row ? parseRow(NodeTemplateRow, row, "nodeTemplate.nodeTemplateByKey") : undefined;
  }

  /**
   * Create a declarative (user-defined) node template (agent / decision /
   * http / script). `opts.templateId` scopes the row to that template —
   * the canvas creator's "This template" rows, invisible to other templates'
   * palettes; without it the row lands in the global Library as before.
   */
  async createNodeTemplate(input: {
    key?: string; name: string; kind: string; icon?: string | null;
    description?: string | null; config: Record<string, unknown>;
  }, opts: { templateId?: string } = {}, tx?: Prisma.TransactionClient): Promise<NodeTemplateRow> {
    const client = tx ?? db.prisma;
    const kind = (input.kind ?? "").trim();
    if (!isDeclarativeKind(kind)) {
      throw new Error(`unsupported node kind "${kind}" — declarative kinds: ${KINDED_NODE_TEMPLATE_KINDS.join(", ")}`);
    }
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    // key uniqueness: a template-local create suffixes the slug (…_local,
    // …_local2, …) when any row already owns it — UNIQUE(key, version) is
    // table-wide and global rows hold keys too; a global create keeps the
    // strict single-owner rule.
    const slug = TemplateStore.slugify(input.key?.trim() || name);
    const key = opts.templateId !== undefined
      ? await TemplateStore.freeKeyVariant(slug)
      : slug;
    if (await this.nodeTemplateByKey(key, tx)) {
      throw new Error(`node template key "${key}" already exists`);
    }
    // a declarative key must not shadow a built-in component (the registry
    // resolves built-ins first)
    if (await client.nodeTemplate.findFirst({ where: { key, isBuiltin: true }, select: { key: true } })) {
      throw new Error(`"${key}" is a built-in node key — pick another name`);
    }
    // validate the declarative definition up front (same schema the runtime hydrates)
    const config = parseDeclarativeConfig(kind, input.config ?? {}, name);
    const id = db.uid("nt_");
    const ts = new Date();
    await client.nodeTemplate.createMany({
      data: {
        id, key, name, kind, version: 1,
        description: input.description ?? null, icon: input.icon ?? null,
        config: jsonInput(config), isBuiltin: false, templateId: opts.templateId ?? null,
        createdAt: ts, updatedAt: ts,
      },
      skipDuplicates: true,
    });
    return this.requireNodeTemplate(id, tx);
  }

  private async requireNodeTemplate(id: string, tx?: Prisma.TransactionClient): Promise<NodeTemplateRow> {
    const row = await this.nodeTemplate(id, tx);
    if (!row) throw new NotFoundError("node template", id);
    return row;
  }

  /**
   * Persist a draft declarative node template at Save time (Phase 2): the
   * editor's palette places `draft:` instances with nothing server-side until
   * the user commits — this is where the rows are born. An identical
   * persisted def (same key + kind + config) is reused, so identical custom
   * nodes stay one row across templates (locality-aware); otherwise a new row
   * is created scoped to the given template, and a taken key
   * versions the display name ("Agent node 2") instead of dead-ending the
   * save. Returns the row id + whether this call created it (the API route
   * rolls back rows it created when the surrounding save fails).
   */
  async createOrReuseNodeTemplate(input: {
    name: string; kind: string; icon?: string | null; description?: string | null;
    config: Record<string, unknown>;
  }, opts: { templateId: string }, tx?: Prisma.TransactionClient): Promise<{ id: string; created: boolean }> {
    const client = tx ?? db.prisma;
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const kind = (input.kind ?? "").trim();
    if (!(KINDED_NODE_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`unsupported node kind "${kind}" — declarative kinds: ${KINDED_NODE_TEMPLATE_KINDS.join(", ")}`);
    }
    // validate + normalize once (createNodeTemplate parses again — cheap, and
    // it keeps the create path single-sourced)
    const config = parseDeclarativeConfig(kind, input.config ?? {}, name);
    // identical-def reuse, locality-aware: a global Library row hosting the
    // same definition is reused (an identical custom node stays one Library
    // row across templates), as is an identical row already local to THIS
    // template (suffixed keys included — the base slug may be taken by
    // another def). Rows local to other templates always get a fresh copy
    // scoped to this template.
    const slug = TemplateStore.slugify(name);
    const identical = parseRows(
      NodeTemplateRow,
      await (tx ?? db.prisma).nodeTemplate.findMany({
        where: {
          isBuiltin: false,
          AND: [
            { OR: [{ key: slug }, { key: { startsWith: `${slug}_local` } }] },
            { OR: [{ templateId: null }, { templateId: opts.templateId }] },
          ],
        },
      }),
      "nodeTemplate.createOrReuseNodeTemplate",
    ).find((r) => r.kind === kind && JSON.stringify(r.config ?? {}) === JSON.stringify(config));
    if (identical) return { id: identical.id, created: false };
    try {
      return {
        id: (await this.createNodeTemplate(
          { name, kind, icon: input.icon, description: input.description, config },
          { templateId: opts.templateId },
          client,
        )).id,
        created: true,
      };
    } catch (e: unknown) {
      // a persisted row already owns the slug — version the name instead of
      // failing the whole save on a catalog collision
      if (!/already exists/.test(e instanceof Error ? e.message : String(e))) throw e;
      for (let n = 2; ; n++) {
        try {
          return {
            id: (await this.createNodeTemplate(
              { name: `${name} ${n}`, kind, icon: input.icon, description: input.description, config },
              { templateId: opts.templateId },
              client,
            )).id,
            created: true,
          };
        } catch (e2: unknown) {
          if (n >= 50 || !/already exists/.test(e2 instanceof Error ? e2.message : String(e2))) throw e2;
        }
      }
    }
  }

  /**
   * Add to Library — promote a template-local declarative row to a global
   * one, so every template's builder lists it under "Library". Idempotent:
   * an already-global row returns as-is. When another row already owns the
   * key, this row's key is suffixed (…_local, …_local2, …) so
   * UNIQUE(key, version) holds — references point at the row id, so promoted
   * instances keep working untouched.
   */
  async addToLibrary(id: string): Promise<NodeTemplateRow> {
    const row = await this.nodeTemplate(id);
    if (!row) throw new Error("node template not found");
    if (row.isBuiltin) throw new Error("built-in node templates are read-only");
    if (row.templateId == null) return row; // already in the Library — no-op
    // another row holding this key (a global Library row, or a sibling
    // template's local row) blocks the promotion — make room via a variant
    const owner = await this.nodeTemplateByKey(row.key);
    const key = owner && owner.id !== row.id
      ? await TemplateStore.freeKeyVariant(row.key)
      : row.key;
    await db.prisma.nodeTemplate.update({
      where: { id },
      data: { templateId: null, key, updatedAt: new Date() },
    });
    return this.requireNodeTemplate(id);
  }

  /** Update a declarative node template (never built-ins). */
  async updateNodeTemplate(id: string, patch: {
    name?: string; description?: string | null; icon?: string | null; config?: Record<string, unknown>;
  }): Promise<NodeTemplateRow> {
    const row = await this.nodeTemplate(id);
    if (!row) throw new Error("node template not found");
    if (row.isBuiltin) throw new Error("built-in node templates are read-only");
    const config = patch.config !== undefined
      ? parseDeclarativeConfig(row.kind, patch.config, patch.name?.trim() || row.name)
      : (row.config ?? {});
    await db.prisma.nodeTemplate.update({
      where: { id },
      data: {
        name: patch.name?.trim() || row.name,
        description: patch.description !== undefined ? patch.description : row.description,
        icon: patch.icon !== undefined ? patch.icon : row.icon,
        config: jsonInput(config),
        updatedAt: new Date(),
      },
    });
    return this.requireNodeTemplate(id);
  }

  /**
   * Find-or-create a declarative node template — the YAML import path:
   * a re-imported definition reuses its existing row (same kind + identical
   * config); a changed definition becomes a new version of the same key.
   */
  async ensureNodeTemplate(input: {
    key?: string; name: string; kind: string; icon?: string | null; config: Record<string, unknown>;
  }, tx?: Prisma.TransactionClient): Promise<{ id: string; created: boolean }> {
    const client = tx ?? db.prisma;
    const kind = (input.kind ?? "").trim();
    if (!isDeclarativeKind(kind)) {
      throw new Error(`unsupported node kind "${kind}"`);
    }
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const key = TemplateStore.slugify(input.key?.trim() || name);
    if (await client.nodeTemplate.findFirst({ where: { key, isBuiltin: true }, select: { key: true } })) {
      throw new Error(`"${key}" is a built-in node key — pick another name`);
    }
    // normalize the config once so "identical" comparisons compare parsed forms
    const normalized = parseDeclarativeConfig(kind, input.config ?? {}, name);
    const candidates = parseRows(
      NodeTemplateRow,
      await (tx ?? db.prisma).nodeTemplate.findMany({ where: { key, isBuiltin: false } }),
      "nodeTemplate.ensureNodeTemplate",
    );
    const identical = candidates.find(
      (r) => r.kind === kind && JSON.stringify(r.config ?? {}) === JSON.stringify(normalized)
    );
    if (identical) return { id: identical.id, created: false };
    const version = candidates.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const id = db.uid("nt_");
    const ts = new Date();
    await client.nodeTemplate.createMany({
      data: {
        id, key, name, kind, version,
        description: null, icon: input.icon ?? null,
        config: jsonInput(normalized), isBuiltin: false,
        createdAt: ts, updatedAt: ts,
      },
      skipDuplicates: true,
    });
    return { id, created: true };
  }

  /** Delete a declarative node template when no template instance references it. */
  async deleteNodeTemplate(id: string): Promise<void> {
    const row = await this.nodeTemplate(id);
    if (!row) throw new Error("node template not found");
    if (row.isBuiltin) throw new Error("built-in node templates are read-only");
    const used = await db.prisma.flowTemplateNode.count({ where: { nodeTemplateId: id } });
    if (used > 0) throw new Error(`this node template is used by ${used} template node${used > 1 ? "s" : ""}`);
    await db.prisma.nodeTemplate.delete({ where: { id } });
  }

  // ── write path helpers ────────────────────────────────────────────────────

  /** Validate name/trigger/graph invariants, returning normalized inputs. */
  /** Normalized flow trigger — same rules as save (for /validate). */
  static normalizeFlowTrigger(o: unknown): Record<string, unknown> {
    return TemplateStore.flowTrigger(o);
  }

  /** {{task.*}} lint universe for a normalized trigger. */
  static lintTaskUniverse(trigger: Record<string, unknown>): TaskUniverse | null {
    return TemplateStore.taskUniverse(trigger);
  }

  private async validated(input: TemplateInput, opts: { skipLint?: boolean } = {}, tx?: Prisma.TransactionClient): Promise<{
    trigger: Record<string, unknown>;
    nodes: TemplateNodeInput[];
    edges: TemplateEdgeInput[];
  }> {
    // node-template rows the structural rules read — prefetched (async store
    // reads can't run inside lintGraphStructure's sync callback)
    const ntRows = new Map<string, NodeTemplateRow | undefined>();
    for (const id of new Set(input.nodes.map((n) => n.nodeTemplateId))) {
      ntRows.set(id, await this.nodeTemplate(id, tx));
    }
    const resolveNodeTemplate = (node: TemplateNodeInput) => {
      const row = ntRows.get(node.nodeTemplateId);
      if (!row) return null;
      let decisionChoices: string[] | undefined;
      if (row.kind === "decision") {
        const cfg = parseDeclarativeConfig("decision", { ...(row.config ?? {}), ...(node.config ?? {}) }, node.key) as {
          choices?: { label: string }[];
        };
        decisionChoices = (cfg.choices ?? []).map((c) => c.label);
      }
      return {
        kind: row.kind,
        key: row.key,
        isBuiltin: Boolean(row.isBuiltin),
        decisionChoices,
      };
    };

    const structureProblems = lintGraphStructure(input.nodes, input.edges ?? [], resolveNodeTemplate);
    const structureErr = graphStructureError(structureProblems);
    if (structureErr) throw new Error(structureErr);

    const edges: TemplateEdgeInput[] = (input.edges ?? []).map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind === "loop" ? "loop" : "next",
      label: e.label?.trim() || null,
      condition: e.condition?.trim() || null,
    }));
    // build-time static checks (§5): {{refs}} resolve against upstream
    // contracts AND the template's task context (trigger.taskType → provider
    // fields), JSONata compiles in input_map / decision expressions /
    // response_map / edge conditions
    const trigger = TemplateStore.flowTrigger(input.trigger);
    if (opts.skipLint !== true) {
      const lint = await lintTemplate(
        input.nodes.map((n) => ({
          key: n.key.trim(),
          nodeTemplateId: n.nodeTemplateId,
          inputMap: (n.input_map ?? {}) as Record<string, unknown>,
          config: (n.config ?? {}) as Record<string, unknown>,
          trigger: n.trigger,
        })),
        edges.map((e) => ({
          from: e.from, to: e.to, kind: e.kind ?? "next",
          label: e.label ?? null, condition: e.condition ?? null,
        })),
        await catalogForNodeTemplateIds(input.nodes.map((n) => n.nodeTemplateId), tx),
        TemplateStore.taskUniverse(trigger),
      );
      if (lint.error) throw new Error(lint.error);
    }
    return { trigger, nodes: input.nodes, edges };
  }

  /** Write node instances and edges for a template id (optionally replacing). */
  private async writeNodesAndEdges(
    templateId: string,
    nodes: TemplateNodeInput[],
    edges: TemplateEdgeInput[],
    opts: { replace?: boolean } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const write = async (exec: Prisma.TransactionClient) => {
      if (opts.replace) {
        await exec.flowTemplateNode.deleteMany({ where: { templateId } });
        await exec.flowTemplateEdge.deleteMany({ where: { templateId } });
      }
      const ts = new Date();
      if (nodes.length) {
        await exec.flowTemplateNode.createMany({
          data: nodes.map((n) => ({
            id: db.uid("ftn_"),
            templateId,
            nodeKey: n.key.trim(),
            nodeTemplateId: n.nodeTemplateId,
            label: n.label ?? null,
            trigger: jsonInput(TemplateStore.nodeTrigger(n.trigger)),
            joinMode: n.join_mode === "any" ? "any" : "all",
            config: jsonInput(n.config && Object.keys(n.config).length ? n.config : {}),
            inputMap: jsonInput(n.input_map && Object.keys(n.input_map).length ? n.input_map : {}),
            x: n.x ?? null, y: n.y ?? null,
            createdAt: ts, updatedAt: ts,
          })),
          skipDuplicates: true,
        });
      }
      if (edges.length) {
        await exec.flowTemplateEdge.createMany({
          data: edges.map((e) => ({
            id: db.uid("fte_"), templateId,
            fromKey: e.from, toKey: e.to,
            kind: e.kind ?? "next", label: e.label ?? null, condition: e.condition ?? null,
            createdAt: ts, updatedAt: ts,
          })),
          skipDuplicates: true,
        });
      }
      await exec.flowTemplate.update({ where: { id: templateId }, data: { updatedAt: ts } });
    };
    await db.transaction(write, tx);
  }

  /**
   * Flow-trigger side effects (Phase 4): the template's inbound hook endpoint
   * (always provisioned — webhook deliveries never depend on the trigger
   * type) and the schedule timer for a `schedule` trigger (`schedule_next_at`,
   * armed on first save and never reset while the trigger stays schedule —
   * the poller bumps it after every fire). Callers pass the normalized
   * trigger.
   */
  private static async syncTriggers(templateId: string, trigger: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<void> {
    await hookStore.syncTemplate(templateId, tx);
    if (trigger.type === "schedule") {
      const intervalMin = typeof trigger.interval_min === "number" && trigger.interval_min > 0
        ? trigger.interval_min : 60;
      const cur = await (tx ?? db.prisma).flowTemplate.findUnique({ where: { id: templateId }, select: { scheduleNextAt: true } });
      if (cur && !cur.scheduleNextAt) {
        await (tx ?? db.prisma).flowTemplate.update({
          where: { id: templateId },
          data: { scheduleNextAt: new Date(Date.now() + intervalMin * 60_000) },
        });
      }
    } else {
      await (tx ?? db.prisma).flowTemplate.updateMany({ where: { id: templateId }, data: { scheduleNextAt: null } });
    }
  }

  /**
   * Normalize a flow trigger: the type + per-type knobs, plus the declared
   * task type (`task_type` — which task type the template's flows run on,
   * defaulting to the first registered provider when absent). The output is
   * rebuilt from the known keys — stray keys on stored rows (an old
   * `ticket_id` pin) simply don't survive; task binding is the declared
   * type, not one mutable row.
   */
  private static flowTrigger(o: unknown): Record<string, unknown> {
    const rec = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
    const rawType = rec.type;
    let type: (typeof FLOW_TRIGGER_TYPES)[number];
    if (rawType === undefined || rawType === null || rawType === "") {
      type = "manual";
    } else if (typeof rawType !== "string") {
      throw new Error(`flow trigger type must be a string (got ${typeof rawType})`);
    } else if (!(FLOW_TRIGGER_TYPES as readonly string[]).includes(rawType)) {
      throw new Error(
        `unknown flow trigger type "${rawType}" — allowed: ${FLOW_TRIGGER_TYPES.join(", ")}`,
      );
    } else {
      type = rawType as (typeof FLOW_TRIGGER_TYPES)[number];
    }
    const out: Record<string, unknown> = { type };
    if (type === "schedule" && typeof rec.interval_min === "number" && rec.interval_min > 0) {
      out.interval_min = rec.interval_min;
    }
    // the hook's JSONata filter applies on every trigger type — webhook
    // deliveries are always an available start lever (never removed with the
    // template's trigger type)
    if (typeof rec.filter === "string") out.filter = rec.filter;
    // the binding feeds auto-starts (schedule fires, webhook deliveries
    // without a `repo` key in the payload): kept whenever a valid id is present
    if (typeof rec.repoId === "string" && rec.repoId.trim()) out.repoId = rec.repoId.trim();
    out.taskType = TemplateStore.validTaskType(rec.taskType);
    return out;
  }

  /** A registered provider kind, or the default (first registration) when absent/unknown. */
  private static validTaskType(v: unknown): string {
    const kind = typeof v === "string" ? v.trim() : "";
    if (kind && taskRegistry.has(kind)) return kind;
    return taskRegistry.first()?.kind ?? NO_TASK_TYPE;
  }

  /**
   * The {{task.*}} lint universe for a normalized trigger: the declared task
   * type's provider contextFields (null when the kind isn't registered — the
   * linter free-passes instead of guessing).
   */
  private static taskUniverse(trigger: Record<string, unknown>): TaskUniverse | null {
    const provider = taskRegistry.maybe(String(trigger.taskType ?? ""));
    if (!provider) return null;
    return { kind: provider.kind, fields: provider.contextFields.map((f) => ({ key: f.key, label: f.label })) };
  }

  private static nodeTrigger(o: unknown): TemplateNodeTrigger {
    const rec = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
    const type = typeof rec.type === "string" && (NODE_TRIGGER_TYPES as readonly string[]).includes(rec.type)
      ? rec.type : "auto";
    // the stored payload keeps the snake_case `wait_for` key (client + seeder
    // format) — carried beside the camelCase TS vocabulary field
    const out: TemplateNodeTrigger & { wait_for?: string } = { type };
    // minutes: the debounced quiet period, or the timer wait for wait_for: timer
    if (typeof rec.minutes === "number" && rec.minutes >= 0) out.minutes = rec.minutes;
    if (typeof rec.wait_for === "string" && (WAIT_FOR_SOURCES as readonly string[]).includes(rec.wait_for)) {
      out.wait_for = rec.wait_for;
    }
    return out;
  }

  private static slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  }

  /**
   * A template-local create's key: the slug when no row owns it, else the
   * first free `…_local` / `…_localN` variant (UNIQUE(key, version) is
   * table-wide). Exhausted variants fall back to the slug — the caller's
   * uniqueness check then reports the collision.
   */
  private static async freeKeyVariant(slug: string): Promise<string> {
    if (!(await db.prisma.nodeTemplate.findFirst({ where: { key: slug }, select: { key: true } }))) return slug;
    for (let n = 1; n < 500; n++) {
      const variant = n === 1 ? `${slug}_local` : `${slug}_local${n}`;
      if (!(await db.prisma.nodeTemplate.findFirst({ where: { key: variant }, select: { key: true } }))) return variant;
    }
    return slug;
  }
}
