"use client";
/**
 * The flow-builder's custom edge render (split from the canvas): the bezier
 * line plus its label chip — clicking the chip opens the edge drawer. The
 * registry wiring (`edgeTypes`) lives in builder-flow.
 */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { cn } from "../../../lib/utils";
import type { EditorEdge } from "../types";

export type BuilderEdgeData = {
  edge: EditorEdge;
  selected: boolean;
  /** the static linter's problem for this edge's condition (Phase 5) — the
   *  label chip renders rose with the message in its tooltip */
  problem?: string;
  onOpen: (index: number) => void;
};

export function BuilderEdgeView({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd,
}: EdgeProps<Edge<BuilderEdgeData>>) {
  const d = data;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const selected = d?.selected;
  const isLoop = d?.edge.kind === "loop";
  const chip = d?.edge.label ?? d?.edge.condition;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cn("hover:stroke-muted-foreground", selected ? "stroke-info" : d?.problem ? "stroke-destructive/70" : "stroke-border")}
        style={{ strokeWidth: selected ? 2 : 1.5, strokeDasharray: isLoop ? "5 4" : undefined }}
      />
      {chip && (
        <EdgeLabelRenderer>
          <button
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "nodrag nopan absolute pointer-events-auto rounded-md border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-all max-w-[150px] truncate",
              selected
                ? "border-info bg-info/10 text-info"
                : d?.problem
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border bg-popover text-muted-foreground hover:text-foreground",
            )}
            onClick={(e) => {
              e.stopPropagation();
              d?.onOpen?.(edgeIndexOf(id));
            }}
            title={d?.problem ?? d?.edge.label ?? d?.edge.condition ?? ""}
          >
            {d?.edge.label ?? <code className="font-mono text-[9.5px]">{d?.edge.condition}</code>}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Flow edge ids are `edge<i>` — the trailing index addresses the draft
 *  edge (the chip's drawer, and keyboard-delete routing). */
export function edgeIndexOf(id: string): number {
  return Number(id.replace(/[^0-9]/g, ""));
}
