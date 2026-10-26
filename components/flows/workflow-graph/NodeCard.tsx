"use client";
import type { Node } from "@/types/flow";
import type { GraphDef } from "@/hooks/use-graph-def";
import { cn } from "@/lib/utils";
import { FANOUT_STATE, FLOW_STATUS, type FanoutState } from "@/constants/flow";
import { iconFor } from "./icons";
import type { NodePosition } from "./GraphEdges";
import { H, STATUS, W, statusLabel } from "./graph-layout";

/** Plan fan-out progress per node key — the card's subtitle (see `WorkflowGraph`). */
export type FanoutProgress = {
  total: number;
  done: number;
  running: string | null;
  costCents: number;
  state: FanoutState;
};

/**
 * One node card on the canvas (§2.2 presentational subcomponent): position,
 * border/text colors from the run state (possibly overridden by the fan-out
 * aggregate), the resolved template icon, label, progress subtitle and the
 * published-variables footer.
 */
export function WorkflowNodeCard({
  node,
  meta,
  position,
  selected,
  running,
  fanout,
  onSelect,
}: {
  node: Node;
  meta: GraphDef["meta"];
  position: NodePosition;
  selected: boolean;
  running: boolean;
  fanout?: FanoutProgress;
  onSelect: (key: string) => void;
}) {
  // the node row's own label (template snapshot) wins; the graph meta
  // derives from the same template, so this only matters for fallbacks
  const label = node.label ?? meta[node.node_key]?.label ?? node.node_key;
  const Icon = iconFor(node.node_key, meta);
  // the variables this node publishes downstream — what the next node's
  // pickers offer (start nodes: their contract; agents: their schema)
  const outputs = meta[node.node_key]?.outputs ?? [];
  const isRunning = running || node.status === FLOW_STATUS.RUNNING;
  const st = STATUS[isRunning ? FLOW_STATUS.RUNNING : node.status] ?? STATUS.pending;
  // aggregate child states override the card colors while the fan-out
  // runs — the orchestrator row itself holds `running` until all children
  // resolve, so red/warning/success must come from the children (Phase 4)
  const cardColor = fanout
    ? (fanout.state === FANOUT_STATE.FAILED ? STATUS.failed
      : fanout.state === FANOUT_STATE.AWAITING ? STATUS.awaiting_approval
      : fanout.state === FANOUT_STATE.IN_FLIGHT ? STATUS.running
      : STATUS.approved)
    : st;
  return (
    <div
      onClick={() => onSelect(node.node_key)}
      title={outputs.length ? `Publishes: ${outputs.join(", ")}` : undefined}
      className={cn(
        "absolute rounded-lg cursor-pointer flex items-center gap-[9px] px-3 border-[1.5px] transition-all duration-150",
        selected ? "bg-popover shadow-panel" : "bg-card",
        cardColor.border,
        isRunning && "animate-pulse",
      )}
      style={{ left: position.x - W / 2, top: position.y - H / 2, width: W, height: H }}
    >
      <Icon
        size={17}
        strokeWidth={2}
        className={
          isRunning || node.status !== FLOW_STATUS.PENDING
            ? cardColor.text
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
              : node.status === FLOW_STATUS.PENDING
                ? "text-muted-foreground"
                : cardColor.text,
          )}
        >
          {/* plan fan-out: the per-node step rollup as the subtitle
              (`steps 3/8 · building`, `· $0.42` when the children cost) */}
          {fanout
            ? `steps ${fanout.done}/${fanout.total}${fanout.running ? ` · ${fanout.running}` : ""}${fanout.costCents > 0 ? ` · $${(fanout.costCents / 100).toFixed(2)}` : ""}`
            : statusLabel(node.status, isRunning)}
          {node.artifacts.length > 0 &&
            ` · v${Math.max(...node.artifacts.map((a) => a.version))}`}
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
}
