"use client";
import dagre from "@dagrejs/dagre";
import {
  Compass,
  Hammer,
  ScanSearch,
  CheckCheck,
  CircleDot,
  Gauge,
  Play,
  Rocket,
  Send,
  Sparkles,
  Split,
  Tag,
  Terminal,
  BellRing,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Node } from "../app/flows/[id]/page";
import { cn } from "../lib/utils";

// icons are a pure UI concern — resolved from the node_templates `icon` column
// (lucide names, e.g. the seeded nodes) with a kind fallback, then CircleDot.
// Exported so the template builder resolves the same set.
export const ICONS: Record<string, any> = {
  plan: Compass,
  build: Hammer,
  pipeline: Gauge,
  review: ScanSearch,
  resolve: CheckCheck,
  agent: Sparkles,
  http: Send,
  script: Terminal,
  decision: Split,
  // extra lucide names templates may reference in node_templates.icon
  Bot: Sparkles,
  BellRing: BellRing,
  Play: Play,
  Rocket: Rocket,
  Tag: Tag,
};

interface GraphDef {
  order: string[];
  meta: Record<string, { label: string; kind?: string | null; icon?: string | null; outputs?: string[] | null }>;
  edges: [string, string, "next" | "loop"][];
  /** full edge specs (Phase 3: decision branch labels) */
  edgeSpecs?: { from: string; to: string; kind: string; label: string | null; condition: string | null }[];
}

function iconFor(key: string, meta: GraphDef["meta"]): any {
  const iconName = meta[key]?.icon;
  if (iconName && ICONS[iconName]) return ICONS[iconName];
  const kind = meta[key]?.kind;
  const catalogKey = key.startsWith("builtin/") ? key.slice(8) : key;
  return ICONS[iconName ?? ""] ?? ICONS[kind ?? ""] ?? ICONS[catalogKey] ?? CircleDot;
}

// fetched once per flow from /api/graph — with flowId the graph reflects the
// flow's own template snapshot (order/labels/edges), otherwise the built-in
// registry graph
const graphCaches = new Map<string, GraphDef>();
function useGraphDef(flowId: string): GraphDef | null {
  const [def, setDef] = useState<GraphDef | null>(graphCaches.get(flowId) ?? null);
  useEffect(() => {
    const cached = graphCaches.get(flowId);
    if (cached) {
      setDef(cached);
      return;
    }
    fetch(`/api/graph${flowId ? `?flowId=${encodeURIComponent(flowId)}` : ""}`)
      .then((r) => r.json())
      .then((d: GraphDef) => {
        graphCaches.set(flowId, d);
        setDef(d);
      })
      .catch(() => {});
  }, [flowId]);
  return def;
}

const STATUS: Record<string, { border: string; text: string }> = {
  running: { border: "border-info", text: "text-info" },
  awaiting_approval: { border: "border-warning", text: "text-warning" },
  approved: { border: "border-success", text: "text-success" },
  done: { border: "border-success", text: "text-success" },
  failed: { border: "border-destructive", text: "text-destructive" },
  waiting: { border: "border-border", text: "text-muted-foreground" },
  skipped: { border: "border-border", text: "text-muted-foreground" },
  pending: { border: "border-border", text: "text-muted-foreground" },
};

