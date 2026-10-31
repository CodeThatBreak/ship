"use client";
/**
 * The edge configurator drawer (§8): kind/condition/label configured through
 * the shared EdgeEditor; the footer removes the edge by draft index.
 */
import { Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EdgeEditor,
  type EditorEdge,
  type EditorNode,
  type TaskProviderInfo,
} from "@/components/template-editor";
import type { TriggerField } from "./hooks/use-instance-contracts";
import { SheetFooterHelper } from "@/components/shared";

export interface EditorEdgeDrawerProps {
  edge: EditorEdge;
  edgeIndex: number;
  edges: EditorEdge[];
  /** the draft graph's instances — the From/To pickers' options */
  nodes: EditorNode[];
  /** the source node (the condition vocabulary's contract root) */
  sourceNode: EditorNode | null;
  templateId: string;
  readonly: boolean;
  taskFields: TaskProviderInfo["contextFields"];
  triggerFields: TriggerField[];
  onClose: () => void;
  /** an edge-field patch (kind, label, condition) applied to this index */
  onPatch: (patch: Partial<EditorEdge>) => void;
  onRemove: () => void;
}

export function EditorEdgeDrawer({
  edge,
  edgeIndex,
  edges,
  nodes,
  sourceNode,
  templateId,
  readonly,
  taskFields,
  triggerFields,
  onClose,
  onPatch,
  onRemove,
}: EditorEdgeDrawerProps) {
  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Workflow size={14} className="text-muted-foreground" /> Edge
            <Badge variant="outline">{edge.kind}</Badge>
          </SheetTitle>
          <SheetDescription className="font-mono text-[11.5px]">
            {edge.from} → {edge.to}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <EdgeEditor
            edge={edge}
            edges={edges}
            edgeIndex={edgeIndex}
            nodes={nodes}
            readonly={readonly}
            templateId={templateId}
            taskFields={taskFields}
            triggerFields={triggerFields}
            sourceNode={sourceNode}
            onChange={onPatch}
          />
        </SheetBody>
        <SheetFooter>
          {!readonly && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              onClick={onRemove}
            >
              Remove edge
            </Button>
          )}
          <SheetFooterHelper />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The esc helper note is shared with the node drawer (EditorNodeDrawer). */
