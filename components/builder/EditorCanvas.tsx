"use client";
/**
 * The builder's middle surface: the node palette rail (its own data layer —
 * use-palette-catalog) plus the @xyflow/react canvas over the draft graph.
 * This page's island composition wraps both: all editing callbacks arrive
 * from the editor page's action bundle via props.
 */
import NodePalette from "@/components/templateEditor/NodePalette";
import BuilderCanvas, { type BuilderApi } from "@/components/templateEditor/BuilderCanvas";
import type { NodeKind } from "@/constants/nodeKind";
import type { EditorEdge, EditorNode } from "@/components/templateEditor/types";
import type { CanvasPosition } from "@/components/templateEditor/draft";
import type { BranchChoice } from "./hooks/useInstanceContracts";

export interface EditorCanvasProps {
  templateId: string;
  nodes: EditorNode[];
  /** the draft's edges — the canvas maps them to flow edges */
  edges: EditorEdge[];
  positions: Record<string, CanvasPosition>;
  /** the node configurator drawer's open node key (also the just-placed
   *  highlight while no drawer is open) */
  selectedNodeKey: string | null;
  selectedEdgeIndex: number | null;
  readonly: boolean;
  /** decision node key → branch choices — drives the labeled branch handles */
  branchChoices: Record<string, BranchChoice[]>;
  nodeProblems: Record<string, string[]>;
  edgeProblems: Record<number, string>;
  /** bumped after a Save that may have created catalog rows — the palette
   *  re-fetches so new Library rows show up */
  catalogEpoch: number;
  onNodeOpen: (key: string) => void;
  onEdgeOpen: (index: number) => void;
  onNodeMove: (key: string, x: number, y: number) => void;
  onNodeDragStop: () => void;
  onConnect: (from: string, to: string, branchLabel?: string | null) => void;
  onNodeRemove: (key: string) => void;
  onEdgeRemove: (index: number) => void;
  onNodeDuplicate: (key: string) => void;
  onTidyLayout: () => void;
  onPaneClick: () => void;
  onAddCatalogNode: (
    nodeTemplateId: string,
    isBuiltin: boolean,
    catalogKey: string,
    name: string,
  ) => void;
  onAddKindNode: (kind: NodeKind) => void;
  onApi: (api: BuilderApi) => void;
}

export function EditorCanvas({
  templateId,
  nodes,
  edges,
  positions,
  selectedNodeKey,
  selectedEdgeIndex,
  readonly,
  branchChoices,
  nodeProblems,
  edgeProblems,
  catalogEpoch,
  onNodeOpen,
  onEdgeOpen,
  onNodeMove,
  onNodeDragStop,
  onConnect,
  onNodeRemove,
  onEdgeRemove,
  onNodeDuplicate,
  onTidyLayout,
  onPaneClick,
  onAddCatalogNode,
  onAddKindNode,
  onApi,
}: EditorCanvasProps) {
  return (
    <div className="flex-1 min-h-0 flex">
      <NodePalette
        templateId={templateId}
        nodes={nodes}
        readonly={readonly}
        catalogEpoch={catalogEpoch}
        onAddCatalogNode={onAddCatalogNode}
        onAddKindNode={onAddKindNode}
      />
      <div className="flex-1 min-w-0">
        <BuilderCanvas
          nodes={nodes}
          edges={edges}
          positions={positions}
          selectedNodeKey={selectedNodeKey}
          selectedEdgeIndex={selectedEdgeIndex}
          readonly={readonly}
          branchChoices={branchChoices}
          nodeProblems={nodeProblems}
          edgeProblems={edgeProblems}
          onNodeOpen={onNodeOpen}
          onEdgeOpen={onEdgeOpen}
          onNodeMove={onNodeMove}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodeRemove={onNodeRemove}
          onEdgeRemove={onEdgeRemove}
          onNodeDuplicate={onNodeDuplicate}
          onTidyLayout={onTidyLayout}
          onPaneClick={onPaneClick}
          onApi={onApi}
        />
      </div>
    </div>
  );
}
