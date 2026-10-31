"use client";
/**
 * One `[variable ▾][op ▾][value]` row — presentational with its remove
 * button. The builder owns the state and hands down per-index handlers, so
 * no callbacks are minted inside the rows `.map()` (§2.5).
 */
import { Trash2 } from "lucide-react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { CONDITION_OPS } from "./constants";
import { PathField } from "./PathField";
import {
  inferValueKind,
  type ConditionOp,
  type ConditionRow,
} from "../condition-grammar";
import type { JsonataPathOption } from "../variables";

export function ConditionRowEditor({
  row,
  index,
  options,
  placeholder,
  onPatch,
  onRemove,
}: {
  row: ConditionRow;
  index: number;
  options: JsonataPathOption[];
  placeholder: string;
  onPatch: (index: number, patch: Partial<ConditionRow>) => void;
  onRemove: (index: number) => void;
}) {
  const needsValue = CONDITION_OPS.find((o) => o.value === row.op)?.needsValue;
  return (
    <div className="flex items-start gap-1.5">
      <PathField
        value={row.path}
        options={options}
        placeholder={placeholder}
        onChange={(path) => onPatch(index, { path })}
      />
      <Select
        value={row.op}
        onValueChange={(v) => onPatch(index, { op: v as ConditionOp })}
      >
        <SelectTrigger className="h-9 w-[112px] shrink-0 rounded-lg border-border bg-card text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <Input
          value={row.value}
          placeholder="value"
          className="w-[130px] shrink-0 font-mono text-[12px]"
          onChange={(e) =>
            onPatch(index, {
              value: e.target.value,
              valueKind: inferValueKind(e.target.value),
            })
          }
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground shrink-0"
        title="Remove condition"
        onClick={() => onRemove(index)}
      >
        <Trash2 size={12} />
      </Button>
    </div>
  );
}
