/** Shared draft types for the template editor + node configurator. */
export interface EditorNode {
  /** instance key — unique in the template */
  key: string;
  /** the node_templates row backing this instance */
  nodeTemplateId: string;
  /** the backing row's catalog key ("plan", "start", …) — builtin fan-out
   *  gating checks it (isPlanNode) the same way the save-time lint does */
  catalogKey?: string | null;
  label: string;
  overrideLabel?: string | null;
  trigger: { type: string; minutes?: number; wait_for?: string };
  join_mode: string;
  config: Record<string, unknown>;
  input_map: Record<string, unknown>;
  kind: string | null;
  icon: string | null;
  catalog_name: string | null;
  is_builtin: boolean;
  description?: string | null;
  /** the backing node_templates row is private to this template (the canvas
   *  creator's rows) — not yet promoted to the shared Library */
  isLocal?: boolean;
}

/** Partial node patch, or a functional patch from the current node row. */
export type EditorNodePatch =
  | Partial<EditorNode>
  | ((node: EditorNode) => Partial<EditorNode>);

export const resolveEditorNodePatch = (
  node: EditorNode,
  patch: EditorNodePatch,
): EditorNode => {
  const partial = typeof patch === "function" ? patch(node) : patch;
  return { ...node, ...partial };
};

export interface EditorEdge {
  from: string;
  to: string;
  kind: string;
  label: string | null;
  condition: string | null;
}

/**
 * A draft declarative node template (Phase 2): the palette's kind tiles place
 * in-memory instances backed by `nodeTemplateId: "draft:<n>"` — the def rides
 * in the draft's `pendingDefs` and becomes a persisted `node_templates` row
 * only when the template is Saved (PATCH `new_node_templates`).
 */
export interface DraftNodeDef {
  /** `draft:<n>` — matches the referencing instances' nodeTemplateId */
  draftId: string;
  kind: string;
  name: string;
  icon: string | null;
  description: string | null;
  config: Record<string, unknown>;
}

/** Draft ids are reserved by the save contract — never a real row id. */
export function isDraftNodeTemplateId(nodeTemplateId: string): boolean {
  return nodeTemplateId.startsWith("draft:");
}

/**
 * URL for /api/contracts for a node instance. Draft instances have no catalog
 * row yet — their contract is synthesized from the declarative kind + the
 * instance config (`?kind=agent&config={…}`). Everything else resolves the
 * catalog row (`?def=nt_…`). The instance config always rides along: the
 * contract merges it over the def (start fields, choice overrides, …).
 */
export function contractsUrl(node: {
  nodeTemplateId: string;
  kind: string | null;
  catalog_name?: string | null;
  config?: Record<string, unknown> | null;
}): string {
  const p = new URLSearchParams();
  if (isDraftNodeTemplateId(node.nodeTemplateId)) {
    p.set("kind", node.kind ?? "agent");
    if (node.catalog_name) p.set("name", node.catalog_name);
  } else {
    p.set("def", node.nodeTemplateId);
  }
  const cfg = node.config && Object.keys(node.config).length ? node.config : null;
  if (cfg) p.set("config", JSON.stringify(cfg));
  return `/api/contracts?${p.toString()}`;
}

/**
 * URL for /api/contracts for a declarative kind with no row at all — the
 * Template Nodes page's create dialog synthesizes the kind's full field
 * list from the runtime class against the given config (same machinery the
 * draft instances use, just without a placement behind it).
 */
export function kindContractUrl(kind: string, config?: unknown): string {
  const p = new URLSearchParams({ kind });
  if (
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    Object.keys(config).length
  ) {
    p.set("config", JSON.stringify(config));
  }
  return `/api/contracts?${p.toString()}`;
}

/** A /api/contracts response. */
export interface NodeContract {
  key: string;
  label: string;
  kind: string;
  /** the contract's JSON-Schema fragments (object/properties form when declared) */
  input: unknown;
  output: unknown;
  /** decision nodes: the branch labels out-edges must carry (§4.3) */
  choices?: { label: string; description?: string; condition?: string }[];
  /**
   * Built-ins only: the def's prompt templates as unrendered three-part
   * sections (body / locked rules / locked output contract) — the Prompt
   * tab's reference data. Absent for declarative kinds (their prompts are
   * free-standing, no split).
   */
  prompt?: {
    key: string;
    label: string;
    description: string;
    variables: string[];
    body: string;
    engineRules: string;
    outputContract: string;
  }[];
  config: {
    fields?: {
      key: string;
      label: string;
      type: string;
      help?: string;
      options?: { value: string; label: string; description?: string }[];
      optionIcons?: Record<string, string>;
      /** string fields: clearing writes an explicit null override */
      nullable?: boolean;
    }[];
    defaults?: Record<string, unknown>;
  };
}

