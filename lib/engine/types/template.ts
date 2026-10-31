import "server-only";

/**
 * Cross-module template types (engine/types/ — the engine's shared type
 * vocabulary). Only types consumed by engine modules outside
 * `templates/` or directly by `app/api` live here; everything else stays
 * co-located with its class in `templates/template-store.ts`.
 */
import type { TemplateNodeTrigger } from "../../db/rows";

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
  /** graph editor positions (Phase 5) — null = let the editor auto-layout */
  x?: number | null;
  y?: number | null;
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
