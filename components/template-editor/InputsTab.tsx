"use client";
/**
 * The Inputs tab (Phase 4): what this node receives. The engine merges every
 * `next`-edge parent's published output (last wins) into the node's input and
 * overlays the template's `input_map[field] = "<JSONata>"` mappings on top
 * (`evalInputMap`) — this tab makes both visible and editable:
 *
 *   summary    ← Review · output.summary            inherited        [re-map]
 *   branch     ← Build · output.plan                mapped           [re-map] [✕]
 *   ticket_key ← Task · key                         mapped           [re-map] [✕]
 *   + Map a field
 *
 * Inherited rows are greyed and not deletable — re-mapping one creates an
 * `input_map` override that shadows it (removing the override falls back to
 * the inherited value). Mapped rows write straight into the node's existing
 * `input_map` config, which the engine already evaluates over the flow
 * context — zero runtime changes. Edits stay local until the row's Add
 * button commits them (Cancel is a plain close). The source picker offers
 * the same vocabulary as the variable popovers (upstream nodes → task →
 * trigger → flow/repo) with raw JSONata as the separated advanced escape
 * hatch; the vocabulary notes live in the header's info tooltip.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Info, Plus, Trash2, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { EditorNode } from "./types";
import {
  FLOW_REPO_FIELDS,
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  mergeUpstreamFields,
  resolveMapExpr,
  type UpstreamVarSource,
} from "./variables";
import { ExpressionInput } from "./condition-builder";

/** A field name the persisted input_map can carry: lowercase slug. */
function slugOk(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(s);
}

/** The string-valued subset of the node's input_map (the engine ignores
 *  empty / non-string entries — `evalInputMap` filters the same way). */
function stringMapOf(inputMap: unknown): Record<string, string> {
  if (!inputMap || typeof inputMap !== "object" || Array.isArray(inputMap)) return {};
  return Object.fromEntries(
    Object.entries(inputMap as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && (v as string).trim())
      .map(([k, v]) => [k, v as string]),
  );
}

interface EditState {
  /** the field name under edit (renamable for mapped rows) */
  name: string;
  /** the current expression text (raw JSONata over the flow context) */
  expr: string;
  /** the row this edit replaces: the inherited/mapped key at edit start —
   *  a rename moves it out of input_map on commit */
  originName: string | null;
  /** editing an inherited row: the name is fixed (the override must keep
   *  it so `{{input.<field>}}` refs in prompts keep resolving) */
  fixedName: boolean;
  /** a brand-new mapping row (Cancel discards it — nothing is written
   *  until Add) */
  isNew: boolean;
}

