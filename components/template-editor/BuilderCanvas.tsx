"use client";
/**
 * The visual flow builder canvas (Phase 5A): a drag-drop editor over the
 * template graph, built on @xyflow/react. Layout: persisted x/y positions win
 * (the page seeds dagre auto-layout positions for nodes without saved ones).
 * Clicking a node opens its configurator drawer; clicking an edge opens the
 * edge drawer. Structural edits (add/connect/delete) mutate the page's draft,
 * which PATCHes wholesale on save; position drags sync x/y immediately via the
 * positions-only PATCH.
 */
import { useEffect, useMemo } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "../../lib/utils";
import type { EditorEdge, EditorNode } from "./types";
import { iconForIconName } from "./icons";

// ── custom node ──────────────────────────────────────────────────────────────

export type BuilderNodeData = {
  node: EditorNode;
  selected: boolean;
  readonly: boolean;
  /** no edges touch this node — configuration is gated until it's connected */
  unlinked?: boolean;
  /** decision branch choices — one labeled source handle per choice, so
   *  attaching a node wires the pre-labeled branch edge (no edge editing) */
  choices?: { label: string; description?: string; condition?: string }[];
  onOpen: (key: string) => void;
};

const TRIGGER_STYLE: Record<string, string> = {
  approval: "bg-amber-500/10 text-amber-400",
  manual: "bg-blue-500/10 text-blue-400",
  debounced: "bg-violet-500/10 text-violet-400",
  auto: "bg-muted text-muted-foreground",
};

function BuilderNodeView({ id, data }: NodeProps<Node<BuilderNodeData>>) {
  const { node, selected, readonly, unlinked, choices, onOpen } = data;
  const label = node.overrideLabel || node.catalog_name || node.key;
  const Icon = iconForIconName(node.icon, node.kind ?? (node.is_builtin ? node.key : null), node.key);
  const isDecision = node.kind === "decision";
  const branches = isDecision && choices?.length ? choices : null;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpen(id);
      }}
      className={cn(
        "group relative rounded-xl border-[1.5px] bg-card cursor-pointer px-3 py-2 min-w-[148px] max-w-[188px] flex items-center gap-2.5 transition-all duration-150",
        "hover:shadow-panel",
        selected ? "border-blue-500 bg-popover shadow-panel" : "border-border",
        readonly && "cursor-default",
        !readonly && unlinked && "ring-1 ring-amber-500/50",
      )}
      title={readonly ? "Built-in template — read-only" : unlinked ? "Needs a connection before it can be configured" : "Click to configure"}
    >
      {!readonly && unlinked && (
        <span className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-background" title="Needs a connection">
          !
        </span>
      )}
      {!readonly ? (
        <HandleConnect type="target" />
      ) : (
        <HandleStatic type="target" />
      )}
      <Icon size={17} strokeWidth={2} className={isDecision ? "shrink-0 text-violet-300" : "shrink-0 text-muted-foreground"} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold leading-tight truncate">{label}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <code className="font-mono text-[10px] text-muted-foreground truncate max-w-[100px]">{node.key}</code>
        </div>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className={cn("rounded px-1 py-px text-[9.5px] font-medium", TRIGGER_STYLE[node.trigger.type] ?? TRIGGER_STYLE.auto)}>
            {node.trigger.type}
          </span>
          {node.trigger.wait_for && (
            <span
              className="rounded px-1 py-px text-[9.5px] font-medium bg-muted text-muted-foreground"
              title="wait_for event source"
            >
              ⧗ {(node.trigger.wait_for ?? "").slice(0, 14)}
            </span>
          )}
          {node.join_mode === "any" && (
            <span className="rounded px-1 py-px text-[9.5px] font-medium bg-amber-500/10 text-amber-400">any-join</span>
          )}
          {isDecision && (
            <span className="rounded px-1 py-px text-[9.5px] font-medium bg-violet-500/10 text-violet-300">branch</span>
          )}
        </div>
      </div>
      {branches ? (
        <BranchHandles nodeKey={id} choices={branches} readonly={readonly} />
      ) : !readonly ? (
        <HandleConnect type="source" />
      ) : (
        <HandleStatic type="source" />
      )}
    </div>
  );
}

