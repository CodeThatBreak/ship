import "server-only";

import type {
  TemplateEdgeSpec,
  TemplateGraph,
  TemplateNodeSpec,
} from "../types/template";

/** JSON shape persisted on `flows.template_graph` (no runtime Map). */
export interface StoredFlowTemplateGraph {
  templateId: string;
  version: number;
  flowTrigger: Record<string, unknown>;
  nodes: TemplateNodeSpec[];
  edges: TemplateEdgeSpec[];
}

export const serializeFlowTemplateGraph = (graph: TemplateGraph): string =>
  JSON.stringify({
    templateId: graph.templateId,
    version: graph.version,
    flowTrigger: graph.flowTrigger,
    nodes: graph.nodes,
    edges: graph.edges,
  } satisfies StoredFlowTemplateGraph);

export const hydrateFlowTemplateGraph = (raw: string | null | undefined): TemplateGraph | null => {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const d = parsed as StoredFlowTemplateGraph;
  if (typeof d.templateId !== "string" || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
    return null;
  }
  const nodes = d.nodes.filter(
    (n): n is TemplateNodeSpec =>
      n != null &&
      typeof n === "object" &&
      typeof (n as TemplateNodeSpec).key === "string" &&
      typeof (n as TemplateNodeSpec).defKey === "string",
  );
  const edges = d.edges.filter(
    (e): e is TemplateEdgeSpec =>
      e != null &&
      typeof e === "object" &&
      typeof (e as TemplateEdgeSpec).from === "string" &&
      typeof (e as TemplateEdgeSpec).to === "string",
  );
  return {
    templateId: d.templateId,
    version: typeof d.version === "number" ? d.version : 0,
    flowTrigger:
      d.flowTrigger && typeof d.flowTrigger === "object" && !Array.isArray(d.flowTrigger)
        ? d.flowTrigger
        : { type: "manual" },
    nodes,
    edges,
    byKey: new Map(nodes.map((n) => [n.key, n])),
  };
};
