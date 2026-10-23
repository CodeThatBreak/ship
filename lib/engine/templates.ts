import { db } from "../db";
import {
  FlowTemplateRow,
  NodeTemplateRow,
  rows,
  type TemplateNodeTrigger,
} from "../db/rows";

/** Seeded built-in template — the SDLC loop (plan → build → pipeline → review → resolve). */
export const SDLC_TEMPLATE_ID = "tpl_sdlc_loop";

/** Flow-level trigger types (webhook/schedule wiring arrives with Phase 4). */
export const FLOW_TRIGGER_TYPES = ["manual", "webhook", "schedule"] as const;
/** Per-node trigger types (debounced + wait_for wiring is engine-supported). */
export const NODE_TRIGGER_TYPES = ["auto", "manual", "approval", "debounced"] as const;
/** wait_for event sources supported by the engine today. */
export const WAIT_FOR_SOURCES = ["gitlab_pipeline", "gitlab_comments"] as const;

const KINDED_NODE_TEMPLATE_KINDS = ["agent", "http", "script", "decision"] as const;
export type DeclarativeNodeKind = (typeof KINDED_NODE_TEMPLATE_KINDS)[number];

// ── input shapes for the CRUD surface (UI editor + YAML import) ──────────────

export interface TemplateNodeInput {
  key: string;
  /** existing node_templates row id; instances of catalog nodes reference this */
  nodeTemplateId: string;
  label?: string | null;
  trigger?: Record<string, unknown>;
  join_mode?: string;
  config?: Record<string, unknown>;
  input_map?: Record<string, unknown>;
  x?: number | null;
  y?: number | null;
}

export interface TemplateEdgeInput {
  from: string;
  to: string;
  kind?: "next" | "loop";
  label?: string | null;
  condition?: string | null;
}

export interface TemplateInput {
  name?: string;
  description?: string | null;
  trigger?: Record<string, unknown>;
  nodes: TemplateNodeInput[];
  edges: TemplateEdgeInput[];
}

/**
 * A template instance node: the runtime-visible slice of a flow_template_nodes
 * row. `defKey` resolves the executable NodeDefinition (the node_templates key
 * for built-ins).
 */
export interface TemplateNodeSpec {
  /** instance key — unique per template; also the flow's `nodes.node_key` */
  key: string;
  /** node template key used for def resolution (e.g. "plan") */
  defKey: string;
  nodeTemplateId: string;
  /** display label (template override or the node template's own name) */
  label: string;
  joinMode: "all" | "any";
  /** config knob overrides from the template */
  config: Record<string, unknown>;
  /** event-wait wiring on this node ({type: auto|manual|approval|debounced, minutes?, wait_for?}) */
  trigger: TemplateNodeTrigger;
  /** per-field JSONata expressions (Phase 3 — carried but unevaluated in Phase 1) */
  inputMap: Record<string, unknown>;
}

export interface TemplateEdgeSpec {
  from: string;
  to: string;
  kind: "next" | "loop";
  /** decision edge label (Phase 3) */
  label: string | null;
  /** optional JSONata condition (Phase 3) */
  condition: string | null;
}

export interface TemplateGraph {
  templateId: string;
  version: number;
  /** flow trigger ({type: manual|webhook|schedule, ...}) */
  flowTrigger: Record<string, unknown>;
  /** nodes in template order (create order = display order) */
  nodes: TemplateNodeSpec[];
  edges: TemplateEdgeSpec[];
  byKey: Map<string, TemplateNodeSpec>;
}

/**
 * The runtime role of a template node — what the UI (graph, configurator) and
 * the def resolver need about the underlying catalog entry.
 */
export interface TemplateNodeMeta {
  /** node_templates row id (the def key for declarative kinds) */
  nodeTemplateId: string;
  /** catalog key (built-ins use NODE_KEYS values) */
  catalogKey: string;
  kind: string;
  /** lucide icon name for the graph editor */
  icon: string | null;
  name: string;
  isBuiltin: boolean;
}

