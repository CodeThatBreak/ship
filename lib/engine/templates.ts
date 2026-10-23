import { db } from "../db";
import type { TemplateNodeTrigger } from "../db/rows";

/** Seeded built-in template — the SDLC loop (plan → build → pipeline → review → resolve). */
export const SDLC_TEMPLATE_ID = "tpl_sdlc_loop";

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
 * Design-time template store: reads flow templates (+ their node instances and
 * edges) and resolves the runtime roles the engine needs from that graph
 * instead of node-key constants.
 *
 * Phase 1: templates are seeded only (SDLC loop); the engine derives every
 * previously-hardcoded chain position ("pipeline"/"review"/"resolve") from the
 * template graph so flow.ts stays node-key-free. CRUD + instantiations beyond
 * the default snapshot arrive with the Phase 2 UI.
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
              nt.key AS def_key, nt.name AS nt_name
       FROM flow_template_nodes n JOIN node_templates nt ON nt.id = n.node_template_id
       WHERE n.template_id=? ORDER BY n.rowid`,
      templateId
    ).map((r) => {
      const spec: TemplateNodeSpec = {
        key: r.node_key as string,
        defKey: r.def_key as string,
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
