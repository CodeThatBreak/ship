"use client";
import type { Node } from "@/types/flow";
import type { GraphDef } from "../hooks/useGraphDef";
import { cn } from "@/lib/utils";
import { FLOW_STATUS } from "@/constants/flow";
import { iconFor } from "./icons";
import type { NodePosition } from "./GraphEdges";
import { H, STATUS, W, statusLabel } from "./graphLayout";

/**
 * One node card on the canvas (§2.2 presentational subcomponent): position,
 * border/text colors from the run state, the resolved template icon, label,
 * progress subtitle and the published-variables footer.
 */
export function WorkflowNodeCard({
  node,
  meta,
  position,
  selected,
  running,
  onSelect,
}: {
  node: Node;
  meta: GraphDef["meta"];
  position: NodePosition;
  selected: boolean;
  running: boolean;
  onSelect: (key: string) => void;
}) {
  // the node row's own label (template snapshot) wins; the graph meta
  // derives from the same template, so this only matters for fallbacks
  const label = node.label ?? meta[node.nodeKey]?.label ?? node.nodeKey;
  const Icon = iconFor(node.nodeKey, meta);
  // the variables this node publishes downstream — what the next node's
  // pickers offer (start nodes: their contract; agents: their schema)
  const outputs = meta[node.nodeKey]?.outputs ?? [];
  const isRunning = running || node.status === FLOW_STATUS.RUNNING;
  const cardColor = STATUS[isRunning ? FLOW_STATUS.RUNNING : node.status] ?? STATUS.pending;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Select node ${label}`}
      onClick={() => onSelect(node.nodeKey)}
      title={outputs.length ? `Publishes: ${outputs.join(", ")}` : undefined}
      className={cn(
        "absolute rounded-lg cursor-pointer flex items-center gap-[9px] px-3 border-[1.5px] transition-all duration-150 text-left",
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
          {statusLabel(node.status, isRunning)}
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
    </button>
  );
}
