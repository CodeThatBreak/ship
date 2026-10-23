"use client";
import dagre from "@dagrejs/dagre";
import {
  Compass,
  Hammer,
  ScanSearch,
  CheckCheck,
  CircleDot,
  Gauge,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Node } from "../app/flows/[id]/page";
import { cn } from "../lib/utils";

// icons are a pure UI concern — keyed by node key, falling back to CircleDot
const ICONS: Record<string, any> = {
  plan: Compass,
  build: Hammer,
  pipeline: Gauge,
  review: ScanSearch,
  resolve: CheckCheck,
};

interface GraphDef {
  order: string[];
  meta: Record<string, { label: string }>;
  edges: [string, string, "next" | "loop"][];
}

// fetched once from /api/graph (the node registry is the single source of truth)
let graphCache: GraphDef | null = null;
function useGraphDef(): GraphDef | null {
  const [def, setDef] = useState<GraphDef | null>(graphCache);
  useEffect(() => {
    if (graphCache) return;
    fetch("/api/graph")
      .then((r) => r.json())
      .then((d: GraphDef) => {
        graphCache = d;
        setDef(d);
      })
      .catch(() => {});
  }, []);
  return def;
}

const STATUS: Record<string, { border: string; text: string }> = {
  running: { border: "border-blue-500", text: "text-blue-400" },
  awaiting_approval: { border: "border-amber-500", text: "text-amber-400" },
  approved: { border: "border-emerald-500", text: "text-emerald-400" },
  done: { border: "border-emerald-500", text: "text-emerald-400" },
  failed: { border: "border-rose-500", text: "text-rose-400" },
  pending: { border: "border-border", text: "text-muted-foreground" },
};

const W = 148,
  H = 56;

function layout(keys: string[], edges: [string, string, string][]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 26,
    ranksep: 52,
    marginx: 16,
    marginy: 14,
  });
  g.setDefaultEdgeLabel(() => ({}));
  keys.forEach((k) => g.setNode(k, { width: W, height: H }));
  edges.forEach(([a, b]) => {
    if (keys.includes(a) && keys.includes(b)) g.setEdge(a, b);
  });
  dagre.layout(g);
  return g;
}

function statusLabel(s: string, running: boolean) {
  if (running) return "running";
  return s.replace(/_/g, " ");
}

export default function WorkflowGraph({
  nodes,
  selected,
  onSelect,
  currentNode,
}: {
  nodes: Node[];
  selected: string;
  onSelect: (k: string) => void;
  currentNode?: string;
}) {
  const graphDef = useGraphDef();
  const keys = nodes.map((n) => n.node_key);
  const edges = graphDef?.edges ?? [];
  const meta = graphDef?.meta ?? {};
  const g = layout(keys, edges);
  if (!keys.length) return null;
  const width = Math.max(...keys.map((k) => g.node(k).x)) + W;
  const height = Math.max(...keys.map((k) => g.node(k).y)) + H + 10;

  return (
    <div className="relative mx-auto" style={{ width, height }}>
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
        </defs>
        {edges.map(([a, b]) => {
          if (!keys.includes(a) || !keys.includes(b)) return null;
          const na = g.node(a),
            nb = g.node(b);
          const back = nb.x < na.x;
          const x1 = back ? na.x : na.x + W / 2,
            y1 = back ? na.y + H / 2 : na.y;
          const x2 = back ? nb.x : nb.x - W / 2,
            y2 = back ? nb.y + H / 2 : nb.y;
          const my = back ? height - 4 : (y1 + y2) / 2;
          return (
            <path
              key={`${a}-${b}`}
              d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${back ? my : y1}, ${(x1 + x2) / 2} ${back ? my : y2}, ${x2} ${y2}`}
              fill="none"
              className="stroke-border"
              strokeWidth="1.5"
              markerEnd="url(#arr)"
            />
          );
        })}
      </svg>
      {nodes.map((n) => {
        const p = g.node(n.node_key);
        const label = meta[n.node_key]?.label ?? n.node_key;
        const Icon = ICONS[n.node_key] ?? CircleDot;
        const isSel = selected === n.node_key;
        const isRunning = currentNode === n.node_key || n.status === "running";
        const st = STATUS[isRunning ? "running" : n.status] ?? STATUS.pending;
        return (
          <div
            key={n.node_key}
            onClick={() => onSelect(n.node_key)}
            className={cn(
              "absolute rounded-xl cursor-pointer flex items-center gap-[9px] px-3 border-[1.5px] transition-all duration-150",
              isSel ? "bg-popover shadow-panel" : "bg-card",
              st.border,
              isRunning && "animate-pulse",
            )}
            style={{ left: p.x - W / 2, top: p.y - H / 2, width: W, height: H }}
          >
            <Icon
              size={17}
              strokeWidth={2}
              className={
                isRunning || n.status !== "pending"
                  ? st.text
                  : "text-muted-foreground"
              }
            />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold leading-[1.2]">
                {label}
              </div>
              <div
                className={cn(
                  "text-[10.5px] mt-0.5",
                  isRunning
                    ? "text-blue-400"
                    : n.status === "pending"
                      ? "text-muted-foreground"
                      : st.text,
                )}
              >
                {statusLabel(n.status, isRunning)}
                {n.artifacts.length > 0 &&
                  ` · v${Math.max(...n.artifacts.map((a) => a.version))}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
