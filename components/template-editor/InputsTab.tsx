"use client";
/**
 * The Inputs tab (Phase 4): what this node receives. The engine merges every
 * `next`-edge parent's published output (last wins) into the node's input and
 * overlays the template's `input_map[field] = "<JSONata>"` mappings on top
 * (`evalInputMap`) — this tab makes both visible and editable:
 *
 *   summary    ← Review · output.summary            inherited        [re-map]
 *   branch     ← Build · output.plan                mapped           [re-map] [✕]
 *   ticket_key ← Task · key                         mapped           [re-map] [✕]
 *   + Map a field
 *
 * Inherited rows are greyed and not deletable — re-mapping one creates an
 * `input_map` override that shadows it (removing the override falls back to
 * the inherited value). Mapped rows write straight into the node's existing
 * `input_map` config, which the engine already evaluates over the flow
 * context — zero runtime changes. The row list lives in `InputRow`/`EditRow`
 * and the edit state machine in `useInputMap`; this container composes them.
 */
import { useCallback } from "react";
import { Info, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { EditorNode } from "./types";
import type { UpstreamVarSource } from "./variables";
import { useInputMap, type SourceField } from "./hooks/use-input-map";
import { EditRow } from "./components/EditRow";
import { InputRow } from "./components/InputRow";

export function InputsTab({
  node,
  upstream,
  taskFields,
  triggerFields,
  templateId,
  onChange,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  /** the `next`-edge parents' published fields (resolved contracts) */
  upstream: UpstreamVarSource[];
  taskFields?: SourceField[];
  triggerFields?: SourceField[];
  /** the owning template's id (Phase 5) — the custom expression's preview */
  templateId?: string;
}) {
  const { map, editing, rows, editingRow, commitEdit, beginEdit, beginNew, cancelEdit, removeMap, removeEditing } =
    useInputMap({ node, onChange, upstream, taskFields, triggerFields });

  // re-map: editing an unmapped row fixes its name (the inherited key must
  // keep resolving `{{input.<field>}}` in prompts); a mapped row renames freely
  const onRowRemap = useCallback(
    (name: string, mapped: boolean) => beginEdit(name, !mapped),
    [beginEdit],
  );

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-1.5">
        <p className="text-[12.5px] font-medium m-0">Inputs — what this node receives</p>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                <Info size={12} />
              </span>
            }
          />
          <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
            <span className="grid gap-1.5">
              <span>
                Inherited rows come from the connected parents&apos; outputs —
                addressed as <code className="font-mono">{`{{input.<field>}}`}</code> in
                prompts. Re-mapping one writes an override that shadows the
                inherited value.
              </span>
              <span>
                Mapped rows are raw JSONata over the flow context (
                <code className="font-mono">nodes.&lt;key&gt;.output.*</code>,{" "}
                <code className="font-mono">task.*</code>,{" "}
                <code className="font-mono">trigger.payload.*</code>,{" "}
                <code className="font-mono">flow.*</code> /{" "}
                <code className="font-mono">repo.*</code>) — evaluated when the
                node runs, overlaying the inherited merge.
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-muted-foreground m-0">
        Inherited rows come from the connected parents&apos; outputs; map a field
        to pull it from anywhere in the flow context instead.
      </p>

      {upstream.length === 0 && rows.length === 0 && !editing && (
        <p className="text-[12px] text-muted-foreground m-0">
          No upstream node — connect one on the canvas; whatever it publishes
          becomes this node&apos;s input. You can still map fields from the
          task context or the trigger payload.
        </p>
      )}

      {(rows.length > 0 || editing) && (
        // a plain bordered surface, not <Card>: the card primitive hard-codes
        // overflow-hidden + an outer ring, which clipped the mapping popover
        // and cut the ring off at the ScrollArea viewport's left edge
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {rows.map((r, i) =>
            i === editingRow ? null : (
              <InputRow
                key={r.name}
                name={r.name}
                type={r.type}
                from={r.from}
                expr={r.expr}
                onRemap={onRowRemap}
                onRemove={r.expr != null ? removeMap : undefined}
              />
            ),
          )}
          {editing && (
            <EditRow
              key={editing.isNew ? "__new__" : editing.originName}
              editing={editing}
              upstream={upstream}
              taskFields={taskFields}
              triggerFields={triggerFields}
              templateId={templateId}
              onCommit={commitEdit}
              onCancel={cancelEdit}
              onRemove={
                editing.originName != null && map[editing.originName] != null
                  ? removeEditing
                  : undefined
              }
            />
          )}
        </div>
      )}

      {!editing && (
        <Button variant="outline" size="sm" className="self-start" onClick={beginNew}>
          <Plus size={12} /> Map a field
        </Button>
      )}
    </div>
  );
}
