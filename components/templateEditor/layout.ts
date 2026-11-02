/**
 * Pure auto-layout helpers for the builder canvas: dagre over the draft graph
 * is the fallback for nodes without saved positions, and "Tidy layout" runs
 * the same pass on demand. Client-safe (pure functions, no lib imports).
 */
import dagre from "@dagrejs/dagre";
import type { EditorNode, EditorEdge } from "./types";
import type { CanvasPosition } from "./draft";

export { type CanvasPosition } from "./draft";

const LAYOUT_W = 190,
  LAYOUT_H = 68;

/** Dagre auto-layout over the draft graph (left-to-right). */
export function dagreLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
): Record<string, CanvasPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 46,
    ranksep: 96,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes)
    g.setNode(n.key, { width: LAYOUT_W, height: LAYOUT_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Record<string, CanvasPosition> = {};
  for (const n of nodes) {
    const p = g.node(n.key);
    out[n.key] = { x: p.x, y: p.y };
  }
  return out;
}

/**
 * The editor's initial positions: saved positions win; auto-layout only fills
 * the gaps (and centers anything new).
 */
export function initialPositions(
  nodes: EditorNode[],
  edges: EditorEdge[],
  saved: Record<string, CanvasPosition>,
): Record<string, CanvasPosition> {
  const auto = dagreLayout(nodes, edges);
  return Object.fromEntries(
    nodes.map((n) => [n.key, saved[n.key] ?? auto[n.key]]),
  );
}
