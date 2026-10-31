import "server-only";

import YAML from "yaml";
import { db } from "../../db";

/**
 * Config-as-code for flow templates (§7 YAML form). Export writes each node as
 * `key / type / trigger / join_mode / (label) / config` with inline-config for
 * declarative kinds (the effective definition) and `builtin/<key>` references
 * for built-ins; import resolves `type` back to catalog rows, creating missing
 * declarative node templates (agent in Phase 2; decision / http / script in
 * Phase 3) via find-or-create on the effective definition.
 */
export const DECLARATIVE_KINDS = ["agent", "http", "script", "decision"] as const;

export class YamlTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlTemplateError";
  }
}

interface YamlNodeEntry {
  key: string;
  type: string;
  label?: string;
  trigger?: Record<string, unknown>;
  join_mode?: string;
  config?: Record<string, unknown>;
  input_map?: Record<string, unknown>;
}

/** Export a stored template as YAML (plan §7 shape). */
export function exportTemplateYaml(
  data: {
    name: string;
    description: string | null;
    trigger: Record<string, unknown>;
    nodes: {
      key: string;
      nodeTemplateId: string;
      label: string;
      trigger: unknown;
      joinMode: string;
      config: Record<string, unknown>;
      inputMap: Record<string, unknown>;
    }[];
    edges: { from: string; to: string; kind: "next" | "loop"; label: string | null; condition: string | null }[];
    /** node_templates rows: id → {key, name, kind, is_builtin, config} */
    catalog: Record<string, { key: string; name: string; kind: string; isBuiltin: boolean; config: Record<string, unknown> }>;
  },
): string {
  const nodeDocs: YamlNodeEntry[] = [];
  for (const n of data.nodes) {
    const nt = data.catalog[n.nodeTemplateId];
    if (!nt) throw new YamlTemplateError(`unknown node template ${n.nodeTemplateId}`);
    const doc: YamlNodeEntry = {
      key: n.key,
      type: nt.isBuiltin ? `builtin/${nt.key}` : nt.kind,
    };
    if (!nt.isBuiltin) {
      // declarative kinds are authored inline: the effective definition
      // (catalog defaults ← template overrides) so import recreates the node
      doc.config = { ...(nt.config ?? {}), ...(n.config ?? {}) };
    } else if (Object.keys(n.config ?? {}).length) {
      doc.config = n.config;
    }
    const trig = n.trigger as Record<string, unknown> | undefined;
    if (trig && Object.keys(trig).length) doc.trigger = trig;
    if (n.joinMode && n.joinMode !== "all") doc.join_mode = n.joinMode;
    if (Object.keys(n.inputMap ?? {}).length) doc.input_map = n.inputMap;
    nodeDocs.push(doc);
  }

  const doc: Record<string, unknown> = {
    name: data.name,
    ...(data.description ? { description: data.description } : {}),
    trigger: data.trigger,
    nodes: nodeDocs,
  };
  // one stringify pass — the lib then indents every folded/blank line for its
  // actual nesting depth (manual per-node re-indent breaks multi-line prompts)
  let out = YAML.stringify(doc).trimEnd() + "\n";

  // edges as [from, to, {(kind|label|condition)?}] — one inline-flow line each
  // (JSON-style flow maps are valid YAML, so round-trip parsing is exact)
  out += "edges:\n";
  for (const e of data.edges) {
    const opts: Record<string, unknown> = {};
    if (e.kind === "loop") opts.kind = e.kind;
    if (e.label) opts.label = e.label;
    if (e.condition) opts.condition = e.condition;
    const tail = Object.keys(opts).length ? `, ${JSON.stringify(opts)}` : "";
    out += `  - [${JSON.stringify(e.from)}, ${JSON.stringify(e.to)}${tail}]\n`;
  }
  return out.trimEnd() + "\n";
}

/** Parse YAML into a seedable template graph (nodes already typed).
 *  No legacy aliases: a `trigger.ticket_id` pin or a `{{ticket.*}}` ref is
 *  not rewritten — the store's validation rejects unknown refs with a clear
 *  lint error (the runtime context ships only the `task` root). */