/**
 * Design-time template store: reads flow templates (+ their node instances and
 * edges) and resolves the runtime roles the engine needs from that graph
 * instead of node-key constants.
 *
 * Phase 1: templates were seeded only. Phase 2 adds the full CRUD surface the
 * UI builder and YAML import/export drive — create/duplicate/update/delete
 * (meta + node instances + edges), plus declarative node-template CRUD
 * (kind=agent; http/script/decision arrive with Phase 3).
 */
export class TemplateStore {
  /** Load a template's graph, or null when the template does not exist. */
  graph(templateId: string): TemplateGraph | null {
    const tpl = db.get<{ version: number; trigger: string | null }>(
      `SELECT version, trigger FROM flow_templates WHERE id=?`, templateId
    );
    if (!tpl) return null;

    const nodes = db.all<Record<string, unknown>>(
      `SELECT n.id, n.node_key, n.node_template_id, n.label, n.trigger, n.join_mode, n.config, n.input_map,
              nt.key AS def_key, nt.id AS nt_id, nt.kind AS nt_kind, nt.icon AS nt_icon,
              nt.name AS nt_name, nt.is_builtin AS nt_builtin
       FROM flow_template_nodes n JOIN node_templates nt ON nt.id = n.node_template_id
       WHERE n.template_id=? ORDER BY n.rowid`,
      templateId
    ).map((r) => {
      // Built-ins resolve their NodeDefinition by registry key; declarative
      // kinds (agent, …) resolve by the node_templates row id so the registry
      // can hydrate a runtime instance per catalog entry.
      const defKey = r.nt_builtin ? (r.def_key as string) : (r.nt_id as string);
      const spec: TemplateNodeSpec = {
        key: r.node_key as string,
        defKey,
        nodeTemplateId: r.node_template_id as string,
        label: (r.label as string | null) ?? (r.nt_name as string),
        joinMode: (r.join_mode as "all" | "any") === "any" ? "any" : "all",
        config: TemplateStore.parseJson<Record<string, unknown>>(r.config as string, {}),
        trigger: TemplateStore.parseTrigger(TemplateStore.parseJson<Record<string, unknown>>(r.trigger as string, {})),
        inputMap: TemplateStore.parseJson<Record<string, unknown>>(r.input_map as string, {}),
      };
      return spec;
    });

    const edges = db.all<Record<string, unknown>>(
      `SELECT from_key, to_key, kind, label, condition
       FROM flow_template_edges WHERE template_id=?`,
      templateId
    ).map((r) => ({
      from: r.from_key as string,
      to: r.to_key as string,
      kind: (r.kind as "next" | "loop") === "loop" ? "loop" as const : "next" as const,
      label: (r.label as string | null) ?? null,
      condition: (r.condition as string | null) ?? null,
    }));

    return {
      templateId,
      version: tpl.version,
      flowTrigger: TemplateStore.parseJson<Record<string, unknown>>(tpl.trigger, { type: "manual" }),
      nodes,
      edges,
      byKey: new Map(nodes.map((n) => [n.key, n])),
    };
  }

  /**
   * The graph a flow instance was snapshotted from. Flows always carry their
   * template id (legacy rows are backfilled at migration time; scripts that
   * create rows directly fall back to the seeded SDLC loop).
   */
  graphForFlow(flowId: string): TemplateGraph | null {
    const tid = db.get<{ template_id: string | null }>(
      `SELECT template_id FROM flows WHERE id=?`, flowId
    )?.template_id ?? null;
    return this.graph(tid ?? SDLC_TEMPLATE_ID);
  }

  /**
   * The node instance the flow waits on for a given event source — the
   * role-based replacement for the `node_key='pipeline'` lookups the poller
   * and GitLab webhook made directly.
   */
  waitNodeKey(flowId: string, eventSource: string): string | null {
    const g = this.graphForFlow(flowId);
    if (!g) return null;
    return g.nodes.find((n) => (n.trigger as TemplateNodeTrigger | undefined)?.wait_for === eventSource)?.key ?? null;
  }

