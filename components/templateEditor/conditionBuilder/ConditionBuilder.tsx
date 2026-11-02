"use client";
/**
 * The structured condition editor: `[variable ▾][op ▾][value]` rows joined by
 * AND/OR, compiled to JSONata. Raw escapes: "edit raw" switches to an
 * ExpressionInput; an expression that doesn't decompose into rows opens in
 * raw mode directly. The value passed up stays the raw JSONata string.
 * Draft state lives in `use-condition-state`, the row and raw-mode views in
 * their sibling files.
 */
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { lintJsonata } from "@/lib/jsonata";
import { compileCondition } from "../conditionGrammar";
import { jsonataPathOptions, type VarGroup } from "../variables";
import { COMBINATOR_LABELS, PATH_FIELD_PLACEHOLDER } from "./constants";
import { ConditionRowEditor } from "./ConditionRowEditor";
import { ConditionRawEditor } from "./ConditionRawEditor";
import { PreviewLine } from "./PreviewLine";
import { useConditionState } from "./useConditionState";
import { useExpressionPreview } from "./useExpressionPreview";
import type { PreviewScope } from "./types";

export function ConditionBuilder({
  value,
  onChange,
  varGroups,
  templateId,
  scope = "context",
  placeholder,
  disabled,
}: {
  /** the raw JSONata condition (null / "" = none) */
  value: string | null;
  onChange: (raw: string | null) => void;
  /** JSONata-stripped groups (asJsonataGroups) — the variable pickers' lists */
  varGroups?: VarGroup[];
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  disabled?: boolean;
}) {
  const options = useMemo(
    () => jsonataPathOptions(varGroups ?? []),
    [varGroups],
  );
  const {
    rows,
    combinator,
    mode,
    rawDraft,
    rawDecomposed,
    patchRow,
    removeRow,
    addCondition,
    changeCombinator,
    editRawDraft,
    commitRaw,
    switchToRaw,
    buildVisually,
  } = useConditionState({ value, onChange });

  // the builder mode's preview — raw mode's ExpressionInput fetches its own
  // (the outer hook is inert on null, no duplicate requests)
  const { state: preview, retry: retryPreview } = useExpressionPreview(
    mode === "builder" ? compileCondition(rows, combinator) : null,
    { templateId, scope },
  );
  // client-side compile check on what the builder emits (instant — the
  // preview's server round trip only carries the value). An empty compile
  // means no condition — linting "" would itself be a JSONata error (S0207,
  // "unexpected end of expression"), so it emits nothing instead of noise.
  const compiledLint = useMemo(() => {
    if (mode !== "builder") return null;
    const out = compileCondition(rows, combinator);
    return out ? lintJsonata(out) : null;
  }, [mode, rows, combinator]);

  if (disabled) {
    return value?.trim() ? (
      <code className="block rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11.5px] break-all">
        {value}
      </code>
    ) : (
      <p className="text-[12px] text-muted-foreground m-0">(no condition)</p>
    );
  }

  if (mode === "raw") {
    return (
      <ConditionRawEditor
        rawDraft={rawDraft ?? ""}
        rawDecomposed={rawDecomposed}
        varGroups={varGroups}
        templateId={templateId}
        scope={scope}
        placeholder={placeholder}
        onEdit={editRawDraft}
        onCommit={commitRaw}
        onBuildVisually={buildVisually}
      />
    );
  }

  return (
    <div className="grid gap-1.5">
      {rows.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Match</span>
          <Select
            value={combinator}
            onValueChange={changeCombinator}
          >
            <SelectTrigger className="h-7 w-[130px] rounded-lg border-border bg-card text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">{COMBINATOR_LABELS.and}</SelectItem>
              <SelectItem value="or">{COMBINATOR_LABELS.or}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {rows.map((r, i) => (
        <ConditionRowEditor
          key={r.id}
          row={r}
          index={i}
          options={options}
          placeholder={placeholder ?? PATH_FIELD_PLACEHOLDER}
          onPatch={patchRow}
          onRemove={removeRow}
        />
      ))}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={addCondition}
        >
          <Plus size={12} /> Add condition
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={switchToRaw}
        >
          Edit raw expression
        </Button>
      </div>
      {!rows.some((r) => r.path.trim()) && !value?.trim() && placeholder && (
        <p className="text-[11px] text-muted-foreground m-0">
          No condition — the flow always takes this path. Add one to gate it on
          the data.
        </p>
      )}
      {compiledLint && (
        <p className="text-[11px] text-destructive m-0">{compiledLint}</p>
      )}
      <PreviewLine state={preview} retry={retryPreview} />
    </div>
  );
}