export function parseTemplateYaml(text: string): {
  name: string;
  description: string | null;
  trigger: Record<string, unknown>;
  nodes: YamlNodeEntry[];
  edges: { from: string; to: string; kind?: "next" | "loop"; label?: string | null; condition?: string | null }[];
} {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    throw new YamlTemplateError(`invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new YamlTemplateError("the template YAML must be a mapping with name/nodes/edges");
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim()) throw new YamlTemplateError("missing template name");

  if (!Array.isArray(d.nodes) || d.nodes.length === 0) {
    throw new YamlTemplateError("template needs at least one node");
  }
  const nodes: YamlNodeEntry[] = d.nodes.map((n, i) => {
    if (!n || typeof n !== "object" || Array.isArray(n)) {
      throw new YamlTemplateError(`nodes[${i}] must be a mapping`);
    }
    const e = n as Record<string, unknown>;
    if (typeof e.key !== "string" || !e.key.trim()) throw new YamlTemplateError(`nodes[${i}] is missing a key`);
    if (typeof e.type !== "string" || !e.type.trim()) throw new YamlTemplateError(`nodes[${i}] is missing a type`);
    const out: YamlNodeEntry = { key: e.key.trim(), type: e.type.trim() };
    if (typeof e.label === "string" && e.label.trim()) out.label = e.label.trim();
    if (e.trigger && typeof e.trigger === "object" && !Array.isArray(e.trigger)) out.trigger = e.trigger as Record<string, unknown>;
    if (typeof e.join_mode === "string") out.join_mode = e.join_mode;
    if (e.config && typeof e.config === "object" && !Array.isArray(e.config)) out.config = e.config as Record<string, unknown>;
    if (e.input_map && typeof e.input_map === "object" && !Array.isArray(e.input_map)) out.input_map = e.input_map as Record<string, unknown>;
    return out;
  });

  const edges: { from: string; to: string; kind?: "next" | "loop"; label?: string | null; condition?: string | null }[] = [];
  if (d.edges != null) {
    if (!Array.isArray(d.edges)) throw new YamlTemplateError("edges must be an array of [from, to]");
    for (const raw of d.edges) {
      if (!Array.isArray(raw) || raw.length < 2) throw new YamlTemplateError("edges must be [from, to] pairs (optional third options object)");
      const [from, to, opts] = raw as [unknown, unknown, unknown];
      if (typeof from !== "string" || typeof to !== "string") {
        throw new YamlTemplateError("edge endpoints must be node keys");
      }
      const o = (opts ?? {}) as Record<string, unknown>;
      if (opts != null && (typeof o !== "object" || Array.isArray(o))) {
        throw new YamlTemplateError("edge options must be a mapping");
      }
      edges.push({
        from,
        to,
        kind: o.kind === "loop" ? "loop" : o.kind === "next" ? "next" : undefined,
        label: typeof o.label === "string" ? o.label : undefined,
        condition: typeof o.condition === "string" ? o.condition : undefined,
      });
    }
  }

  const trigger = (d.trigger && typeof d.trigger === "object" && !Array.isArray(d.trigger)
    ? d.trigger : { type: "manual" }) as Record<string, unknown>;
  const description = typeof d.description === "string" && d.description.trim() ? d.description.trim() : null;

  return { name: d.name.trim(), description, trigger, nodes, edges };
}

// ── store-bound helpers ──────────────────────────────────────────────────────

/**
 * Apt data for `exportTemplateYaml` from the store: the template's graph plus
 * the node_templates catalog slice it needs.
 */
export function gatherTemplateYaml(
  store: {
    flowTemplate(id: string): { id: string; name: string; description: string | null } | undefined;
    graph(id: string): {
      flowTrigger: unknown;
      nodes: {
        key: string; nodeTemplateId: string; label: string; trigger: unknown;
        joinMode: string; config: Record<string, unknown>; inputMap: Record<string, unknown>;
      }[];
      edges: { from: string; to: string; kind: "next" | "loop"; label: string | null; condition: string | null }[];
    } | null;
    nodeTemplate(id: string): { id: string; key: string; name: string; kind: string; is_builtin: number; config: Record<string, unknown> | null } | undefined;
  },
  templateId: string,
): string {
  const t = store.flowTemplate(templateId);
  if (!t) throw new YamlTemplateError("template not found");
  const g = store.graph(templateId);
  if (!g) throw new YamlTemplateError("template not found");
  const catalog: Record<string, { key: string; name: string; kind: string; isBuiltin: boolean; config: Record<string, unknown> }> = {};
  for (const n of g.nodes) {
    if (catalog[n.nodeTemplateId]) continue;
    const nt = store.nodeTemplate(n.nodeTemplateId);
    if (!nt) throw new YamlTemplateError(`missing node template row ${n.nodeTemplateId}`);
    catalog[nt.id] = { key: nt.key, name: nt.name, kind: nt.kind, isBuiltin: Boolean(nt.is_builtin), config: nt.config ?? {} };
  }
  return exportTemplateYaml({
    name: t.name,
    description: t.description,
    trigger: g.flowTrigger as Record<string, unknown>,
    nodes: g.nodes.map((n) => ({
      key: n.key,
      nodeTemplateId: n.nodeTemplateId,
      label: n.label,
      trigger: n.trigger,
      joinMode: n.joinMode,
      config: n.config,
      inputMap: n.inputMap,
    })),
    edges: g.edges,
    catalog,
  });
}

export interface ImportedTemplate {
  id: string;
  name: string;
  createdNodeTemplateIds: string[];
}

/**
 * Import YAML as a new flow template. `builtin/<key>` references built-ins;
 * a bare declarative kind (`type: agent`) is authored inline — the definition
 * is stored as a new (or reused, when identical) agent node template; a bare
 * declarative key matching an existing catalog row references that row.
 * Validation is the store's: unknown `{{refs}}` / task types / node types
 * reject the import with a clear lint error.
 */
export function importTemplateYaml(
  store: {
    ensureNodeTemplate(input: { key?: string; name: string; kind: string; icon?: string | null; config: Record<string, unknown> }): { id: string; created: boolean };
    nodeTemplateByKey(key: string): { id: string; key: string; is_builtin: number; kind: string } | undefined;
    create(input: {
      name?: string; description?: string | null; trigger?: Record<string, unknown>;
      nodes: {
        key: string; nodeTemplateId: string; label?: string | null; trigger?: Record<string, unknown>;
        join_mode?: string; config?: Record<string, unknown>; input_map?: Record<string, unknown>;
      }[];
      edges: { from: string; to: string; kind?: "next" | "loop"; label?: string | null; condition?: string | null }[];
    }): string;
    deleteNodeTemplate(id: string): void;
  },
  text: string,
  opts: { namePrefix?: string } = {},
): ImportedTemplate {
  return db.transaction(() => importTemplateYamlInner(store, text, opts));
}

function importTemplateYamlInner(
  store: Parameters<typeof importTemplateYaml>[0],
  text: string,
  opts: { namePrefix?: string },
): ImportedTemplate {
  const createdNodeTemplateIds: string[] = [];
  const parsed = parseTemplateYaml(text);
  const nodes = parsed.nodes.map((entry) => {
    let nodeTemplateId: string;
    let overrides: Record<string, unknown> | undefined = entry.config;
    if (entry.type.startsWith("builtin/")) {
      const key = entry.type.slice("builtin/".length).trim();
      const nt = store.nodeTemplateByKey(key);
      if (!nt || !nt.is_builtin) throw new YamlTemplateError(`unknown built-in node "builtin/${key}"`);
      nodeTemplateId = nt.id;
    } else {
      const matchingByKey = store.nodeTemplateByKey(entry.type);
      if (matchingByKey && !matchingByKey.is_builtin) {
        // reference an existing declarative catalog node
        nodeTemplateId = matchingByKey.id;
      } else {
        // inline declarative authoring: config IS the definition
        if ((DECLARATIVE_KINDS as readonly string[]).includes(entry.type)) {
          if (!entry.config || typeof entry.config !== "object" || Object.keys(entry.config).length === 0) {
            throw new YamlTemplateError(`${entry.type} node "${entry.key}" needs inline config (its declarative definition)`);
          }
          const ensured = store.ensureNodeTemplate({
            key: entry.key,
            name: entry.label ?? entry.key,
            kind: entry.type,
            config: entry.config,
          });
          nodeTemplateId = ensured.id;
          if (ensured.created) createdNodeTemplateIds.push(ensured.id);
          overrides = {};
        } else {
          throw new YamlTemplateError(
            `unknown node type "${entry.type}" for node "${entry.key}" (builtin/<key>, an existing declarative node key, or a declarative kind)`);
        }
      }
    }
    return {
      key: entry.key,
      nodeTemplateId,
      label: entry.label ?? null,
      trigger: entry.trigger,
      join_mode: entry.join_mode,
      config: overrides,
      input_map: entry.input_map,
    };
  });

  const name = `${opts.namePrefix ? `${opts.namePrefix} — ` : ""}${parsed.name}`;
  const id = store.create({ name, description: parsed.description, trigger: parsed.trigger, nodes, edges: parsed.edges });
  return { id, name, createdNodeTemplateIds };
}
