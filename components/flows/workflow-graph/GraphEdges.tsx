"use client";
import { useMemo } from "react";
import type { Node } from "@/types/flow";
import type { GraphDef } from "../hooks/useGraphDef";
import { isTerminalFlowStatus } from "@/constants/flow";
import { H, W } from "./graph-layout";

export type NodePosition = { x: number; y: number };
/** Just what an edge's spec is needed for here: its `kind` (loop dash). */
export type EdgeSpec = NonNullable<NonNullable<GraphDef["edgeSpecs"]>[number]>;
export type EdgeSpecOf = (a: string, b: string) => EdgeSpec | null;

/**
 * The SVG layer (§2.2 presentational subcomponent): arrowhead markers, the
 * edge paths (forward edges through the card sides, looped "back" edges
 * rendered near the bottom border), and the decision branch labels at the
 * edge midpoints.
 *
 * Decision branches (Phase 3): an edge out of a decision node highlights when
 * its label was chosen — the taken edges compute here from the decision nodes'
 * chosen labels and the graph specs.
 */
export function GraphEdges({
  nodes,
  edges,
  edgeSpecs,
  positions,
  width,
  height,
}: {
  nodes: Node[];
  /** the reduced edge list the layout used */
  edges: GraphDef["edges"];
  /** full edge specs — decision branch labels live here (need not be present) */
  edgeSpecs?: GraphDef["edgeSpecs"];
  /** each key's dagre card-center position */
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
}) {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  /** keys are `${from}>${to}:${label}` — decided decisions highlight their edge */
  const takenEdges = new Set<string>();
  for (const e of edgeSpecs ?? []) {
    if (e.label == null) continue;
    const src = byKey.get(e.from);
    if (src?.kind !== "decision") continue;
    const chosen = (src.output as { chosen?: string[] } | undefined)?.chosen ?? [];
    const done = isTerminalFlowStatus(src.status);
    if (done && chosen.includes(e.label)) takenEdges.add(`${e.from}>${e.to}:${e.label}`);
  }
  const specByPair = useMemo(() => {
    const map = new Map<string, EdgeSpec>();
    for (const edge of edgeSpecs ?? []) {
      const pair = `${edge.from}>${edge.to}`;
      if (!map.has(pair)) map.set(pair, edge);
    }
    return map;
  }, [edgeSpecs]);
  const specOf: EdgeSpecOf = (a, b) => specByPair.get(`${a}>${b}`) ?? null;

  return (
    <svg width={width} height={height} className="absolute inset-0">
      <defs>
        <marker
          id="arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
        </marker>
        <marker
          id="arr-taken"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-success" />
        </marker>
      </defs>
      {edges.map(([a, b]) => {
        const na = positions.get(a);
        const nb = positions.get(b);
        if (!na || !nb) return null;
        const spec = specOf(a, b);
        const taken = spec?.label != null && takenEdges.has(`${a}>${b}:${spec.label}`);
        return (
          <EdgePath key={`${a}-${b}`} na={na} nb={nb} height={height} spec={spec} taken={taken} />
        );
      })}
      {/* decision branch labels at the edge midpoint */}
      {edges.map(([a, b]) => {
        const spec = specOf(a, b);
        if (!spec?.label) return null;
        const na = positions.get(a);
        const nb = positions.get(b);
        if (!na || !nb) return null;
        const back = nb.x < na.x;
        const mx = (na.x + (back ? 0 : W / 2) + nb.x - (back ? 0 : W / 2)) / 2;
        const my = back ? height - 4 : (na.y + nb.y) / 2;
        const taken = takenEdges.has(`${a}>${b}:${spec.label}`);
        return (
          <text
            key={`lbl-${a}-${b}`}
            x={mx}
            y={my - 6}
            textAnchor="middle"
            className={taken ? "fill-success" : "fill-muted-foreground"}
            fontSize="10"
            fontFamily="inherit"
          >
            {spec.label}
          </text>
        );
      })}
    </svg>
  );
}

/** One bezier edge: forward edges run card-edge to card-edge, loopback edges
 *  dip to the bottom border; a `loop` spec renders dashed. */
function EdgePath({
  na,
  nb,
  height,
  spec,
  taken,
}: {
  na: NodePosition;
  nb: NodePosition;
  height: number;
  spec: EdgeSpec | null;
  taken: boolean;
}) {
  const back = nb.x < na.x;
  const x1 = back ? na.x : na.x + W / 2;
  const y1 = back ? na.y + H / 2 : na.y;
  const x2 = back ? nb.x : nb.x - W / 2;
  const y2 = back ? nb.y + H / 2 : nb.y;
  const my = back ? height - 4 : (y1 + y2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${back ? my : y1}, ${(x1 + x2) / 2} ${back ? my : y2}, ${x2} ${y2}`}
      fill="none"
      className={taken ? "stroke-success" : "stroke-border"}
      strokeWidth={taken ? 2 : 1.5}
      strokeDasharray={spec?.kind === "loop" ? "5 4" : undefined}
      markerEnd={taken ? "url(#arr-taken)" : "url(#arr)"}
    />
  );
}
