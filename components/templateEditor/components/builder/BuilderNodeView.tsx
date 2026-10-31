"use client";
/**
 * The flow-builder's custom node render (split from the canvas): the node
 * card with its badges, connect handles and a decision node's labeled
 * branch handles. The registry wiring (`nodeTypes`) lives in builder-flow.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { EditorNode } from '../../types';
import { iconForIconName } from '../../icons';

export type BuilderNodeData = {
  node: EditorNode;
  selected: boolean;
  readonly: boolean;
  /** no edges touch this node — configuration is gated until it's connected */
  unlinked?: boolean;
  /** decision branch choices — one labeled source handle per choice, so
   *  attaching a node wires the pre-labeled branch edge (no edge editing) */
  choices?: { label: string; description?: string; condition?: string }[];
  /** the static linter's problems for this node (Phase 5) — rendered as an
   *  error badge; clicking the node opens the drawer at the problem */
  problems?: string[];
  onOpen: (key: string) => void;
};

const TRIGGER_STYLE: Record<string, string> = {
  approval: "bg-warning/10 text-warning",
  manual: "bg-info/10 text-info",
  debounced: "bg-violet-500/10 text-violet-400",
  auto: "bg-muted text-muted-foreground",
};

export function BuilderNodeView({ id, data }: NodeProps<Node<BuilderNodeData>>) {
  const { node, selected, readonly, unlinked, choices, problems, onOpen } = data;
  const label = node.overrideLabel || node.catalog_name || node.key;
  const Icon = iconForIconName(node.icon, node.kind ?? (node.is_builtin ? node.key : null), node.key);
  const isDecision = node.kind === "decision";
  const branches = isDecision && choices?.length ? choices : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(id);
        }
      }}
      className={cn(
        "group relative rounded-lg border-[1.5px] bg-card cursor-pointer px-3 py-2 min-w-[148px] max-w-[188px] flex items-center gap-2.5 transition-all duration-150",
        "hover:shadow-panel",
        selected ? "border-info bg-popover shadow-panel" : "border-border",
        readonly && "cursor-default",
        !readonly && unlinked && "ring-1 ring-warning/50",
      )}
      title={readonly
        ? "Built-in template — read-only"
        : unlinked
          ? "Not connected — drag from a handle to wire it in (click to configure meanwhile)"
          : "Click to configure · right-click to duplicate"}
    >
      {!readonly && unlinked && (
        <span className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[9px] font-bold text-background" title="Needs a connection">
          !
        </span>
      )}
      {problems && problems.length > 0 && (
        <span
          className={cn(
            "absolute z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-background",
            !readonly && unlinked ? "-top-3.5 -right-1.5" : "-top-1.5 -right-1.5",
          )}
          title={problems.join("\n")}
        >
          {problems.length}
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
          <span className={cn("rounded-lg px-1 py-px text-[9.5px] font-medium", TRIGGER_STYLE[node.trigger.type] ?? TRIGGER_STYLE.auto)}>
            {node.trigger.type}
          </span>
          {node.trigger.wait_for && (
            <span
              className="rounded-lg px-1 py-px text-[9.5px] font-medium bg-muted text-muted-foreground"
              title="wait_for event source"
            >
              ⧗ {(node.trigger.wait_for ?? "").slice(0, 14)}
            </span>
          )}
          {node.join_mode === "any" && (
            <span className="rounded-lg px-1 py-px text-[9.5px] font-medium bg-warning/10 text-warning">any-join</span>
          )}
          {isDecision && (
            <span className="rounded-lg px-1 py-px text-[9.5px] font-medium bg-violet-500/10 text-violet-300">branch</span>
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

/** Visible connect handles (Phase 6, G1): the SOURCE handle is always
 *  visible (slightly dimmed, full on hover) so new users see where a
 *  connection starts; the target handle is hover-revealed as before. */
function HandleConnect({ type }: { type: "source" | "target" }) {
  return (
    <Handle
      type={type}
      position={type === "source" ? Position.Right : Position.Left}
      className={cn(
        "!h-2.5 !w-2.5 !border-2 !border-background !bg-info transition-opacity",
        type === "source"
          ? "opacity-70 hover:!opacity-100"
          : "opacity-0 group-hover:opacity-100",
      )}
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
