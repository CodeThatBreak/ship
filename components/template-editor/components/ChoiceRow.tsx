"use client";
/**
 * One decision branch-choice row, extracted from ConfigFieldRow.tsx: the
 * label + description inputs, the remove button, and — for the `expression`
 * source — the structured ConditionBuilder over the flow context (rows of
 * `[variable][op][value]` compiled to JSONata, the raw language one toggle
 * away, the value previewed underneath).
 */
import { Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { cn } from "../../../lib/utils";
import { ConditionBuilder } from "../condition-builder";
import type { ChoiceDraft } from "../hooks/use-choice-rows";
import type { VarGroup } from "../variables";

export function ChoiceRow({
  index,
  choice,
  showCondition,
  varGroups,
  templateId,
  removeDisabled,
  onEdit,
  onRemove,
}: {
  index: number;
  choice: ChoiceDraft;
  /** the decision's source is `expression` — the choice carries a JSONata condition */
  showCondition: boolean;
  /** the flow-context vocabulary, brace-stripped (`condVarGroups`) */
  varGroups?: VarGroup[];
  /** the owning template's id — the condition editor's preview */
  templateId?: string;
  removeDisabled: boolean;
  onEdit: (index: number, patch: Partial<ChoiceDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div
      className={cn(
        "grid gap-1.5 rounded-lg border border-border p-2",
        showCondition && choice.condition.trim() && "border-violet-500/40",
      )}
    >
      <div className="flex gap-1.5">
        <Input
          value={choice.label}
          placeholder="label"
          className="max-w-[140px] font-mono text-[12px]"
          onChange={(e) => onEdit(index, { label: e.target.value })}
        />
        <Input
          value={choice.description}
          placeholder="description (steers an agent classifier)"
          className="text-[12px]"
          onChange={(e) => onEdit(index, { description: e.target.value })}
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={removeDisabled}
          title="Remove choice"
          onClick={() => onRemove(index)}
        >
          <Trash2 size={12} />
        </Button>
      </div>
      {showCondition && (
        <ConditionBuilder
          value={choice.condition}
          varGroups={varGroups}
          templateId={templateId}
          scope="context"
          placeholder="nodes.review.output.comment_count > 0"
          onChange={(raw) => onEdit(index, { condition: raw ?? "" })}
        />
      )}
    </div>
  );
}