export function InputsTab({
  node,
  upstream,
  taskFields,
  triggerFields,
  templateId,
  onChange,
}: {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  /** the `next`-edge parents' published fields (resolved contracts) */
  upstream: UpstreamVarSource[];
  taskFields?: { key: string; label?: string; type?: string }[];
  triggerFields?: { key: string; label?: string; type?: string }[];
  /** the owning template's id (Phase 5) — the custom expression's preview */
  templateId?: string;
}) {
  const inherited = useMemo(() => mergeUpstreamFields(upstream), [upstream]);
  const map = useMemo(() => stringMapOf(node.input_map), [node.input_map]);

  /** the row being (re)mapped — null when the list is plain */
  const [editing, setEditing] = useState<EditState | null>(null);

  // node switches reset the editing row (a stale edit would write into the
  // next node's input_map)
  useEffect(() => {
    setEditing(null);
  }, [node?.key]);

  const resolve = (expr: string) =>
    resolveMapExpr(expr, { upstream, taskFields, triggerFields });

  /** Add: the single commit point — the settled name + expression land in
   *  input_map together (nothing is written while typing, so outside clicks
   *  and Cancel are a plain close). A rename moves the edited row's original
   *  key out of the way; mapping an inherited name writes the shadowing
   *  override. */
  const commitEdit = (name: string, expr: string) => {
    const n = name.trim();
    const e = expr.trim();
    if (!n || !slugOk(n) || !e) return;
    const m: Record<string, string> = { ...map };
    const origin = editing?.originName;
    if (origin && origin !== n) delete m[origin];
    m[n] = e;
    onChange({ input_map: m });
    setEditing(null);
  };

  const beginEdit = (name: string, fixedName: boolean) => {
    setEditing({ name, expr: map[name] ?? "", originName: name, fixedName, isNew: false });
  };
  const beginNew = () => {
    setEditing({ name: "", expr: "", originName: null, fixedName: false, isNew: true });
  };
  const cancelEdit = () => setEditing(null);
  const removeMap = (name: string) => {
    const m = { ...map };
    delete m[name];
    onChange({ input_map: m });
  };
  /** the editing row's Remove: a mapped row drops its override (falls back
   *  to the inherited value); a fresh row has nothing written yet, so
   *  Remove only shows for mapped rows — Cancel covers the fresh case */
  const removeEditing = () => {
    if (editing?.originName && map[editing.originName] != null) removeMap(editing.originName);
    setEditing(null);
  };

  // combined rows: inherited order first (a mapped override shadows its
  // inherited namesake in place), then mapped-only fields
  const rows: {
    name: string;
    type?: string;
    /** parents publishing this field — 2+ badges the last-wins conflict */
    from?: string[];
    /** set when input_map maps this field (wins over the inherited value) */
    expr?: string;
  }[] = [
    ...inherited.map((f) => ({
      name: f.name,
      type: f.type,
      from: f.from,
      expr: map[f.name],
    })),
    ...Object.entries(map)
      .filter(([k]) => !inherited.some((f) => f.name === k))
      .map(([k, expr]) => ({
        name: k,
        type: resolve(expr)?.type,
        from: undefined,
        expr,
      })),
  ];

  // the edit hides the row it replaces (matched on the origin key — the
  // typed name moves freely before Add)
  const editingRow =
    editing && !editing.isNew && editing.originName != null
      ? rows.findIndex((r) => r.name === editing.originName)
      : -1;

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-1.5">
        <p className="text-[12.5px] font-medium m-0">Inputs — what this node receives</p>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
                <Info size={12} />
              </span>
            }
          />
          <TooltipContent className="max-w-[300px] whitespace-normal text-left leading-relaxed">
            <span className="grid gap-1.5">
              <span>
                Inherited rows come from the connected parents&apos; outputs —
                addressed as <code className="font-mono">{`{{input.<field>}}`}</code> in
                prompts. Re-mapping one writes an override that shadows the
                inherited value.
              </span>
              <span>
                Mapped rows are raw JSONata over the flow context (
                <code className="font-mono">nodes.&lt;key&gt;.output.*</code>,{" "}
                <code className="font-mono">task.*</code>,{" "}
                <code className="font-mono">trigger.payload.*</code>,{" "}
                <code className="font-mono">flow.*</code> /{" "}
                <code className="font-mono">repo.*</code>) — evaluated when the
                node runs, overlaying the inherited merge.
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-muted-foreground m-0">
        Inherited rows come from the connected parents&apos; outputs; map a field
        to pull it from anywhere in the flow context instead.
      </p>

      {upstream.length === 0 && rows.length === 0 && !editing && (
        <p className="text-[12px] text-muted-foreground m-0">
          No upstream node — connect one on the canvas; whatever it publishes
          becomes this node&apos;s input. You can still map fields from the
          task context or the trigger payload.
        </p>
      )}

      {(rows.length > 0 || editing) && (
        // a plain bordered surface, not <Card>: the card primitive hard-codes
        // overflow-hidden + an outer ring, which clipped the mapping popover
        // and cut the ring off at the ScrollArea viewport's left edge
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {rows.map((r, i) =>
            i === editingRow ? null : (
              <InputRow
                key={r.name}
                name={r.name}
                type={r.type}
                from={r.from}
                expr={r.expr}
                onRemap={() => beginEdit(r.name, r.expr == null)}
                onRemove={r.expr != null ? () => removeMap(r.name) : undefined}
              />
            ),
          )}
          {editing && (
            <EditRow
              key={editing.isNew ? "__new__" : editing.originName}
              editing={editing}
              upstream={upstream}
              taskFields={taskFields}
              triggerFields={triggerFields}
              templateId={templateId}
              onCommit={commitEdit}
              onCancel={cancelEdit}
              onRemove={
                editing.originName != null && map[editing.originName] != null
                  ? removeEditing
                  : undefined
              }
            />
          )}
        </div>
      )}

      {!editing && (
        <Button variant="outline" size="sm" className="self-start" onClick={beginNew}>
          <Plus size={12} /> Map a field
        </Button>
      )}
    </div>
  );
}

