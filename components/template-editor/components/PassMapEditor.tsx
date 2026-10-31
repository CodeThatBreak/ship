"use client";
/**
 * The decision's pass-down variables — field → JSONata rows edited in place
 * (the `pass` instance override), extracted from ConfigFieldRow.tsx. Every
 * field is merged into the decision's output beside chosen / rationale, so
 * nodes attached to a branch address them as `{{input.<field>}}` with no
 * extra wiring; a row with a name but no expression writes nothing.
 */
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { FieldTitle } from "../../ui/field";
import { PassMapRow } from "./PassMapRow";
import { usePassMapRows } from "../hooks/use-pass-map-rows";
import { condVarGroups } from "../config-field-logic";
import type { VarGroup } from "../variables";

export function PassMapEditor({
  field,
  value,
  defaultValue,
  varGroups,
  templateId,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string };
  value: unknown;
  defaultValue?: unknown;
  varGroups?: VarGroup[];
  templateId?: string;
  onChange: (v: unknown) => void;
}) {
  const { rows, editRow, addRow, removeRow } = usePassMapRows({
    value,
    defaultValue,
    onChange,
  });
  const jsonataGroups = condVarGroups(varGroups);
  return (
    <div className="grid gap-1.5">
      <FieldTitle>{field.label}</FieldTitle>
      {rows.map((r, i) => (
        <PassMapRow
          key={r.id}
          index={i}
          row={r}
          varGroups={jsonataGroups}
          templateId={templateId}
          onEdit={editRow}
          onRemove={removeRow}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addRow}
      >
        <Plus size={12} /> Add variable
      </Button>
      <p className="text-[11px] text-muted-foreground m-0">
        Downstream nodes read these as{" "}
        <code className="font-mono">{`{{input.<field>}}`}</code> — chosen /
        rationale are passed automatically.
      </p>
    </div>
  );
}
