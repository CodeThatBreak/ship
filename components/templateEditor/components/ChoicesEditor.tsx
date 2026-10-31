"use client";
/**
 * The decision node's branch choices — label + description rows edited in
 * place (written as the instance override), extracted from ConfigFieldRow.tsx.
 * At least one labeled choice is required by the decision schema; an
 * all-empty edit keeps the last good set and warns instead.
 *
 * For the `expression` source each choice also carries a JSONata `condition`
 * over the flow context — every truthy condition picks that branch.
 */
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { FieldTitle } from "../../ui/field";
import { ChoiceRow } from "./ChoiceRow";
import { useChoiceRows } from "../hooks/useChoiceRows";
import { condVarGroups } from "../configFieldLogic";
import type { VarGroup } from "../variables";

export function ChoicesEditor({
  value,
  defaultValue,
  source,
  varGroups,
  templateId,
  onChange,
}: {
  value: unknown;
  defaultValue?: unknown;
  /** the decision's current source — "expression" adds the condition builders */
  source?: string;
  varGroups?: VarGroup[];
  templateId?: string;
  onChange: (v: unknown) => void;
}) {
  const isExpression = source === "expression";
  const { rows, editChoice, addChoice, removeChoice } = useChoiceRows({
    value,
    defaultValue,
    onChange,
  });
  const jsonataGroups = condVarGroups(varGroups);
  return (
    <div className="grid gap-1.5">
      <FieldTitle>Choices (branch labels)</FieldTitle>
      {rows.map((c, i) => (
        <ChoiceRow
          key={c.id}
          index={i}
          choice={c}
          showCondition={isExpression}
          varGroups={jsonataGroups}
          templateId={templateId}
          removeDisabled={rows.length <= 1}
          onEdit={editChoice}
          onRemove={removeChoice}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addChoice}
      >
        <Plus size={12} /> Add choice
      </Button>
      {!rows.some((c) => c.label.trim()) && (
        <p className="text-[11px] text-warning m-0">
          At least one labeled choice is required.
        </p>
      )}
      {isExpression && !rows.some((c) => c.condition.trim()) && (
        <p className="text-[11px] text-warning m-0">
          No condition yet — give each choice a condition; every truthy
          condition picks its branch.
        </p>
      )}
    </div>
  );
}