/** Visible connect handles — hover reveals them on the node. */
function HandleConnect({ type }: { type: "source" | "target" }) {
  return (
    <Handle
      type={type}
      position={type === "source" ? Position.Right : Position.Left}
      className="!h-2.5 !w-2.5 !border-2 !border-background !bg-blue-400 opacity-0 transition-opacity group-hover:opacity-100"
      isConnectable
    />
  );
}

/** Static placeholder for read-only built-in surfaces. */
function HandleStatic({ type }: { type: "source" | "target" }) {
  return <Handle type={type} position={type === "source" ? Position.Right : Position.Left} className="!h-1.5 !w-1.5 !bg-border !border-0" isConnectable={false} />;
}

/**
 * A decision node's branch connectors — one violet handle per choice label,
 * stacked on the node's right edge. Dragging from a handle attaches a node
 * and the edge is created pre-labeled with that branch (the branch shows on
 * the edge; no per-edge editing). Each unattached label is its own visible
 * placeholder connector until a node is attached.
 */
function BranchHandles({
  nodeKey,
  choices,
  readonly,
}: {
  nodeKey: string;
  choices: { label: string; description?: string; condition?: string }[];
  readonly: boolean;
}) {
  return (
    <div className="flex flex-col justify-center gap-1 shrink-0 -mr-3">
      {choices.map((c) => (
        <div
          key={c.label}
          className="relative flex items-center justify-end gap-1 pr-2"
          title={`Branch “${c.label}” — drag to attach the next node${c.condition ? ` (condition: ${c.condition})` : c.description ? ` — ${c.description}` : ""}`}
        >
          <span className="text-[9px] font-mono leading-none text-violet-300 truncate max-w-[68px]">
            {c.label}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={c.label}
            className="!h-2.5 !w-2.5 !min-w-0 !min-h-0 !border-2 !border-background !bg-violet-400 hover:!scale-125 transition-transform"
            isConnectable={!readonly}
          />
        </div>
      ))}
      <span className="sr-only">{`decision ${nodeKey} branches: ${choices.map((c) => c.label).join(", ")}`}</span>
    </div>
  );
}

// ── custom edge ──────────────────────────────────────────────────────────────

export type BuilderEdgeData = {
  edge: EditorEdge;
  selected: boolean;
  onOpen: (index: number) => void;
};

function BuilderEdgeView({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd,
}: EdgeProps<Edge<BuilderEdgeData>>) {
  const d = data;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const selected = d?.selected;
  const isLoop = d?.edge.kind === "loop";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cn("hover:stroke-muted-foreground", selected ? "stroke-blue-500" : "stroke-border")}
        style={{ strokeWidth: selected ? 2 : 1.5, strokeDasharray: isLoop ? "5 4" : undefined }}
      />
      {(d?.edge.label || d?.edge.condition) && (
        <EdgeLabelRenderer>
          <button
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "nodrag nopan absolute pointer-events-auto rounded-md border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-all max-w-[150px] truncate",
              selected
                ? "border-blue-500 bg-blue-500/10 text-blue-300"
                : "border-border bg-popover text-muted-foreground hover:text-foreground",
            )}
            onClick={(e) => {
              e.stopPropagation();
              d?.onOpen?.(Number(id.replace(/[^0-9]/g, "")));
            }}
            title={d?.edge.label ?? d?.edge.condition ?? ""}
          >
            {d?.edge.label ?? <code className="font-mono text-[9.5px]">{d?.edge.condition}</code>}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { template: BuilderNodeView };
const edgeTypes = { template: BuilderEdgeView };

// ── the canvas ───────────────────────────────────────────────────────────────

