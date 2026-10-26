"use client";
/**
 * The JSONata condition builder (Phase 5, Tier 1) + the autocomplete/live-
 * feedback expression box (Tiers 2–3).
 *
 *   • ConditionBuilder — the structured `[variable ▾][op ▾][value]` editor with
 *     AND/OR composition that compiles to a JSONata expression. Replaces the
 *     raw boxes for edge conditions, decision per-choice conditions and the
 *     webhook filter. A small "edit raw" toggle keeps the full language
 *     reachable (progressive disclosure: the default path never shows raw
 *     JSONata); expressions that don't decompose into rows open in raw mode.
 *   • ExpressionInput — the raw box that remains (pass maps, response maps,
 *     the builder's raw mode): paths autocomplete from the shared variable
 *     vocabulary as you type, compile errors surface inline (lintJsonata is
 *     pure JS — no server round trip), and the live preview renders the
 *     expression's current value against real context (see below).
 *
 * The stored value stays the raw JSONata string everywhere — the builder is
 * an authoring view over it, not a new format.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Table2, Trash2 } from "lucide-react";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { lintJsonata } from "../../lib/engine/jsonata-eval";
import {
  compileCondition,
  decomposeCondition,
  type ConditionOp,
  type ConditionRow,
} from "./condition-grammar";
import {
  jsonataPathOptions,
  type JsonataPathOption,
  type VarGroup,
} from "./variables";

// ── the expression grammar the builder speaks ────────────────────────────────
// (the rows ⇄ JSONata grammar lives in condition-grammar.ts — pure and
// unit-testable; the ops table below is the editor-facing presentation)

/** The ops the builder offers — plain comparisons; the JSONata is compiled. */
const OPS: { value: ConditionOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "=", needsValue: true },
  { value: "ne", label: "≠", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
];

// ── live preview (Tier 3): the value under the box ───────────────────────────

export type PreviewScope = "context" | "response" | "delivery";

export interface PreviewState {
  loading: boolean;
  value?: unknown;
  error?: string;
  /** "run" = the template's most recent flow; "sample" = canned sample data */
  source?: "run" | "sample";
}

/**
 * The expression's current value, evaluated server-side against real context
 * (the template's most recent run's flow context — or a canned sample derived
 * from the template's contracts when nothing has run yet). Debounced; inert
 * without a templateId.
 */