  /**
   * The post-MR chain: the wait-node plus every downstream node reachable via
   * `next` edges whose trigger is automatic (auto/debounced). Today's
   * chainBusy guard covered pipeline|review|resolve — this is the same set,
   * derived from the template instead of constants.
   */
  chainNodeKeys(flowId: string): string[] {
    const g = this.graphForFlow(flowId);
    if (!g) return [];
    const head = g.nodes.find((n) => (n.trigger as TemplateNodeTrigger | undefined)?.wait_for === "gitlab_pipeline");
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

  /** All templates, newest first, with instance counts for the gallery. */
  list(): (FlowTemplateRow & { nodeCount: number })[] {
    const templates = rows.all(FlowTemplateRow,
      `SELECT * FROM flow_templates ORDER BY rowid`);
    return templates.map((t) => ({
      ...t,
      nodeCount: db.get<{ c: number }>(
        `SELECT COUNT(*) c FROM flow_template_nodes WHERE template_id=?`, t.id)?.c ?? 0,
    }));
  }

  /** One template row (or undefined). */
  flowTemplate(id: string): FlowTemplateRow | undefined {
    return rows.get(FlowTemplateRow, `SELECT * FROM flow_templates WHERE id=?`, id);
  }

  /** Create a template (meta + node instances + edges). Validates the graph. */
  create(input: TemplateInput, opts: { isBuiltin?: boolean; id?: string } = {}): string {
    const { nodes, edges, trigger } = this.validated(input);
    const id = opts.id ?? db.uid("tpl_");
    const ts = db.now();
    db.run(
      `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, input.name?.trim() || "Untitled template", input.description ?? null,
      1, opts.isBuiltin ? 1 : 0, JSON.stringify(trigger), ts, ts
    );
    this.writeNodesAndEdges(id, nodes, edges);
    return id;
  }

  /** Copy a template — id/name regenerated, node instances + edges cloned. */
  duplicate(templateId: string, name?: string): string {
    const src = this.flowTemplate(templateId);
    if (!src) throw new Error("template not found");
    const graph = this.graph(templateId);
    if (!graph) throw new Error("template not found");
    return this.create({
      name: name?.trim() || `${src.name} copy`,
      description: src.description,
      trigger: graph.flowTrigger,
      nodes: graph.nodes.map((n) => ({
        key: n.key,
        nodeTemplateId: n.nodeTemplateId,
        label: n.label,
        trigger: n.trigger as unknown as Record<string, unknown>,
        join_mode: n.joinMode,
        config: n.config,
        input_map: n.inputMap,
      })),
      edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label, condition: e.condition })),
    });
  }

  /**
   * Update a template. Node/edge arrays, when present, replace the existing
   * ones wholesale (the editor sends its full draft); otherwise only the
   * meta fields are touched. Running flows snapshot at creation and are never
   * affected by template edits.
   */
  update(templateId: string, patch: Partial<TemplateInput>): void {
    if (!this.flowTemplate(templateId)) throw new Error("template not found");
    this.assertEditable(templateId);
    if (patch.name !== undefined || patch.description !== undefined || patch.trigger !== undefined) {
      const cur = this.flowTemplate(templateId)!;
      db.run(
        `UPDATE flow_templates SET name=?, description=?, trigger=?, updated_at=? WHERE id=?`,
        patch.name?.trim() || cur.name,
        patch.description !== undefined ? patch.description : cur.description,
        patch.trigger !== undefined
          ? JSON.stringify(TemplateStore.flowTrigger(patch.trigger))
          : cur.trigger,
        db.now(), templateId
      );
    }
    if (patch.nodes !== undefined && patch.edges !== undefined) {
      const { nodes, edges } = this.validated({ name: patch.name, nodes: patch.nodes, edges: patch.edges });
      this.assertNotRunning(templateId);
      this.writeNodesAndEdges(templateId, nodes, edges, { replace: true });
    } else if (patch.nodes !== undefined || patch.edges !== undefined) {
      throw new Error("nodes and edges must be replaced together");
    }
  }

  /** Delete a template (built-ins are protected; in-use templates are locked). */
  delete(templateId: string): void {
    this.assertEditable(templateId);
    const used = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM flows WHERE template_id=?`, templateId)?.c ?? 0;
    if (used > 0) {
      throw new Error(`this template is used by ${used} flow${used > 1 ? "s" : ""} — delete the flows first`);
    }
    db.run(`DELETE FROM flow_template_nodes WHERE template_id=?`, templateId);
    db.run(`DELETE FROM flow_template_edges WHERE template_id=?`, templateId);
    db.run(`DELETE FROM flow_templates WHERE id=?`, templateId);
  }

  /** Built-in seeded templates (the SDLC loop) can be duplicated, not edited. */
  assertEditable(templateId: string): void {
    const t = this.flowTemplate(templateId);
    if (!t) throw new Error("template not found");
    if (t.is_builtin) throw new Error("the built-in template is read-only — duplicate it to make changes");
  }

  /** Structural edits are refused while flows are running on a live snapshot —
   *  snapshots are safe, but refusing keeps the editor honest about run state. */
  private assertNotRunning(templateId: string): void {
    const active = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM flows WHERE template_id=? AND status='active'`, templateId)?.c ?? 0;
    if (active > 0) {
      throw new Error(`${active} flow${active > 1 ? "s are" : " is"} active on this template — cancel/finish them before restructuring`);
    }
  }

  // ── node-template (catalog) CRUD ──────────────────────────────────────────

  /** The node-type catalog, grouped for the configurator palette. */
  listNodeTemplates(): NodeTemplateRow[] {
    return rows.all(NodeTemplateRow, `SELECT * FROM node_templates ORDER BY is_builtin DESC, rowid`);
  }

  nodeTemplate(id: string): NodeTemplateRow | undefined {
    return rows.get(NodeTemplateRow, `SELECT * FROM node_templates WHERE id=?`, id);
  }

  nodeTemplateByKey(key: string): NodeTemplateRow | undefined {
    return rows.get(NodeTemplateRow, `SELECT * FROM node_templates WHERE key=?`, key);
  }

  /**
   * Create a declarative (user-defined) node template. Phase 2 supports the
   * `agent` kind; `http`/`script`/`decision` arrive with Phase 3.
   */
  createNodeTemplate(input: {
    key?: string; name: string; kind: string; icon?: string | null;
    description?: string | null; config: Record<string, unknown>;
  }): NodeTemplateRow {
    const kind = (input.kind ?? "").trim();
    if (!(KINDED_NODE_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`unsupported node kind "${kind}" — declarative kinds: ${KINDED_NODE_TEMPLATE_KINDS.join(", ")}`);
    }
    if (kind !== "agent") {
      throw new Error(`the "${kind}" node kind ships with Phase 3 — not yet creatable`);
    }
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const key = TemplateStore.slugify(input.key?.trim() || name);
    if (this.nodeTemplateByKey(key)) {
      throw new Error(`node template key "${key}" already exists`);
    }
    // a declarative key must not shadow a built-in component (the registry
    // resolves built-ins first)
    const builtinKey = db.get<{ key: string }>(
      `SELECT key FROM node_templates WHERE key=? AND is_builtin=1`, key
    );
    if (builtinKey) throw new Error(`"${key}" is a built-in node key — pick another name`);
    const id = db.uid("nt_");
    const ts = db.now();
    db.run(
      `INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
       VALUES (?,?,?,?,1,?,?,?,0,?,?)`,
      id, key, name, kind, input.description ?? null, input.icon ?? null,
      JSON.stringify(input.config ?? {}), ts, ts
    );
    return this.nodeTemplate(id)!;
  }

  /** Update a declarative node template (never built-ins). */
  updateNodeTemplate(id: string, patch: {
    name?: string; description?: string | null; icon?: string | null; config?: Record<string, unknown>;
  }): NodeTemplateRow {
    const row = this.nodeTemplate(id);
    if (!row) throw new Error("node template not found");
    if (row.is_builtin) throw new Error("built-in node templates are read-only");
    db.run(
      `UPDATE node_templates SET name=?, description=?, icon=?, config=?, updated_at=? WHERE id=?`,
      patch.name?.trim() || row.name,
      patch.description !== undefined ? patch.description : row.description,
      patch.icon !== undefined ? patch.icon : row.icon,
      patch.config !== undefined ? JSON.stringify(patch.config) : JSON.stringify(row.config),
      db.now(), id
    );
    return this.nodeTemplate(id)!;
  }

  /**
   * Find-or-create a declarative node template — the YAML import path:
   * a re-imported definition reuses its existing row (same kind + identical
   * config); a changed definition becomes a new version of the same key.
   */
  ensureNodeTemplate(input: {
    key?: string; name: string; kind: string; icon?: string | null; config: Record<string, unknown>;
  }): string {
    const kind = (input.kind ?? "").trim();
    if (!(KINDED_NODE_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`unsupported node kind "${kind}"`);
    }
    if (kind !== "agent") {
      throw new Error(`the "${kind}" node kind ships with Phase 3 — update the template before importing`);
    }
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const key = TemplateStore.slugify(input.key?.trim() || name);
    if (db.get<{ key: string }>(`SELECT key FROM node_templates WHERE key=? AND is_builtin=1`, key)) {
      throw new Error(`"${key}" is a built-in node key — pick another name`);
    }
    const candidates = rows.all(NodeTemplateRow,
      `SELECT * FROM node_templates WHERE key=? AND is_builtin=0`, key);
    const identical = candidates.find(
      (r) => r.kind === kind && JSON.stringify(r.config ?? {}) === JSON.stringify(input.config ?? {})
    );
    if (identical) return identical.id;
    const version = candidates.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const id = db.uid("nt_");
    const ts = db.now();
    db.run(
      `INSERT INTO node_templates (id,key,name,kind,version,description,icon,config,is_builtin,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
      id, key, name, kind, version, null, input.icon ?? null,
      JSON.stringify(input.config ?? {}), ts, ts
    );
    return id;
  }

  /** Delete a declarative node template when no template instance references it. */
  deleteNodeTemplate(id: string): void {
    const row = this.nodeTemplate(id);
    if (!row) throw new Error("node template not found");
    if (row.is_builtin) throw new Error("built-in node templates are read-only");
    const used = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM flow_template_nodes WHERE node_template_id=?`, id)?.c ?? 0;
    if (used > 0) throw new Error(`this node template is used by ${used} template node${used > 1 ? "s" : ""}`);
    db.run(`DELETE FROM node_templates WHERE id=?`, id);
  }

  // ── write path helpers ────────────────────────────────────────────────────

  /** Validate name/trigger/graph invariants, returning normalized inputs. */
  private validated(input: TemplateInput): {
    trigger: Record<string, unknown>;
    nodes: TemplateNodeInput[];
    edges: TemplateEdgeInput[];
  } {
    if (!Array.isArray(input.nodes)) {
      throw new Error("a template needs a nodes array");
    }
    const keys = new Set<string>();
    for (const n of input.nodes) {
      const key = (n.key ?? "").trim();
      if (!/^[a-z][a-z0-9_]*$/i.test(key)) throw new Error(`invalid node key "${key}" (letters, digits, underscores)`);
      if (keys.has(key)) throw new Error(`duplicate node key "${key}"`);
      if (!n.nodeTemplateId?.trim()) throw new Error(`node "${key}" is missing its node template`);
      if (!this.nodeTemplate(n.nodeTemplateId)) throw new Error(`unknown node template for "${key}"`);
      // built-in components are singletons per template (their class-owned
      // internals key lookups on the builtin key) — instance key must match
      const nt = this.nodeTemplate(n.nodeTemplateId)!;
      if (nt.is_builtin && key !== nt.key) {
        throw new Error(`built-in "${nt.name}" instances must use the key "${nt.key}"`);
      }
      keys.add(key);
    }
    const edges: TemplateEdgeInput[] = [];
    const seen = new Set<string>();
    for (const e of input.edges ?? []) {
      if (!keys.has(e.from)) throw new Error(`edge from unknown node "${e.from}"`);
      if (!keys.has(e.to)) throw new Error(`edge to unknown node "${e.to}"`);
      if (e.from === e.to) throw new Error(`self-edge on "${e.from}"`);
      const kind = e.kind === "loop" ? "loop" : "next";
      const label = e.label?.trim() || null;
      const dedupe = `${e.from}>${e.to}:${label ?? ""}`;
      if (seen.has(dedupe)) throw new Error(`duplicate edge ${e.from} → ${e.to}${label ? ` (${label})` : ""}`);
      seen.add(dedupe);
      edges.push({ from: e.from, to: e.to, kind, label, condition: e.condition?.trim() || null });
    }
    return { trigger: TemplateStore.flowTrigger(input.trigger), nodes: input.nodes, edges };
  }

  /** Write node instances and edges for a template id (optionally replacing). */
  private writeNodesAndEdges(
    templateId: string,
    nodes: TemplateNodeInput[],
    edges: TemplateEdgeInput[],
    opts: { replace?: boolean } = {},
  ): void {
    if (opts.replace) {
      db.run(`DELETE FROM flow_template_nodes WHERE template_id=?`, templateId);
      db.run(`DELETE FROM flow_template_edges WHERE template_id=?`, templateId);
    }
    const ts = db.now();
    for (const n of nodes) {
      const trigger = JSON.stringify(TemplateStore.nodeTrigger(n.trigger));
      const config = JSON.stringify(n.config && Object.keys(n.config).length ? n.config : {});
      const inputMap = JSON.stringify(n.input_map && Object.keys(n.input_map).length ? n.input_map : {});
      db.run(
        `INSERT OR REPLACE INTO flow_template_nodes (id,template_id,node_key,node_template_id,label,trigger,join_mode,config,input_map,x,y,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        db.uid("ftn_"), templateId, n.key.trim(), n.nodeTemplateId, n.label ?? null, trigger,
        n.join_mode === "any" ? "any" : "all", config, inputMap, n.x ?? null, n.y ?? null, ts, ts
      );
    }
    for (const e of edges) {
      db.run(
        `INSERT OR REPLACE INTO flow_template_edges (id,template_id,from_key,to_key,kind,label,condition,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        db.uid("fte_"), templateId, e.from, e.to, e.kind ?? "next", e.label, e.condition, ts, ts
      );
    }
    db.run(`UPDATE flow_templates SET updated_at=? WHERE id=?`, ts, templateId);
  }

  private static flowTrigger(o: unknown): Record<string, unknown> {
    const rec = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
    const type = typeof rec.type === "string" && (FLOW_TRIGGER_TYPES as readonly string[]).includes(rec.type)
      ? rec.type : "manual";
    const out: Record<string, unknown> = { type };
    if (type === "schedule" && typeof rec.interval_min === "number") out.interval_min = rec.interval_min;
    if (type === "webhook" && typeof rec.filter === "string") out.filter = rec.filter;
    return out;
  }

  private static nodeTrigger(o: unknown): TemplateNodeTrigger {
    const rec = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
    const type = typeof rec.type === "string" && (NODE_TRIGGER_TYPES as readonly string[]).includes(rec.type)
      ? rec.type : "auto";
    const out: TemplateNodeTrigger = { type };
    if (type === "debounced" && typeof rec.minutes === "number" && rec.minutes >= 0) out.minutes = rec.minutes;
    if (typeof rec.wait_for === "string" && (WAIT_FOR_SOURCES as readonly string[]).includes(rec.wait_for)) {
      out.wait_for = rec.wait_for;
    }
    return out;
  }

  private static slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  }

  private static parseJson<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== "string") return raw as T ?? fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private static parseTrigger(o: Record<string, unknown>): TemplateNodeTrigger {
    return {
      type: (typeof o.type === "string" ? o.type : "auto"),
      minutes: typeof o.minutes === "number" ? o.minutes : undefined,
      wait_for: typeof o.wait_for === "string" ? o.wait_for : undefined,
    };
  }
}

/** Shared application template store. */
export const templateStore = new TemplateStore();
