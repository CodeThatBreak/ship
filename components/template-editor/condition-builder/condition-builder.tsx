"use client";
/**
 * The structured condition editor: `[variable ▾][op ▾][value]` rows joined by
 * AND/OR, compiled to JSONata. Raw escapes: "edit raw" switches to an
 * ExpressionInput; an expression that doesn't decompose into rows opens in
 * raw mode directly. The value passed up stays the raw JSONata string.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Table2, Trash2 } from "lucide-react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { lintJsonata } from "../../../lib/engine/jsonata-eval";
import {
  compileCondition,
  decomposeCondition,
  type ConditionOp,
  type ConditionRow,
} from "../condition-grammar";
import { jsonataPathOptions, type VarGroup } from "../variables";
import { COMBINATOR_LABELS, CONDITION_OPS, EMPTY_ROW, PATH_FIELD_PLACEHOLDER, RAW_EXPRESSION_PLACEHOLDER } from "./constants";
import { PathField } from "./path-field";
import { ExpressionInput } from "./expression-input";
import { PreviewLine } from "./preview-line";
import { useExpressionPreview } from "./use-expression-preview";
import type { JsonataPathOption } from "../variables";
import type { Combinator, PreviewScope } from "./types";

/**
 * One `[variable ▾][op ▾][value]` row — presentational. The builder owns the
 * state and hands down per-index handlers, so no callbacks are minted inside
 * the rows `.map()` (§2.5).
 */
function ConditionRowEditor({
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
          onChange={(e) => onPatch(index, { value: e.target.value })}
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
  /** the builder's local rows — emitted only when they compile */
  const [rows, setRows] = useState<ConditionRow[]>([]);
  const [combinator, setCombinator] = useState<Combinator>("and");
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  /** the compiled text last emitted — external values equal to it don't reset the rows */
  const lastEmitted = useRef<string | null>(null);
  /** the raw text while in raw mode (the parent's value only moves on a
   *  complete edit — typing raw does not ping-pong through the parent) */
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  // seed from the incoming value: decomposable → builder rows, else raw mode
  // ("" and null are the same "no condition" — a clear doesn't re-seed)
  useEffect(() => {
    if (value === lastEmitted.current || (!value && !lastEmitted.current))
      return;
    lastEmitted.current = null;
    const dec = decomposeCondition(value);
    if (dec) {
      setRows(dec.rows.length ? dec.rows : [EMPTY_ROW]);
      setCombinator(dec.combinator);
      setMode("builder");
    } else {
      setMode("raw");
      setRawDraft(value ?? "");
    }
  }, [value]);

  const emit = (next: ConditionRow[], comb: Combinator) => {
    setRows(next);
    setCombinator(comb);
    const out = compileCondition(next, comb);
    // store what the parent will hold ("" collapses to null) — the seed
    // effect skips values that match, so a clear doesn't re-seed and wipe
    // the rows mid-edit
    lastEmitted.current = out || null;
    onChange(out || null);
  };

  // per-index handlers, created once per render (never inside the rows map)
  const patchRow = (index: number, patch: Partial<ConditionRow>) =>
    emit(
      rows.map((x, j) => (j === index ? { ...x, ...patch } : x)),
      combinator,
    );
  const removeRow = (index: number) =>
    emit(rows.filter((_, j) => j !== index), combinator);

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
  // decomposable again while editing raw? (drives the "build visually" escape)
  const rawDecomposed = useMemo(() => decomposeCondition(rawDraft), [rawDraft]);

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
      <div className="grid gap-1">
        <ExpressionInput
          value={rawDraft ?? ""}
          onChange={(v) => {
            setRawDraft(v);
            lastEmitted.current = v || null;
            onChange(v || null);
          }}
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
              onClick={() => {
                if (!rawDecomposed) return;
                setRows(rawDecomposed.rows.length ? rawDecomposed.rows : [EMPTY_ROW]);
                setCombinator(rawDecomposed.combinator);
                setMode("builder");
              }}
            >
              <Table2 size={12} /> Build it visually
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {rows.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Match</span>
          <Select
            value={combinator}
            onValueChange={(v) => emit(rows, (v as Combinator) ?? "and")}
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
          key={i}
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
          onClick={() => emit([...rows, EMPTY_ROW], combinator)}
        >
          <Plus size={12} /> Add condition
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setRawDraft(value ?? "");
            setMode("raw");
          }}
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
