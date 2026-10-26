"use client";
/**
 * The schema-driven config field renderers (Phase 2 → 6): one `ConfigFieldRow`
 * per knob, dispatching on the field type to the bespoke editors —
 * TS-lite schema boxes, decision branch choices, pass-down variable maps,
 * the http secrets chips, the fan-out child picker, and the plain
 * string/number/boolean/select controls.
 *
 * Extracted from NodeConfigurator so any host surface can render a kind's
 * full definition form: the builder drawer's Config tab and the Template
 * Nodes page's create/configure dialog share this machinery (one editing
 * experience everywhere, and a new knob declared on a runtime class shows up
 * on both without extra wiring).
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { PromptEditor } from "./PromptEditor";
import { ConditionBuilder, ExpressionInput } from "./ConditionBuilder";
import { iconForIconName } from "./icons";
import {
  asJsonataGroups,
  conditionVarGroups,
  filterVarGroups,
  httpResponseVarGroups,
  varGroupAccent,
  type VarGroup,
} from "./variables";
import { parseOutputContract } from "./ts-schema-lite";

/** Dropdown option renderer — the label as the heading, the description
 *  below it in gray. */
export function SelectOption({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="grid gap-0.5 whitespace-normal">
      <span className="text-[13px] leading-tight">{label}</span>
      <span className="text-[11px] text-muted-foreground leading-tight">
        {description}
      </span>
    </div>
  );
}

/** config fields authored with the rich prompt editor ("@" variable popover)
 *  — `question` is the decision agent's prompt */
const promptEditorKeys = new Set(["prompt", "prompt_body", "fix_prompt_body", "question"]);

/** config knobs that carry {{...}} template refs — they get the "Variables ▾" picker */
export const freeTextFields = new Set([
  "prompt",
  "prompt_body",
  "fix_prompt_body",
  "model",
  "url",
  "body",
  "question",
]);

/** The http fields where `{{secrets.NAME}}` resolves (Phase 6) — they get the
 *  configured-secrets chip group under the input. */
export const secretFields = new Set(["url", "headers", "body"]);

/**
 * The node's vocabulary as the condition/expression editors' groups (Phase 5):
 * brace-stripped, minus "My inputs" (the flow context map has no `input`
 * root — conditions and pass maps see task / upstream / trigger / flow /
 * repo), plus the flow & repo group.
 */
function condVarGroups(groups?: VarGroup[]): VarGroup[] {
  return asJsonataGroups(conditionVarGroups(groups ?? []));
}

/**
 * The companion key an editor writes alongside its compiled value — the
 * `ts_output` box stores the raw TypeScript members the author typed
 * (`<key>_ts`), so the box re-seeds to their source instead of the compiled
 * JSON Schema after a remount (format switches, tab switches, node changes).
 * An instance without an override falls back to the catalog def's companion
 * (the create dialog persists its box text on the def).
 */
export function companionTextOf(
  config: Record<string, unknown> | undefined,
  key: string,
  defaultValue?: unknown,
): unknown {
  const own = config?.[`${key}_ts`];
  if (own !== undefined) return own;
  return (defaultValue as Record<string, unknown> | undefined)?.[`${key}_ts`];
}

/** The config object after one field edit: the written value plus any
 *  companion the editor carries along (undefined values drop out on
 *  persist — removing the override lets the catalog default apply). */
export function writeConfig(
  config: Record<string, unknown> | undefined,
  key: string,
  v: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(config ?? {}), ...extra, [key]: v };
}

/**
 * The http node's secrets chip group (Phase 6): the configured secret names
 * (GET /api/settings — names only, values never leave the server) as chips
 * that insert `{{secrets.NAME}}` into the field. Empty state points to the
 * Settings page where secrets are managed.
 */