export interface BuilderCanvasProps {
  nodes: EditorNode[];
  edges: EditorEdge[];
  positions: Record<string, { x: number; y: number }>;
  selectedNodeKey: string | null;
  selectedEdgeIndex: number | null;
  readonly: boolean;
  /** decision node key → branch choices — drives the labeled branch handles */
  branchChoices?: Record<string, { label: string; description?: string; condition?: string }[]>;
  onNodeOpen: (key: string) => void;
  onEdgeOpen: (index: number) => void;
  onNodeMove: (key: string, x: number, y: number) => void;
  onNodeDragStop?: (key: string, x: number, y: number) => void;
  /** sourceHandle is a decision branch label when the drag starts on one of
   *  its branch handles — the edge is created pre-labeled */
  onConnect: (from: string, to: string, branchLabel?: string | null) => void;
  onPaneClick: () => void;
  /** registers the screen→flow helper + fitView for the page (palette placement) */
  onApi?: (api: BuilderApi) => void;
}

export interface BuilderApi {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  fitView: () => void;
}

/** Exposes useReactFlow helpers to the page (sits inside the provider). */
function ApiBridge({ onApi }: { onApi: (api: BuilderApi) => void }) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  useEffect(() => {
    onApi({ screenToFlowPosition, fitView });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenToFlowPosition, fitView]);
  return null;
}

type FlowNode = Node<BuilderNodeData>;
type FlowEdge = Edge<BuilderEdgeData>;

function BuilderFlow(props: BuilderCanvasProps) {
  const rfNodes: FlowNode[] = useMemo(
    () =>
      props.nodes.map((n) => ({
        id: n.key,
        type: "template",
        position: props.positions[n.key] ?? { x: 0, y: 0 },
        data: {
          node: n,
          selected: props.selectedNodeKey === n.key,
          readonly: props.readonly,
          unlinked: props.edges.every((e) => e.from !== n.key && e.to !== n.key),
          choices: props.branchChoices?.[n.key],
          onOpen: props.onNodeOpen,
        },
        draggable: !props.readonly,
        connectable: !props.readonly,
      })),
    [props.nodes, props.edges, props.positions, props.selectedNodeKey, props.readonly, props.onNodeOpen, props.branchChoices],
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: selected ? "#3b82f6" : "#64748b",
            width: 16,
            height: 16,
          },
          data: { edge: e, selected, onOpen: props.onEdgeOpen },
        };
      }),
    [props.edges, props.selectedEdgeIndex, props.onEdgeOpen],
  );

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    for (const c of changes) {
      if (c.type !== "position" || !c.position) continue;
      props.onNodeMove(c.id, c.position.x, c.position.y);
      if (c.dragging === false) props.onNodeDragStop?.(c.id, c.position.x, c.position.y);
    }
  };
  const onEdgesChange = (_changes: EdgeChange<FlowEdge>[]) => {
    // selection styling is derived — clicks open the edge drawer
  };

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onEdgeClick={(_e, edge) => props.onEdgeOpen(Number(edge.id.replace(/[^0-9]/g, "")))}
      onConnect={(c: Connection) => {
        if (c.source && c.target && c.source !== c.target) {
          props.onConnect(c.source, c.target, c.sourceHandle ?? null);
        }
      }}
      onPaneClick={props.onPaneClick}
      nodesDraggable={!props.readonly}
      nodesConnectable={!props.readonly}
      isValidConnection={(c) => c.source !== c.target}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.75}
      deleteKeyCode={null}
      defaultEdgeOptions={{ type: "template" }}
      colorMode="dark"
    >
      <Background gap={22} size={1.4} className="!bg-background" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        position="bottom-right"
        className="!border !border-border !rounded-lg !bg-card overflow-hidden"
        nodeColor={() => "#52525b"}
        nodeStrokeColor={(n) => ((n.data as BuilderNodeData | undefined)?.selected ? "#3b82f6" : "transparent")}
        maskColor="oklch(0.141 0.005 285.823 / 0.6)"
      />
      <ApiBridge onApi={(api) => props.onApi?.(api)} />
    </ReactFlow>
  );
}

export default function BuilderCanvas(props: BuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <BuilderFlow {...props} />
    </ReactFlowProvider>
  );
}