/** One read row: `name ← source` + badges + the re-map / remove controls. */
function InputRow({
  name,
  type,
  from,
  expr,
  onRemap,
  onRemove,
}: {
  name: string;
  type?: string;
  from?: string[];
  /** the input_map expression when this row is mapped */
  expr?: string;
  onRemap: () => void;
  onRemove?: () => void;
}) {
  const mapped = expr != null;
  const conflict = from != null && from.length > 1;
  const e = expr ?? "";
  const sourceText = mapped
    ? (resolveMapExpr(e)?.source ?? e)
    : `${(from ?? []).join(" + ")} · output.${name}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0 first:rounded-t-lg last:rounded-b-lg",
        !mapped && "bg-muted/30",
      )}
    >
      <code
        className={cn(
          "font-mono text-[12px] shrink-0",
          mapped ? "text-info" : "text-muted-foreground",
        )}
      >
        {name}
      </code>
      {type && <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{type}</span>}
      <span className="text-muted-foreground/70 shrink-0">←</span>
      <span
        className={cn(
          "text-[12px] min-w-0 truncate flex-1",
          mapped ? "font-mono text-[11.5px]" : "text-muted-foreground",
        )}
        title={mapped ? e : sourceText}
      >
        {sourceText}
      </span>
      {mapped ? (
        <Badge className="bg-info/10 text-info text-[10px] py-0 shrink-0">mapped</Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] py-0 shrink-0">inherited</Badge>
      )}
      {conflict && !mapped && (
        <Badge
          className="bg-warning/10 text-warning text-[10px] py-0 shrink-0"
          title="Two parents publish this field — the last one to finish wins. Map it to pick a source explicitly."
        >
          {conflict ? from?.length : null} sources
        </Badge>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground shrink-0 h-7 px-2"
        onClick={onRemap}
      >
        re-map
      </Button>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground shrink-0 h-7 px-1.5"
          title="Remove mapping — falls back to the inherited value"
          onClick={onRemove}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}

/** The editing row: field name + the grouped source picker (raw JSONata as
 *  the separated advanced item). The row keeps its edits local — nothing
 *  lands in input_map until the Add button commits them (Cancel closes
 *  without writing); the popover hugs the field's right edge so it fits the
 *  narrow side panel. */
function EditRow({
  editing,
  upstream,
  taskFields,
  triggerFields,
  templateId,
  onCommit,
  onCancel,
  onRemove,
}: {
  editing: EditState;
  upstream: UpstreamVarSource[];
  taskFields?: { key: string; label?: string; type?: string }[];
  triggerFields?: { key: string; label?: string; type?: string }[];
  templateId?: string;
  onCommit: (name: string, expr: string) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  // the draft — committed by Add, discarded by Cancel
  const [name, setName] = useState(editing.name);
  const [expr, setExpr] = useState(editing.expr);
  const known = resolveMapExpr(expr, { upstream, taskFields, triggerFields });
  const custom = known == null;
  const trimmedName = name.trim();
  const nameBad = trimmedName !== "" && !slugOk(trimmedName);
  const addable = trimmedName !== "" && !nameBad && expr.trim() !== "";
  return (
    <div className="grid gap-1.5 px-3 py-2 bg-info/[0.04] first:rounded-t-lg last:rounded-b-lg">
      <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-1.5 items-start">
        <div className="grid gap-1">
          <Input
            value={name}
            disabled={editing.fixedName}
            placeholder="field name"
            className="font-mono text-[12px]"
            aria-label="Field name"
            onChange={(e) => setName(e.target.value)}
          />
          {nameBad && (
            <p className="text-[10.5px] text-warning m-0">
              lowercase letters, digits and _ — starts with a letter
            </p>
          )}
        </div>
        <div className="grid gap-1">
          <Select
            value={custom ? "__custom__" : expr.trim()}
            onValueChange={(v) => setExpr(v && v !== "__custom__" ? v : "")}
          >
            <SelectTrigger
              className="w-full rounded-lg border-border bg-card font-mono text-[12px]"
              aria-label="Mapping source"
            >
              <SelectValue placeholder="Pick a source…" />
            </SelectTrigger>
            <SelectContent>
              {upstream.map((src) => (
                <SelectGroup key={src.key}>
                  <SelectLabel>Upstream: {src.label}</SelectLabel>
                  {src.fields.map((f) => (
                    <SelectItem
                      key={`nodes.${src.key}.output.${f.name}`}
                      value={`nodes.${src.key}.output.${f.name}`}
                    >
                      <span className="font-mono text-[11.5px]">{f.name}</span>
                      {f.type && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.type}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              {taskFields && taskFields.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Task context</SelectLabel>
                  {taskFields.map((f) => (
                    <SelectItem key={`task.${f.key}`} value={`task.${f.key}`}>
                      <span className="font-mono text-[11.5px]">{f.key}</span>
                      {f.label && f.label !== f.key && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {triggerFields && triggerFields.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Trigger payload</SelectLabel>
                  {triggerFields.map((f) => (
                    <SelectItem
                      key={`trigger.payload.${f.key}`}
                      value={`trigger.payload.${f.key}`}
                    >
                      <span className="font-mono text-[11.5px]">{f.key}</span>
                      {f.label && f.label !== f.key && (
                        <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                          {f.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>Flow / Repo</SelectLabel>
                {FLOW_REPO_FIELDS.map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    <span className="font-mono text-[11.5px]">{f.path}</span>
                    <span className="text-[9.5px] text-muted-foreground/70 ml-1.5">
                      {f.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Advanced</SelectLabel>
                <SelectItem value="__custom__">Custom expression (JSONata)</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {custom && (
            <ExpressionInput
              value={expr}
              autoFocus
              align="right"
              varGroups={asJsonataGroups(conditionVarGroups(
                buildVarGroups({ taskFields, triggerFields, upstream }),
              ))}
              templateId={templateId}
              scope="context"
              rows={1}
              placeholder="JSONata — e.g. nodes.build.output.plan.items[0]"
              onChange={setExpr}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5"
          disabled={!addable}
          title={addable ? undefined : "Pick a field name and a source first"}
          onClick={() => onCommit(name, expr)}
        >
          <Check size={12} /> Add mapping
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
          Cancel
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            title="Remove mapping — falls back to the inherited value"
            onClick={onRemove}
          >
            <Trash2 size={12} /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
