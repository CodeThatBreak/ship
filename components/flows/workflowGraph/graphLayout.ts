import dagre from "@dagrejs/dagre";

/** Card dimensions (px) — dagre lays out with them, the cards render at them. */
export const W = 156;
export const H = 66;

/** Border + text color pair per run state (undefined-lookup falls to pending). */
export type GraphStatusStyle = { border: string; text: string };
export const STATUS: Record<string, GraphStatusStyle> = {
  running: { border: "border-info", text: "text-info" },
  awaiting_approval: { border: "border-warning", text: "text-warning" },
  approved: { border: "border-success", text: "text-success" },
  done: { border: "border-success", text: "text-success" },
  failed: { border: "border-destructive", text: "text-destructive" },
  waiting: { border: "border-border", text: "text-muted-foreground" },
  skipped: { border: "border-border", text: "text-muted-foreground" },
  pending: { border: "border-border", text: "text-muted-foreground" },
};

/**
 * Left-to-right dagre layout over the reduced edge list — the returned graph
 * carries each key's node position (`g.node(key).{x,y}`, card centers).
 */
export function layout(keys: string[], edges: [string, string, string][]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 26,
    ranksep: 52,
    marginx: 16,
    marginy: 14,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const keySet = new Set(keys);
  keys.forEach((k) => g.setNode(k, { width: W, height: H }));
  edges.forEach(([a, b]) => {
    if (keySet.has(a) && keySet.has(b)) g.setEdge(a, b);
  });
  dagre.layout(g);
  return g;
}

export function statusLabel(s: string, running: boolean) {
  if (running) return "running";
  return s.replace(/_/g, " ");
}
