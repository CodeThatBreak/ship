"use client";
/**
 * The raw JSONata editing mode: the multi-line ExpressionInput (its `= value`
 * preview and lint live inside it) plus the "build visually" escape hatch —
 * offered whenever the typed draft decomposes into rows again.
 */
import { Table2 } from "lucide-react";
import { Button } from "../../ui/button";
import { ExpressionInput } from "./ExpressionInput";
import { RAW_EXPRESSION_PLACEHOLDER } from "./constants";
import type { VarGroup } from "../variables";
import type { DecomposedCondition } from "./use-condition-state";
import type { PreviewScope } from "./types";

export function ConditionRawEditor({
  rawDraft,
  rawDecomposed,
  varGroups,
  templateId,
  scope,
  placeholder,
  onEdit,
  onBuildVisually,
}: {
  /** the raw text while in raw mode (typing does not commit per keystroke —
   *  the parent's value only moves on a complete edit) */
  rawDraft: string;
  /** decomposable again? (drives the "build visually" escape) */
  rawDecomposed: DecomposedCondition | null;
  varGroups?: VarGroup[];
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  /** the raw draft's edit — the hook commits it upstream */
  onEdit: (v: string) => void;
  /** back to rows (guarded by the hook — inert while not decomposable) */
  onBuildVisually: () => void;
}) {
  return (
    <div className="grid gap-1">
      <ExpressionInput
        value={rawDraft}
        onChange={onEdit}
        varGroups={varGroups}
        templateId={templateId}
        scope={scope}
        rows={3}
        placeholder={placeholder ?? RAW_EXPRESSION_PLACEHOLDER}
      />
      {rawDecomposed && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onBuildVisually}
          >
            <Table2 size={12} /> Build it visually
          </Button>
        </div>
      )}
    </div>
  );
}
