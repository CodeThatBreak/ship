"use client";
import { Table2 } from "lucide-react";
import { Button } from "../../ui/button";
import { ExpressionInput } from "./ExpressionInput";
import { RAW_EXPRESSION_PLACEHOLDER } from "./constants";
import type { VarGroup } from "../variables";
import type { DecomposedCondition } from "./use-condition-state";
import type { PreviewScope } from "./types";

export const ConditionRawEditor = ({
  rawDraft,
  rawDecomposed,
  varGroups,
  templateId,
  scope,
  placeholder,
  onEdit,
  onCommit,
  onBuildVisually,
}: {
  rawDraft: string;
  rawDecomposed: DecomposedCondition | null;
  varGroups?: VarGroup[];
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  onEdit: (v: string) => void;
  onCommit: () => void;
  onBuildVisually: () => void;
}) => {
  return (
    <div className="grid gap-1">
      <ExpressionInput
        value={rawDraft}
        onChange={onEdit}
        onBlur={onCommit}
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
};