const W = 156,
  H = 66;

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
  flowId,
  selected,
  onSelect,
  currentNode,
}: {
  nodes: Node[];
  flowId?: string;
  selected: string;
  onSelect: (k: string) => void;
  currentNode?: string;
}) {
  const graphDef = useGraphDef(flowId ?? "");
  const keys = nodes.map((n) => n.node_key);
  const edges = graphDef?.edges ?? [];
  const meta = graphDef?.meta ?? {};
  const g = layout(keys, edges);
  if (!keys.length) return null;
  const width = Math.max(...keys.map((k) => g.node(k).x)) + W;
  const height = Math.max(...keys.map((k) => g.node(k).y)) + H + 10;

  // decision branches (Phase 3): an edge out of a decision node highlights
  // when its label was chosen; the label renders at the edge midpoint
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  const decisionOut = new Map<string, Set<string>>(); // `${from}>${label}` → taken?
  const takenEdges = new Set<string>();
  for (const e of graphDef?.edgeSpecs ?? []) {
    if (e.label == null) continue;
    const src = byKey.get(e.from);
    if (src?.kind !== "decision") continue;
    const chosen = (src.output as { chosen?: string[] } | undefined)?.chosen ?? [];
    const done = src.status === "done" || src.status === "approved";
    if (done && chosen.includes(e.label)) takenEdges.add(`${e.from}>${e.to}:${e.label}`);
    decisionOut.set(`${e.from}>${e.to}:${e.label}`, new Set([e.label]));
  }
  const specOf = (a: string, b: string) =>
    (graphDef?.edgeSpecs ?? []).find((e) => e.from === a && e.to === b) ?? null;

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
          if (!keys.includes(a) || !keys.includes(b)) return null;
          const na = g.node(a),
            nb = g.node(b);
          const back = nb.x < na.x;
          const x1 = back ? na.x : na.x + W / 2,
            y1 = back ? na.y + H / 2 : na.y;
          const x2 = back ? nb.x : nb.x - W / 2,
            y2 = back ? nb.y + H / 2 : nb.y;
          const my = back ? height - 4 : (y1 + y2) / 2;
          const spec = specOf(a, b);
          const taken = spec?.label != null && takenEdges.has(`${a}>${b}:${spec.label}`);
          return (
            <path
              key={`${a}-${b}`}
              d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${back ? my : y1}, ${(x1 + x2) / 2} ${back ? my : y2}, ${x2} ${y2}`}
              fill="none"
              className={taken ? "stroke-success" : "stroke-border"}
              strokeWidth={taken ? 2 : 1.5}
              strokeDasharray={spec?.kind === "loop" ? "5 4" : undefined}
              markerEnd={taken ? "url(#arr-taken)" : "url(#arr)"}
            />
          );
        })}
        {/* decision branch labels at the edge midpoint */}
        {edges.map(([a, b]) => {
          const spec = specOf(a, b);
          if (!spec?.label || !keys.includes(a) || !keys.includes(b)) return null;
          const na = g.node(a), nb = g.node(b);
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
      {nodes.map((n) => {
        const p = g.node(n.node_key);
        // the node row's own label (template snapshot) wins; the graph meta
        // derives from the same template, so this only matters for fallbacks
        const label = n.label ?? meta[n.node_key]?.label ?? n.node_key;
        const Icon = iconFor(n.node_key, meta);
        // the variables this node publishes downstream — what the next node's
        // pickers offer (start nodes: their contract; agents: their schema)
        const outputs = meta[n.node_key]?.outputs ?? [];
        const isSel = selected === n.node_key;
        const isRunning = currentNode === n.node_key || n.status === "running";
        const st = STATUS[isRunning ? "running" : n.status] ?? STATUS.pending;
        return (
          <div
            key={n.node_key}
            onClick={() => onSelect(n.node_key)}
            title={outputs.length ? `Publishes: ${outputs.join(", ")}` : undefined}
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
              <div className="text-[12.5px] font-semibold leading-[1.2] truncate">
                {label}
              </div>
              <div
                className={cn(
                  "text-[10.5px] mt-0.5",
                  isRunning
                    ? "text-info"
                    : n.status === "pending"
                      ? "text-muted-foreground"
                      : st.text,
                )}
              >
                {statusLabel(n.status, isRunning)}
                {n.artifacts.length > 0 &&
                  ` · v${Math.max(...n.artifacts.map((a) => a.version))}`}
              </div>
              {outputs.length > 0 && (
                <div
                  className="text-[9.5px] text-muted-foreground leading-[1.3] truncate mt-0.5"
                  title={`Publishes: ${outputs.join(", ")}`}
                >
                  → {outputs.join(", ")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