export function SecretsChipGroup({
  names,
  onInsert,
}: {
  names: string[];
  onInsert: (ref: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        secrets
      </span>
      {names.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          none configured — add secrets under Settings
        </span>
      ) : (
        names.map((n) => (
          <button
            key={n}
            type="button"
            title={`Insert {{secrets.${n}}}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(`{{secrets.${n}}}`)}
            className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-info/50 hover:text-foreground"
          >
            {n}
          </button>
        ))
      )}
    </div>
  );
}

/** A flow template as the fan-out child picker needs it (GET /api/templates:
 *  the gallery, hidden auto-wrapped child templates excluded, Phase 3C). */
interface GalleryTemplate {
  id: string;
  name: string;
  description?: string | null;
  nodeCount?: number;
}

/**
 * The fan-out child template picker (Phase 3C): a gallery select of flow
 * templates the node's steps run as. Hidden templates (the auto-wrapped
 * `"<label> · step"` children) never appear — a child template is referenced
 * by id, never picked (§2 data model). Entries show the template name with
 * its node count + description; a template value that no longer resolves
 * still renders (the save-time lint reports it as a problem). Empty
 * selection = auto-select: the built-in `step-build` child under build
 * nodes, the node's own hidden auto-wrap copy otherwise.
 */
export function FanoutChildPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const [templates, setTemplates] = useState<GalleryTemplate[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setTemplates(Array.isArray(d?.templates) ? (d.templates as GalleryTemplate[]) : []);
      })
      .catch(() => {
        if (alive) setTemplates([]);
      });
    return () => { alive = false; };
  }, []);

  const UNSET = "__auto__";
  const known = value && templates?.some((t) => t.id === value);
  return (
    <>
      <Select
        value={value ? (known || templates == null ? value : UNSET) : UNSET}
        onValueChange={(v) => onChange(v == null ? undefined : v === UNSET ? undefined : v)}
      >
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {value === ""
              ? "auto-select"
              : templates == null
                ? "loading…"
                : known
                  ? templates.find((t) => t.id === value)?.name ?? value
                  : `${value} (missing template)`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>
            <SelectOption
              label="auto-select"
              description="Picks a suitable template for you — the built-in build step on build nodes, a matching template elsewhere"
            />
          </SelectItem>
          {value != null && value !== "" && !known && (
            <SelectItem value={value!}>{value} (missing template)</SelectItem>
          )}
          {(templates ?? []).map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <SelectOption
                label={t.name}
                description={
                  `${t.nodeCount ?? 0} node${(t.nodeCount ?? 0) === 1 ? "" : "s"}${t.description ? ` · ${t.description}` : ""}`
                }
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {templates?.length === 0 && (
        <p className="text-[11px] text-muted-foreground m-0">
          No flow templates in the gallery yet — create one in the template editor.
        </p>
      )}
    </>
  );
}

/**
 * The field label. Prompt fields carry an info icon — hovering it shows the
 * reference cheat-sheet (the help text lives in the tooltip, not the page).
 */
function FieldLabel({ field }: { field: { key: string; label: string; help?: string } }) {
  if (promptEditorKeys.has(field.key)) {
    return (
      <div className="flex items-center gap-1.5">
        <Label>{field.label}</Label>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                <Info size={12} />
              </span>
            }
          />
          <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
            {field.help ?? "Type @ to insert an upstream variable — refs resolve at run time."}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return <Label>{field.label}</Label>;
}

/** A select config knob on the shadcn select. Variants:
 *  - rich (options carry descriptions): heading + gray description items, no
 *    "(default)" option — the effective value always resolves to one of the
 *    options (the catalog default shows as its own choice)
 *  - icon: the effective value is always one of the options (no empty item)
 *  - plain: a sentinel item resets to the default. */
function ConfigSelect({
  options,
  optionIcons,
  effective,
  defaultValue,
  defaultLabel,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[];
  optionIcons?: Record<string, string>;
  effective: unknown;
  defaultValue?: unknown;
  defaultLabel: string;
  onChange: (v: unknown) => void;
}) {
  const current =
    effective != null && options.some((o) => o.value === String(effective))
      ? String(effective)
      : "";
  const selected = options.find((o) => o.value === current);
  if (options.some((o) => o.description)) {
    const value =
      selected?.value ??
      options.find((o) => o.value === String(defaultValue))?.value ??
      options[0]?.value ??
      "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>
            {options.find((o) => o.value === value)?.label ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectOption label={o.label} description={o.description ?? ""} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (optionIcons) {
    // icon variant (agent mode) — the effective value is always one of the options
    const value = current || options[0]?.value || "";
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? value)}>
        <SelectTrigger className="w-full rounded-lg border-border bg-card">
          <SelectValue>{selected?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const Icon = optionIcons[o.value] ? iconForIconName(optionIcons[o.value]) : null;
            return (
              <SelectItem key={o.value} value={o.value}>
                {Icon && <Icon size={13} className="text-muted-foreground shrink-0" />}
                {o.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }
  const UNSET = "__default__";
  return (
    <Select
      value={current || UNSET}
      onValueChange={(v) => onChange(v === UNSET ? undefined : v)}
    >
      <SelectTrigger className="w-full rounded-lg border-border bg-card">
        <SelectValue>{selected?.label ?? defaultLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{defaultLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The agent's output schema — TS-lite members (or a pasted JSON Schema) that
 * compiles to the `output_schema` the json output is validated against.
 * The raw authoring text rides along in the config (`<key>_ts`): the compiled
 * schema is what the runtime uses, but the box re-seeds to what the author
 * wrote — format/tab switches remount the field without the authoring source
 * turning into JSON.
 */
export function TsOutputEditor({
  field,
  value,
  defaultValue,
  savedText,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] };
  value: unknown;
  defaultValue?: unknown;
  /** the previously persisted authoring text — seed source on mount */
  savedText?: string;
  /** the compiled schema (undefined = cleared) + the raw authoring text */
  onChange: (schema: unknown, saved: string | undefined) => void;
}) {
  const effective = value !== undefined ? value : (defaultValue ?? null);
  const [text, setText] = useState<string>(() =>
    typeof savedText === "string" && savedText.trim()
      ? savedText
      : effective
        ? JSON.stringify(effective, null, 2)
        : "",
  );
  const [err, setErr] = useState<string | null>(null);

  // TS-lite parse wins (bare members); a valid JSON Schema object pasted in
  // is accepted as-is; anything else keeps the last good schema
  useEffect(() => {
    const src = text.trim();
    if (!src) {
      setErr(null);
      onChange(undefined, undefined);
      return;
    }
    const lite = parseOutputContract(src);
    if (!lite.error && lite.schema) {
      setErr(null);
      onChange(lite.schema, text);
      return;
    }
    try {
      const json = JSON.parse(src);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        setErr(null);
        onChange(json, text);
        return;
      }
    } catch { /* fall through to the TS-lite error */ }
    setErr(lite.error ?? "declares no fields");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="grid gap-1">
      <Label>{field.label}</Label>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={`{\n  summary: string\n  severity: "low" | "high"\n  files: string[]\n}`}
      />
      {err && (
        <Card className="p-2.5 text-[12px] text-destructive border-destructive/30">
          {err}
        </Card>
      )}
    </div>
  );
}

/**
 * The decision node's branch choices — label + description rows edited in
 * place (written as the instance override). At least one labeled choice is
 * required by the decision schema; an all-empty edit keeps the last good set
 * and warns instead.
 *
 * For the `expression` source each choice also carries a JSONata `condition`
 * over the flow context — every truthy condition picks that branch. The
 * condition is authored with the structured ConditionBuilder (Phase 5): rows
 * of `[variable][op][value]` compiled to JSONata, with the raw language one
 * toggle away and the value previewed underneath.
 */
export function ChoicesEditor({
  field,
  value,
  defaultValue,
  source,
  varGroups,
  templateId,
  onChange,
}: {
  field: { key: string; label: string; type: string; help?: string; options?: { value: string; label: string }[] };
  value: unknown;
  defaultValue?: unknown;
  /** the decision's current source — "expression" adds the condition builders */
  source?: string;
  varGroups?: VarGroup[];
  templateId?: string;
  onChange: (v: unknown) => void;
}) {
  const effective = (
    Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : []
  ) as { label: string; description?: string; condition?: string }[];
  const [rows, setRows] = useState(() =>
    effective.map((c) => ({
      label: c.label,
      description: c.description ?? "",
      condition: c.condition ?? "",
    })),
  );
  const isExpression = source === "expression";

  const write = (next: { label: string; description: string; condition: string }[]) => {
    setRows(next);
    const labeled = next
      .map((c) => ({
        label: c.label.trim(),
        description: c.description.trim() || undefined,
        condition: c.condition.trim() || undefined,
      }))
      .filter((c) => c.label);
    if (labeled.length) onChange(labeled);
  };

  return (
    <div className="grid gap-1.5">
      <Label>Choices (branch labels)</Label>
      {rows.map((c, i) => (
        <div
          key={i}
          className={cn(
            "grid gap-1.5 rounded-lg border border-border p-2",
            isExpression && c.condition.trim() && "border-violet-500/40",
          )}
        >
          <div className="flex gap-1.5">
            <Input
              value={c.label}
              placeholder="label"
              className="max-w-[140px] font-mono text-[12px]"
              onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <Input
              value={c.description}
              placeholder="description (steers an agent classifier)"
              className="text-[12px]"
              onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={rows.length <= 1}
              title="Remove choice"
              onClick={() => write(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
          {isExpression && (
            <ConditionBuilder
              value={c.condition}
              varGroups={condVarGroups(varGroups)}
              templateId={templateId}
              scope="context"
              placeholder="nodes.review.output.comment_count > 0"
              onChange={(raw) =>
                write(rows.map((x, j) => (j === i ? { ...x, condition: raw ?? "" } : x)))
              }
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => write([...rows, { label: "", description: "", condition: "" }])}
      >
        <Plus size={12} /> Add choice
      </Button>
      {!rows.some((c) => c.label.trim()) && (
        <p className="text-[11px] text-warning m-0">At least one labeled choice is required.</p>
      )}
      {isExpression && !rows.some((c) => c.condition.trim()) && (
        <p className="text-[11px] text-warning m-0">
          No condition yet — give each choice a condition; every truthy condition picks its branch.
        </p>
      )}
    </div>
  );
}

/**
 * The decision's pass-down variables — field → JSONata rows edited in place
 * (the `pass` instance override). Every field is merged into the decision's
 * output beside chosen / rationale, so nodes attached to a branch address
 * them as `{{input.<field>}}` with no extra wiring. Each expression box is
 * the live ExpressionInput (Phase 5): paths autocomplete from the flow
 * context vocabulary, compile errors surface inline, and the evaluated value
 * renders underneath; a row with a name but no expression writes nothing.
 */
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
  const effective = (
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)
        ? defaultValue
        : {}
  ) as Record<string, string>;
  const [rows, setRows] = useState<{ field: string; expr: string }[]>(() =>
    Object.entries(effective).map(([field, expr]) => ({ field, expr: typeof expr === "string" ? expr : "" })),
  );

  const write = (next: { field: string; expr: string }[]) => {
    setRows(next);
    const mapped: Record<string, string> = {};
    for (const r of next) {
      if (r.field.trim() && r.expr.trim()) mapped[r.field.trim()] = r.expr.trim();
    }
    onChange(mapped);
  };

  return (
    <div className="grid gap-1.5">
      <Label>{field.label}</Label>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[130px_1fr] gap-1.5 items-start">
          <Input
            value={r.field}
            placeholder="field name"
            className="font-mono text-[12px]"
            onChange={(e) => write(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
          />
          <div className="flex gap-1.5 items-start">
            <ExpressionInput
              value={r.expr}
              varGroups={condVarGroups(varGroups)}
              templateId={templateId}
              scope="context"
              rows={1}
              placeholder="JSONata — e.g. nodes.review.output.summary"
              onChange={(v) => write(rows.map((x, j) => (j === i ? { ...x, expr: v } : x)))}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              title="Remove variable"
              onClick={() => write(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => write([...rows, { field: "", expr: "" }])}
      >
        <Plus size={12} /> Add variable
      </Button>
      <p className="text-[11px] text-muted-foreground m-0">
        Downstream nodes read these as <code className="font-mono">{`{{input.<field>}}`}</code> —
        chosen / rationale are passed automatically.
      </p>
    </div>
  );
}

/**
 * The per-field "Variables ▾" picker (Phase 3): one affordance for every
 * ref-bearing field — the grouped vocabulary (inherited → task → upstream →
 * trigger) in an anchored panel with a search box; picking a field inserts
 * its `{{...}}` ref (click-to-insert supersedes the old chip rows). Every
 * caller is a {{...}}-templated field (prompts use the @ popover's same
 * vocabulary), so the braces ride along; the raw-JSONata surfaces compile
 * their options separately (`jsonataPathOptions`). `jsonata` callers pass
 * pre-stripped groups (`asJsonataGroups`) when they need bare paths.
 */
export function VariablesPicker({
  groups,
  onInsert,
}: {
  groups: VarGroup[];
  onInsert: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = filterVarGroups(groups, query);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full text-[11px] text-muted-foreground hover:text-foreground"
      >
        Variables <ChevronDown size={10} className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-72 max-h-64 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search variables…"
            className="mb-1 border-border bg-muted/60 px-2 py-1 text-[12px]"
          />
          <ScrollArea className="flex-1">
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching variable</div>
          )}
          {shown.map((g) => (
            <Fragment key={g.id + g.title}>
              <div className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </span>
                {g.origin && (
                  <span className="text-[9.5px] text-muted-foreground/70 truncate">
                    {g.origin}
                  </span>
                )}
              </div>
              {g.fields.map((f) => (
                <button
                  key={f.insert}
                  title={f.insert}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onInsert(f.insert);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-muted/60 transition-colors"
                >
                  <span className="truncate">{f.name}</span>
                  {f.type && (
                    <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{f.type}</span>
                  )}
                  <span className="flex-1" />
                  <code
                    className={cn(
                      "font-mono text-[9.5px] truncate max-w-[140px]",
                      varGroupAccent(g.id),
                    )}
                  >
                    {f.insert}
                  </code>
                </button>
              ))}
            </Fragment>
          ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function ConfigFieldRow({
  field,
  value,
  defaultValue,
  companionText,
  decisionSource,
  secrets,
  varGroups,
  invalidRefs,
  templateId,
  onChange,
}: {
  field: {
    key: string;
    label: string;
    type: string;
    help?: string;
    options?: { value: string; label: string; description?: string }[];
    optionIcons?: Record<string, string>;
    nullable?: boolean;
  };
  value: unknown;
  /** the catalog/class default (shown as placeholder when no override is set) */
  defaultValue?: unknown;
  /** the companion authoring text (`<key>_ts`) the ts_output box persister stores */
  companionText?: unknown;
  /** a decision node's current source — the choices editor shows per-choice
   *  conditions for the expression source */
  decisionSource?: string;
  /** configured secret names (Phase 6, http nodes) — the {{secrets.NAME}}
   *  chip group under the field */
  secrets?: string[];
  /** the grouped variable vocabulary — the prompt editor's @ popover / the
   *  field's "Variables ▾" picker (Phase 3) */
  varGroups?: VarGroup[];
  /** live-linted refs → the linter's problem (prompt fields underline them) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id (Phase 5) — the expression editors' preview */
  templateId?: string;
  onChange: (v: unknown, extra?: Record<string, unknown>) => void;
}) {
  const effective = value !== undefined ? value : defaultValue;
  // raw-JSONata text fields get the live expression editor (Phase 5): the
  // http response_map evaluates against the response object, not the flow
  // context — its vocabulary + preview scope differ accordingly
  if (field.type === "text" && field.key === "response_map") {
    return (
      <div className="grid gap-1">
        <FieldLabel field={field} />
        <ExpressionInput
          value={typeof effective === "string" ? effective : ""}
          varGroups={varGroups}
          templateId={templateId}
          scope="response"
          rows={3}
          placeholder={"body.result — must yield an object ({status, ok, body, headers} is the raw response)"}
          onChange={(v) => onChange(v.trim() ? v : null)}
        />
      </div>
    );
  }
  const insertRef = (ref: string) => {
    const cur = typeof value === "string" ? value : "";
    onChange(cur ? (cur.endsWith(" ") ? cur : `${cur} `) + ref : ref);
  };
  const fmtDefault = (v: unknown): string => {
    if (v == null || v === "") return "(default)";
    if (typeof v === "string")
      return v.length > 60
        ? `(default: ${v.slice(0, 60)}…)`
        : `(default: ${v})`;
    return `(default: ${JSON.stringify(v)})`;
  };
  // the declarative kinds' bespoke editors (schema boxes, branch choices)
  if (field.type === "ts_output") {
    return (
      <TsOutputEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        savedText={typeof companionText === "string" ? companionText : undefined}
        onChange={(schema, saved) =>
          onChange(schema, { [`${field.key}_ts`]: saved })
        }
      />
    );
  }
  if (field.type === "choices") {
    return (
      <ChoicesEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        source={decisionSource}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "map") {
    return (
      <PassMapEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
        <Checkbox
          checked={effective === true}
          onCheckedChange={(v) => onChange(v === true)}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  // multi-select knob (the MCP sources field): a checkbox group over the field's
  // options, writing the picked values as a string array — clearing every box
  // drops the override so the catalog/class default applies
  if (field.type === "multi") {
    const selected = Array.isArray(effective) ? (effective as string[]) : [];
    return (
      <div className="grid gap-1">
        <FieldLabel field={field} />
        <div className="grid gap-1.5 rounded-lg border border-border p-2">
          {(field.options ?? []).map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex items-start gap-2 text-[12.5px] cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = v === true
                      ? [...selected, o.value]
                      : selected.filter((s) => s !== o.value);
                    onChange(next.length ? next : undefined);
                  }}
                />
                <span className="leading-tight">
                  {o.label}
                  {o.description && (
                    <span className="block text-[11px] text-muted-foreground">{o.description}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {selected.length === 0 && (
          <p className="text-[11px] text-muted-foreground m-0">
            Nothing selected — the runtime default applies (inline servers only).
          </p>
        )}
      </div>
    );
  }
  // prompt fields: the rich text editor — "@" opens the grouped variable
  // popover, and unresolvable refs underline where they're typed
  if (field.type === "text" && promptEditorKeys.has(field.key)) {
    return (
      <div className="grid gap-1.5">
        <FieldLabel field={field} />
        <PromptEditor
          value={typeof effective === "string" ? effective : ""}
          groups={varGroups ?? []}
          invalidRefs={invalidRefs}
          onChange={(text) => onChange(text || undefined)}
        />
      </div>
    );
  }
  // fan-out child: the gallery picker (Phase 3C) — flow templates EXCLUDING
  // hidden auto-wrapped child templates, for both built-in and declarative
  // (agent-kind) parents; empty = auto-select (built-in step build / self-wrap)
  if (field.key === "fanout_child") {
    return (
      <div className="grid gap-1">
        <FieldLabel field={field} />
        <FanoutChildPicker
          value={typeof effective === "string" ? effective : ""}
          onChange={(v) => onChange(v || undefined)}
        />
      </div>
    );
  }
  const picker = varGroups?.length ? (
    <VariablesPicker groups={varGroups} onInsert={insertRef} />
  ) : null;
  const control =
    field.type === "select" ? (
      <ConfigSelect
        options={field.options ?? []}
        optionIcons={field.optionIcons}
        effective={effective}
        defaultValue={defaultValue}
        defaultLabel={fmtDefault(defaultValue)}
        onChange={onChange}
      />
    ) : field.type === "text" ? (
      <Textarea
        value={
          typeof effective === "string"
            ? effective
            : effective != null
              ? JSON.stringify(effective, null, 2)
              : ""
        }
        onChange={(e) => onChange(e.target.value || undefined)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={fmtDefault(defaultValue)}
      />
    ) : field.type === "string" ? (
      <Input
        value={typeof effective === "string" ? effective : ""}
        onChange={(e) =>
          onChange(
            e.target.value === "" && field.nullable
              ? null // "cleared" the override — don't snap back to the default
              : e.target.value || undefined,
          )
        }
        placeholder={fmtDefault(defaultValue)}
        className="font-mono text-[12.5px]"
      />
    ) : (
      <Input
        type="number"
        value={typeof effective === "number" ? effective : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        placeholder={fmtDefault(defaultValue)}
      />
    );
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel field={field} />
        {picker}
      </div>
      {control}
      {secrets != null && (
        <SecretsChipGroup names={secrets} onInsert={insertRef} />
      )}
    </div>
  );
}
