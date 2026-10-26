"use client";
/**
 * One decision pass-down row, extracted from ConfigFieldRow.tsx: the field
 * name box and the live ExpressionInput (Phase 5) — paths autocomplete from
 * the flow context vocabulary, compile errors surface inline, and the
 * evaluated value renders underneath.
 */
import { Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { ExpressionInput } from "../condition-builder";
import type { PassMapDraft } from "../hooks/use-pass-map-rows";
import type { VarGroup } from "../variables";

export function PassMapRow({
  index,
  row,
  varGroups,
  templateId,
  onEdit,
  onRemove,
}: {
  index: number;
  row: PassMapDraft;
  /** the flow-context vocabulary, brace-stripped (`condVarGroups`) */
  varGroups?: VarGroup[];
  /** the owning template's id — the expression editor's preview */
  templateId?: string;
  onEdit: (index: number, patch: Partial<PassMapDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-1.5 items-start">
      <Input
        value={row.field}
        placeholder="field name"
        className="font-mono text-[12px]"
        onChange={(e) => onEdit(index, { field: e.target.value })}
      />
      <div className="flex gap-1.5 items-start">
        <ExpressionInput
          value={row.expr}
          varGroups={varGroups}
          templateId={templateId}
          scope="context"
          rows={1}
          placeholder="JSONata — e.g. nodes.review.output.summary"
          onChange={(v) => onEdit(index, { expr: v })}
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          title="Remove variable"
          onClick={() => onRemove(index)}
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  );
}
