"use client";
/**
 * The flow canvas body (split from the BuilderCanvas container): maps the
 * page's draft graph onto @xyflow/react nodes/edges, routes RF change events
 * back to the page (moves, keyboard deletes, connects) and hosts the
 * helpers/MiniMap/controls. The provider wrapper lives in BuilderCanvas.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid } from "lucide-react";
import { Button } from "../../ui/button";
import type { EditorEdge, EditorNode } from "../types";
import { BuilderNodeView, type BuilderNodeData } from "./BuilderNodeView";
import { BuilderEdgeView, edgeIndexOf, type BuilderEdgeData } from "./BuilderEdgeView";
import { ApiBridge } from "./BuilderApiBridge";
import { canConnectTemplateEdge } from "../utils/graph-edges";

import { START_NODE_TEMPLATE_ID } from "../draft";

export interface BuilderCanvasProps {
  nodes: EditorNode[];
  edges: EditorEdge[];
  positions: Record<string, { x: number; y: number }>;
  selectedNodeKey: string | null;
  selectedEdgeIndex: number | null;
  readonly: boolean;
  /** decision node key → branch choices — drives the labeled branch handles */
  branchChoices?: Record<string, { label: string; description?: string; condition?: string }[]>;
  /** node key → the static linter's problems (Phase 5) — error badges */
  nodeProblems?: Record<string, string[]>;
  /** edge index → the condition's problem (Phase 5) — rose chips */
  edgeProblems?: Record<number, string>;
  onNodeOpen: (key: string) => void;
  onEdgeOpen: (index: number) => void;
  onNodeMove: (key: string, x: number, y: number) => void;
  onNodeDragStop?: (key: string, x: number, y: number) => void;
  /** keyboard delete (Backspace/Delete) — the page removes the node + its
   *  edges from the draft (the Start node is protected there) */
  onNodeRemove?: (key: string) => void;
  /** keyboard delete of a selected edge — the flow edge id is `edge<i>` */
  onEdgeRemove?: (index: number) => void;
  /** sourceHandle is a decision branch label when the drag starts on one of
   *  its branch handles — the edge is created pre-labeled */
  onConnect: (from: string, to: string, branchLabel?: string | null) => void;
  onPaneClick: () => void;
  /** right-click on a node → duplicate it (Phase 6, G3 — the host copies the
   *  node with a fresh unique key; read-only canvases don't invoke it) */
  onNodeDuplicate?: (key: string) => void;
  /** "Tidy layout" (Phase 6, G2): auto-arrange the nodes (dagre over the
   *  draft graph) — rendered as a control beside the zoom controls */
  onTidyLayout?: () => void;
  /** registers the screen→flow helper + fitView for the page (palette placement) */
  onApi?: (api: BuilderApi) => void;
}

export interface BuilderApi {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  fitView: () => void;
}

type FlowNode = Node<BuilderNodeData>;
type FlowEdge = Edge<BuilderEdgeData>;

const nodeTypes = { template: BuilderNodeView };
const edgeTypes = { template: BuilderEdgeView };

