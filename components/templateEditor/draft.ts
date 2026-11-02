/**
 * The editor's draft model (§8 Phase 5): the in-memory template graph the
 * canvas/drawers edit until Save replaces the server's graph wholesale, plus
 * the draft helpers the palette placements and the Save payload need.
 * Client-safe (pure types and functions).
 */
import type { EditorNode, EditorEdge, DraftNodeDef } from "./types";
import { normalizeTemplateNodeKeySlug } from "@/constants/templateGraph";

/** A node's canvas position (graph coordinates). */
export type CanvasPosition = { x: number; y: number };

/**
 * The whole editing draft: template meta, node instances, edges and the
 * unsaved declarative defs backing `draft:<n>` instances (Phase 2) —
 * persisted as node_templates rows only on Save.
 */
export interface Draft {
  template: {
    id: string;
    name: string;
    description: string | null;
    version: number;
    is_builtin: boolean;
    trigger: Record<string, unknown>;
  };
  nodes: EditorNode[];
  edges: EditorEdge[];
  pendingDefs?: Record<string, DraftNodeDef>;
}

import { BUILTIN_TEMPLATE_ID } from "@/constants/nodeKind";

/** The catalog id of the one Start node instance — the flow's entry. */
export const START_NODE_TEMPLATE_ID = BUILTIN_TEMPLATE_ID.START;

/** Display names for the palette's New-node tiles (also the saved row names). */
export const KIND_LABELS: Record<string, string> = {
  agent: "Agent node",
  decision: "Decision node",
  http: "HTTP node",
  script: "Script node",
};

/** Default node_templates icon per declarative kind (lucide names the graph resolves). */
export const KIND_ICONS: Record<string, string> = {
  agent: "bot",
  decision: "Split",
  http: "Send",
  script: "Terminal",
};

/** The keys a new node instance may take: slug of the base, then _2, _3, … */
export const uniqueKey = (base: string, nodes: EditorNode[]): string => {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "node";
  const key = normalizeTemplateNodeKeySlug(slug);
  if (!nodes.some((n) => n.key === key)) return key;
  for (let i = 2; ; i++) {
    const candidate = normalizeTemplateNodeKeySlug(`${slug}_${i}`);
    if (!nodes.some((n) => n.key === candidate)) return candidate;
  }
};

/** Display name for a placed draft def — "Agent node", then "Agent node 2", …
 *  avoiding collisions with this draft's other pending defs (the server
 *  versions the name further if a persisted row owns the key). */
export function nextDraftName(kind: string, draft: Draft): string {
  const base = KIND_LABELS[kind] ?? "Custom node";
  const taken = new Set(
    Object.values(draft.pendingDefs ?? {}).map((d) => d.name),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * The Save payload's `new_node_templates` (Phase 2): pending defs still
 * referenced by a draft node. The referencing instances' authored config is
 * folded into the def config (the persisted row then reflects what the drawer
 * authored, so the Library entry is reusable as-is). Defs whose nodes were
 * deleted/undone away are dropped — abandoned placements leave nothing behind.
 */
export function collectPendingDefs(draft: Draft): {
  draft_id: string;
  kind: string;
  name: string;
  icon: string | null;
  description: string | null;
  config: Record<string, unknown>;
}[] {
  const out: {
    draft_id: string;
    kind: string;
    name: string;
    icon: string | null;
    description: string | null;
    config: Record<string, unknown>;
  }[] = [];
  for (const def of Object.values(draft.pendingDefs ?? {})) {
    const users = draft.nodes.filter((n) => n.nodeTemplateId === def.draftId);
    if (users.length === 0) continue;
    let config = def.config;
    for (const n of users) config = { ...config, ...n.config };
    out.push({
      draft_id: def.draftId,
      kind: def.kind,
      name: def.name,
      icon: def.icon,
      description: def.description,
      config,
    });
  }
  return out;
}