export function useExpressionPreview(
  expr: string | null,
  opts: { templateId?: string; scope?: PreviewScope },
): PreviewState {
  const [state, setState] = useState<PreviewState>({ loading: false });
  const { templateId, scope = "context" } = opts;
  useEffect(() => {
    const e = (expr ?? "").trim();
    if (!templateId || !e) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      fetch(`/api/templates/${templateId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expr: e, scope }),
      })
        .then((r) => r.json())
        .then((d: { ok?: boolean; value?: unknown; error?: string; source?: "run" | "sample" }) => {
          if (alive) setState({ loading: false, value: d.value, error: d.error, source: d.source });
        })
        .catch(() => {
          if (alive) setState({ loading: false });
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [expr, templateId, scope]);
  return state;
}

/** `= value` line rendered under the editors (shared by builder + raw box). */
export function PreviewLine({ state, prefix = "=" }: { state: PreviewState; prefix?: string }) {
  if (state.loading) {
    return (
      <p className="text-[11px] text-muted-foreground m-0 flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-muted-foreground/40" />
        evaluating…
      </p>
    );
  }
  if (state.error) {
    return (
      <p className="text-[11px] text-destructive m-0">
        {prefix} error — {state.error}
      </p>
    );
  }
  if (!("value" in state)) return null;
  const v = state.value;
  const rendered =
    v === null ? "null"
    : typeof v === "string" ? JSON.stringify(v)
    : typeof v === "object" ? JSON.stringify(v)
    : String(v);
  return (
    <p className="text-[11px] text-success m-0" title={state.source === "sample" ? "Evaluated against sample data — no flow has run from this template yet" : "Evaluated against the template's most recent flow run"}>
      {prefix} {rendered}
      <span className="ml-1.5 text-[10px] text-muted-foreground">
        {state.source === "sample" ? "· sample data" : "· last run"}
      </span>
    </p>
  );
}

// ── path autocomplete (Tier 2) ───────────────────────────────────────────────

/** The path-ish token ending at the caret (letters, digits, `_`, `.`, `$`). */
function tokenBefore(text: string, caret: number): { start: number; token: string } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.$]/.test(text[start - 1])) start--;
  return { start, token: text.slice(start, caret) };
}

function matchOptions(options: JsonataPathOption[], token: string): JsonataPathOption[] {
  const q = token.trim().toLowerCase();
  const hits = options.filter(
    (o) => !q || o.path.toLowerCase().includes(q),
  );
  return hits.slice(0, 8);
}

/**
 * The autocomplete popover — one anchored panel over the field showing the
 * matching paths (the same vocabulary as the prompt `@` menu). Shared by the
 * path fields and the raw expression boxes.
 */
function PathPopover({
  options,
  token,
  onPick,
  onDismiss,
}: {
  options: JsonataPathOption[];
  token: string;
  onPick: (path: string) => void;
  onDismiss: () => void;
}) {
  const shown = matchOptions(options, token);
  const [highlight, setHighlight] = useState(0);
  const count = shown.length;
  useEffect(() => setHighlight(0), [token, count]);
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.min(count - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onPick(shown[Math.min(highlight, count - 1)].path);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [count, highlight, shown, onPick, onDismiss]);
  if (!count) return null;
  return (
    <div className="absolute left-0 top-full z-50 mt-1 flex w-80 max-h-56 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg">
      <ScrollArea className="flex-1">
      {shown.map((o, i) => (
        <Fragment key={o.path + i}>
          {(i === 0 || shown[i - 1].group !== o.group) && (
            <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {o.group}
            </div>
          )}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o.path);
            }}
            onMouseEnter={() => setHighlight(i)}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
              i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
            )}
          >
            <code className="font-mono text-[11px] truncate">{o.path}</code>
            {o.type && (
              <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{o.type}</span>
            )}
          </button>
        </Fragment>
      ))}
      </ScrollArea>
    </div>
  );
}

/**
 * A single-line JSONata path field with autocomplete (the condition rows'
 * `[variable ▾]` — pickable from the vocabulary, freely typable beyond it).
 */
function PathField({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options: JsonataPathOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { start, token } = tokenBefore(value, caret ?? value.length);
  const pick = (path: string) => {
    if (caret == null) {
      onChange(path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className="font-mono text-[12px] min-w-0"
        onFocus={(e) => {
          setCaret(e.target.selectionStart ?? value.length);
          setDismissed(false);
        }}
        onBlur={() => setCaret(null)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
        }}
      />
      {caret != null && !dismissed && options.length > 0 && (
        <PathPopover
          options={options}
          token={token}
          onPick={pick}
          onDismiss={() => setDismissed(true)}
        />
      )}
    </div>
  );
}

// ── ExpressionInput: the raw box with autocomplete + live lint + preview ─────

/**
 * The raw JSONata box (Tier 2 + 3): paths autocomplete from the vocabulary,
 * compile errors surface inline as you type (client-side lintJsonata), and
 * the expression's value renders underneath against the live preview context.
 */
export function ExpressionInput({
  value,
  onChange,
  varGroups,
  templateId,
  scope = "context",
  placeholder,
  rows = 2,
  disabled,
  autoFocus,
}: {
  value: string;
  /** JSONata-stripped groups (asJsonataGroups) — the autocomplete vocabulary */
  varGroups?: VarGroup[];
  /** enables the live preview (no template → no context to evaluate against) */
  templateId?: string;
  scope?: PreviewScope;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** focus the box on mount (the Inputs tab's custom-expression field) */
  autoFocus?: boolean;
  onChange: (v: string) => void;
}) {
  const options = useMemo(() => jsonataPathOptions(varGroups ?? []), [varGroups]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // live compile feedback (pure JS — no round trip)
  const [compileErr, setCompileErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const e = value.trim();
      setCompileErr(e ? lintJsonata(e) : null);
    }, 300);
    return () => clearTimeout(t);
  }, [value]);
  const preview = useExpressionPreview(value, { templateId, scope });

  const { start, token } = tokenBefore(value, caret ?? value.length);
  const pick = (path: string) => {
    if (caret == null) {
      onChange(value + path);
    } else {
      onChange(value.slice(0, start) + path + value.slice(caret));
    }
    setDismissed(false);
    requestAnimationFrame(() => ref.current?.focus());
  };

  if (disabled) {
    return value.trim() ? (
      <code className="block rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11.5px] break-all">
        {value}
      </code>
    ) : (
      <p className="text-[12px] text-muted-foreground m-0">(none)</p>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="font-mono text-[11.5px] min-h-[34px]"
          onFocus={(e) => {
            setCaret(e.target.selectionStart ?? value.length);
            setDismissed(false);
          }}
          onBlur={() => setCaret(null)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
          }}
        />
        {caret != null && !dismissed && options.length > 0 && (
          <PathPopover
            options={options}
            token={token}
            onPick={pick}
            onDismiss={() => setDismissed(true)}
          />
        )}
      </div>
      {compileErr && <p className="text-[11px] text-destructive m-0">{compileErr}</p>}
      {!compileErr && <PreviewLine state={preview} />}
    </div>
  );
}

// ── ConditionBuilder: the structured editor (Tier 1) ─────────────────────────

/**
 * The structured condition editor: `[variable ▾][op ▾][value]` rows joined by
 * AND/OR, compiled to JSONata. Raw escapes: "edit raw" switches to an
 * ExpressionInput; an expression that doesn't decompose into rows opens in
 * raw mode directly. The value passed up stays the raw JSONata string.
 */
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
  const options = useMemo(() => jsonataPathOptions(varGroups ?? []), [varGroups]);
  /** the builder's local rows — emitted only when they compile */
  const [rows, setRows] = useState<ConditionRow[]>([]);
  const [combinator, setCombinator] = useState<"and" | "or">("and");
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  /** the compiled text last emitted — external values equal to it don't reset the rows */
  const lastEmitted = useRef<string | null>(null);
  /** the raw text while in raw mode (the parent's value only moves on a
   *  complete edit — typing raw does not ping-pong through the parent) */
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  // seed from the incoming value: decomposable → builder rows, else raw mode
  // ("" and null are the same "no condition" — a clear doesn't re-seed)
  useEffect(() => {
    if (value === lastEmitted.current || (!value && !lastEmitted.current)) return;
    lastEmitted.current = null;
    const dec = decomposeCondition(value);
    if (dec) {
      setRows(dec.rows.length ? dec.rows : [{ path: "", op: "eq", value: "" }]);
      setCombinator(dec.combinator);
      setMode("builder");
    } else {
      setMode("raw");
      setRawDraft(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: ConditionRow[], comb: "and" | "or") => {
    setRows(next);
    setCombinator(comb);
    const out = compileCondition(next, comb);
    // store what the parent will hold ("" collapses to null) — the seed
    // effect skips values that match, so a clear doesn't re-seed and wipe
    // the rows mid-edit
    lastEmitted.current = out || null;
    onChange(out || null);
  };

  // the builder mode's preview — raw mode's ExpressionInput fetches its own
  // (the outer hook is inert on null, no duplicate requests)
  const preview = useExpressionPreview(
    mode === "builder" ? compileCondition(rows, combinator) : null,
    { templateId, scope },
  );
  // client-side compile check on what the builder emits (instant — the
  // preview's server round trip only carries the value). An empty compile
  // means no condition — linting "" would itself be a JSONata error (S0207,
  // "unexpected end of expression"), so it emits nothing instead of noise.
  const compiledLint = useMemo(
    () => {
      if (mode !== "builder") return null;
      const out = compileCondition(rows, combinator);
      return out ? lintJsonata(out) : null;
    },
    [mode, rows, combinator],
  );

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
          placeholder={placeholder ?? "JSONata expression — e.g. nodes.build.output.mr_url != null"}
        />
        {decomposeCondition(rawDraft) && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                const dec = decomposeCondition(rawDraft)!;
                setRows(dec.rows.length ? dec.rows : [{ path: "", op: "eq", value: "" }]);
                setCombinator(dec.combinator);
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
          <Select value={combinator} onValueChange={(v) => emit(rows, (v as "and" | "or") ?? "and")}>
            <SelectTrigger className="h-7 w-[130px] rounded-lg border-border bg-card text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">all (AND)</SelectItem>
              <SelectItem value="or">any (OR)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <PathField
            value={r.path}
            options={options}
            placeholder={placeholder ?? "variable — e.g. nodes.build.output.mr_url"}
            onChange={(path) => emit(rows.map((x, j) => (j === i ? { ...x, path } : x)), combinator)}
          />
          <Select
            value={r.op}
            onValueChange={(v) => emit(rows.map((x, j) => (j === i ? { ...x, op: (v as ConditionOp) } : x)), combinator)}
          >
            <SelectTrigger className="h-9 w-[112px] shrink-0 rounded-lg border-border bg-card text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {OPS.find((o) => o.value === r.op)?.needsValue && (
            <Input
              value={r.value}
              placeholder="value"
              className="w-[130px] shrink-0 font-mono text-[12px]"
              onChange={(e) => emit(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)), combinator)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground shrink-0"
            title="Remove condition"
            onClick={() => emit(rows.filter((_, j) => j !== i), combinator)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => emit([...rows, { path: "", op: "eq", value: "" }], combinator)}
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
          No condition — the flow always takes this path. Add one to gate it on the data.
        </p>
      )}
      {compiledLint && (
        <p className="text-[11px] text-destructive m-0">{compiledLint}</p>
      )}
      <PreviewLine state={preview} />
    </div>
  );
}