export function BuilderFlow(props: BuilderCanvasProps) {
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    nodeKey: string;
  } | null>(null);

  useEffect(() => {
    if (!nodeMenu) return;
    const dismiss = () => setNodeMenu(null);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [nodeMenu]);

  const rfNodes: FlowNode[] = useMemo(
    () =>
      props.nodes.map((n) => ({
        id: n.key,
        type: "template",
        position: props.positions[n.key] ?? { x: 0, y: 0 },
        selected: props.selectedNodeKey === n.key,
        data: {
          node: n,
          selected: props.selectedNodeKey === n.key,
          readonly: props.readonly,
          unlinked: props.edges.every((e) => e.from !== n.key && e.to !== n.key),
          choices: props.branchChoices?.[n.key],
          problems: props.nodeProblems?.[n.key],
          onOpen: props.onNodeOpen,
        },
        draggable: !props.readonly,
        connectable: !props.readonly,
        // keyboard deletes respect editability; the Start node is never
        // deletable (the page guards this too)
        deletable: !props.readonly && n.nodeTemplateId !== START_NODE_TEMPLATE_ID,
      })),
    [props.nodes, props.edges, props.positions, props.selectedNodeKey, props.readonly, props.onNodeOpen, props.branchChoices, props.nodeProblems],
  );

  const rfEdges: FlowEdge[] = useMemo(
    () =>
      props.edges.map((e, i) => {
        const selected = props.selectedEdgeIndex === i;
        return {
          id: `edge${i}`,
          type: "template",
          source: e.from,
          target: e.to,
          selected,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: selected ? "#3b82f6" : "#64748b",
            width: 16,
            height: 16,
          },
          deletable: !props.readonly,
          data: { edge: e, selected, problem: props.edgeProblems?.[i], onOpen: props.onEdgeOpen },
        };
      }),
    [props.edges, props.selectedEdgeIndex, props.onEdgeOpen, props.edgeProblems, props.readonly],
  );

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    for (const c of changes) {
      // Backspace/Delete on a selected node — the page applies it to the draft
      // (removing the node and its edges); positions keep autosaving as before
      if (c.type === "remove") {
        props.onNodeRemove?.(c.id);
        continue;
      }
      if (c.type !== "position" || !c.position) continue;
      props.onNodeMove(c.id, c.position.x, c.position.y);
      if (c.dragging === false) props.onNodeDragStop?.(c.id, c.position.x, c.position.y);
    }
  };
  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    // selection styling is derived — clicks open the edge drawer; keyboard
    // deletes route back to the page by draft-edge index
    for (const c of changes) {
      if (c.type !== "remove") continue;
      const idx = edgeIndexOf(c.id);
      if (Number.isFinite(idx)) props.onEdgeRemove?.(idx);
    }
  };

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onEdgeClick={(_e, edge) => props.onEdgeOpen(edgeIndexOf(edge.id))}
      onNodeContextMenu={(e, n) => {
        if (props.readonly || !props.onNodeDuplicate) return;
        e.preventDefault();
        e.stopPropagation();
        setNodeMenu({ x: e.clientX, y: e.clientY, nodeKey: n.id });
      }}
      onConnect={(c: Connection) => {
        if (c.source && c.target && c.source !== c.target) {
          props.onConnect(c.source, c.target, c.sourceHandle ?? null);
        }
      }}
      onPaneClick={() => {
        setNodeMenu(null);
        props.onPaneClick();
      }}
      nodesDraggable={!props.readonly}
      nodesConnectable={!props.readonly}
      isValidConnection={(c) => {
        if (!c.source || !c.target || c.source === c.target) return false;
        const branchLabel =
          typeof c.sourceHandle === "string" && c.sourceHandle.length ? c.sourceHandle : null;
        return canConnectTemplateEdge(props.edges, c.source, c.target, branchLabel);
      }}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.75}
      deleteKeyCode={props.readonly ? null : ["Backspace", "Delete"]}
      defaultEdgeOptions={{ type: "template" }}
      colorMode="dark"
    >
      <Background gap={22} size={1.4} className="!bg-background" />
      {!props.readonly && props.onTidyLayout && (
        <Panel position="top-left">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 rounded-lg bg-card/95 text-[11.5px] shadow-sm"
            title="Auto-arrange the nodes left-to-right (positions autosave as a drag does)"
            onClick={props.onTidyLayout}
          >
            <LayoutGrid size={12} className="text-muted-foreground" /> Tidy layout
          </Button>
        </Panel>
      )}
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        position="bottom-right"
        className="!border !border-border !rounded-lg !bg-card overflow-hidden"
        nodeColor={() => "#52525b"}
        nodeStrokeColor={(n) => ((n.data as BuilderNodeData | undefined)?.selected ? "#3b82f6" : "transparent")}
        maskColor="oklch(0.141 0.005 285.823 / 0.6)"
      />
      {props.onApi ? <ApiBridge onApi={props.onApi} /> : null}
      {nodeMenu && props.onNodeDuplicate ? (
        <div
          className="fixed z-50 min-w-[9rem] rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted"
            onClick={() => {
              props.onNodeDuplicate?.(nodeMenu.nodeKey);
              setNodeMenu(null);
            }}
          >
            Duplicate node
          </button>
        </div>
      ) : null}
    </ReactFlow>
  );
}
