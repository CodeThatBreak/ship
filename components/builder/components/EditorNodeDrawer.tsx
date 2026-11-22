'use client';
/**
 * The node configurator drawer: the open instance's display name (editable
 * unless read-only), its kind/trigger badges, the body (the shared
 * NodeConfiguratorBody) and the footer (remove node).
 */
import { Trash2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  NodeConfiguratorBody,
  type IncomingLink,
} from '@/components/templateEditor/components/configurator/NodeConfigurator';
import {
  describeTrigger,
  nodeLabel,
  type EditorNode,
  type TaskProviderInfo,
  type EditorNodePatch,
} from '@/components/templateEditor/types';
import { iconForIconName } from '@/components/templateEditor/icons';
import { KIND_LABELS } from '@/components/templateEditor/draft';
import type { TriggerField } from '../hooks/useInstanceContracts';

/** Node-type badge copy — the palette's proper labels, not the raw kind key. */
const NODE_TYPE_LABELS: Record<string, string> = {
  ...KIND_LABELS,
  builtin: 'Built-in',
};

function nodeTypeLabel(node: EditorNode): string {
  const kind = node.kind ?? 'builtin';
  return NODE_TYPE_LABELS[kind] ?? kind;
}

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
  taskFields: TaskProviderInfo['contextFields'];
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
  const NodeIcon = iconForIconName(node?.icon, node?.kind, node?.catalogName);
  return (
    <Sheet
      open={open}
      onOpenChange={v => {
        if (!v) onClose();
      }}
    >
      {node && (
        <SheetContent className="w-[640px] max-w-[calc(100vw-18rem)]" showCloseButton={false}>
          <SheetHeader className="pr-5">
            <SheetTitle className="flex flex-col items-stretch gap-2">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <NodeIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Display name"
                  value={readonly ? nodeLabel(node) : (node.overrideLabel ?? '')}
                  placeholder={node.catalogName ?? node.key}
                  readOnly={readonly}
                  onChange={e => onPatch({ overrideLabel: e.target.value || null })}
                />
              </InputGroup>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{nodeTypeLabel(node)}</Badge>
                <Badge variant="outline">
                  <Zap data-icon="inline-start" />
                  {describeTrigger(node.trigger)}
                </Badge>
                {node.joinMode === 'any' && (
                  <Badge className="bg-warning/10 text-warning text-[10px] py-0">any-join</Badge>
                )}
              </div>
            </SheetTitle>
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
          <SheetFooter className="justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {!readonly && (
              <Button variant="destructive" onClick={() => onRemove(node)}>
                <Trash2 size={13} /> Remove node
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      )}
    </Sheet>
  );
}
