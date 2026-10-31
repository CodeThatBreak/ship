"use client";
/**
 * The node configurator drawer: the open instance's display name (editable
 * unless read-only), its kind/trigger badges, the body (the shared
 * NodeConfiguratorBody) and the footer (remove + the esc helper note).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  NodeConfiguratorBody,
  describeTrigger,
  type EditorNode,
  type IncomingLink,
  type TaskProviderInfo,
  type EditorNodePatch,
} from "@/components/template-editor";
import type { TriggerField } from "./hooks/use-instance-contracts";

export interface EditorNodeDrawerProps {
  open: boolean;
  node: EditorNode | null;
  /** the incoming edges (the Inputs tab's upstream pickers) */
  incoming: IncomingLink[];
  /** an isolated node can't be configured yet */
  locked: boolean;
  /** the fan-out gate (save-time lint rule 1, mirrored): only nodes a plan
   *  node reaches through next edges expand */
  planDownstream: boolean;
  taskFields: TaskProviderInfo["contextFields"];
  triggerFields: TriggerField[];
  /** refs underlined in the prompt editor (the linter's problems) */
  invalidRefs?: Record<string, string>;
  /** the linter's problems for this node (the Problems list block) */
  problems?: string[];
  templateId: string;
  readonly: boolean;
  /** close the drawer (a click on the sheet's outside / Esc) */
  onClose: () => void;
  /** a node-field patch (name, config knobs, trigger, input remaps…) */
  onPatch: (patch: EditorNodePatch) => void;
  onRemove: (node: EditorNode) => void;
  registerPendingFlush?: (flush: () => void) => () => void;
}

export function EditorNodeDrawer({
  open,
  node,
  incoming,
  locked,
  planDownstream,
  taskFields,
  triggerFields,
  invalidRefs,
  problems,
  templateId,
  readonly,
  onClose,
  onPatch,
  onRemove,
  registerPendingFlush,
}: EditorNodeDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      {node && (
        <SheetContent className="w-[640px] max-w-[calc(100vw-18rem)]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {readonly ? (
                <span className="truncate">
                  {node.overrideLabel || node.catalog_name || node.key}
                </span>
              ) : (
                <Input
                  aria-label="Display name"
                  value={node.overrideLabel ?? ""}
                  placeholder={node.catalog_name ?? node.key}
                  className="h-7 w-1/2 rounded-none border-x-0 border-t-0 px-1.5 text-[15px] font-semibold focus-visible:ring-0"
                  onChange={(e) => {
                    if (readonly) return;
                    onPatch({ overrideLabel: e.target.value || null });
                  }}
                />
              )}
              <Badge variant="outline" className="shrink-0">
                {node.kind ?? "builtin"}
              </Badge>
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2 flex-wrap">
              <code className="font-mono">{node.key}</code>
              <span>·</span>
              <span>{describeTrigger(node.trigger)}</span>
              {node.join_mode === "any" && (
                <Badge className="bg-warning/10 text-warning text-[10px] py-0">
                  any-join
                </Badge>
              )}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <NodeConfiguratorBody
              node={node}
              incoming={incoming}
              locked={locked}
              planDownstream={planDownstream}
              taskFields={taskFields}
              triggerFields={triggerFields}
              invalidRefs={invalidRefs}
              templateId={templateId}
              problems={problems}
              readOnly={readonly}
              onChange={onPatch}
              registerPendingFlush={registerPendingFlush}
            />
          </SheetBody>
          <SheetFooter>
            {!readonly && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => onRemove(node)}
              >
                Remove node
              </Button>
            )}
            <SheetFooterHelper />
          </SheetFooter>
        </SheetContent>
      )}
    </Sheet>
  );
}

/** Small helper text for drawer footers (kept declarative). */
export function SheetFooterHelper() {
  return (
    <span className="text-[11px] text-muted-foreground sm:mr-2">
      Esc closes · edits live on the canvas draft
    </span>
  );
}