/** A registered task provider (GET /api/tasks/providers) — the Task context
 *  panel's type picker and the {{task.*}} chip vocabulary across the editor. */
export interface TaskProviderInfo {
  kind: string;
  label: string;
  configured: boolean;
  contextFields: { key: string; label: string; type: string; required?: boolean }[];
}

/** Display label used everywhere: override wins, then catalog name, then key. */
export function nodeLabel(n: Pick<EditorNode, "key" | "overrideLabel" | "catalog_name">): string {
  return n.overrideLabel || n.catalog_name || n.key;
}

/**
 * A builtin plan node - the only kind that publishes plan-meta / the
 * plan_steps checklist (the fanout expansion's source; the save-time lint's
 * fan-out rule 1 requires exactly this shape). Mirrors isStartNode's
 * id-or-name check: the seeded row plus any future builtin "plan" row.
 */
export function isPlanNode(n: EditorNode): boolean {
  return (
    Boolean(n.is_builtin) &&
    (n.nodeTemplateId === "nt_plan" ||
      n.catalogKey === "plan" ||
      (n.catalog_name ?? "").toLowerCase() === "plan")
  );
}

/**
 * Fan-out gating (the save-time lint's rule 1, mirrored for the editor UI):
 * is `key` reachable from any plan node through `next` edges - direct or
 * transitively? Only `next` edges count (they carry execution flow; loop
 * edges re-trigger and don't join the reachability graph, same as the lint).
 */
export function isPlanDownstream(
  nodes: EditorNode[],
  edges: EditorEdge[],
  key: string,
): boolean {
  const upstream = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "next") continue;
    upstream.set(e.to, [...(upstream.get(e.to) ?? []), e.from]);
  }
  const seen = new Set([key]);
  const queue = [key];
  while (queue.length) {
    const k = queue.shift();
    if (k === undefined) break;
    for (const from of upstream.get(k) ?? []) {
      if (seen.has(from)) continue;
      seen.add(from);
      queue.push(from);
    }
  }
  return nodes.some((n) => isPlanNode(n) && n.key !== key && seen.has(n.key));
}

/** Connection-derived relationships for one node (sidebar + configurator Inputs tab). */
export interface NodeRelationships {
  incoming: EditorEdge[];
  outgoing: EditorEdge[];
  /** no edge points at this node — it starts its own branch and carries the
   *  trigger ("entry node" — a relationship, not the Start catalog instance,
   *  which is the one `nt_start` row per template) */
  isEntry: boolean;
  /** no edges at all — needs a connection before it can be configured */
  isolated: boolean;
}

/**
 * Connection semantics of the builder:
 *  - a node with no incoming edges is an **entry node** — its trigger defines
 *    when its branch begins ("triggered branch");
 *  - every other node must be reached by an edge; a node with no edges at all
 *    is flagged isolated and can't be configured until it's wired in.
 */
export function nodeRelationships(nodes: EditorNode[], edges: EditorEdge[]): Record<string, NodeRelationships> {
  const map: Record<string, NodeRelationships> = {};
  for (const n of nodes) map[n.key] = { incoming: [], outgoing: [], isEntry: true, isolated: true };
  for (const e of edges) {
    if (map[e.to]) { map[e.to].incoming.push(e); map[e.to].isolated = false; map[e.to].isEntry = false; }
    if (map[e.from]) { map[e.from].outgoing.push(e); map[e.from].isolated = false; }
  }
  return map;
}

export function describeTrigger(t: { type: string; minutes?: number; wait_for?: string }): string {
  const bits: string[] = [t.type];
  if (t.type === "debounced" && t.minutes != null) bits.push(`${t.minutes} min`);
  if (t.wait_for) bits.push(`waits ${t.wait_for}`);
  return bits.join(" · ");
}
