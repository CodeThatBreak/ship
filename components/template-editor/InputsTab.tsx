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
 * context — zero runtime changes. The source picker offers the same
 * vocabulary as the variable popovers (upstream nodes → task → trigger →
 * flow/repo) with raw JSONata as the separated advanced escape hatch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
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
import { ExpressionInput } from "./ConditionBuilder";

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
  /** editing an inherited row: the name is fixed (the override must keep
   *  it so `{{input.<field>}}` refs in prompts keep resolving) */
  fixedName: boolean;
  /** a brand-new mapping row (Cancel/discard drops the partial entry) */
  isNew: boolean;
  /** the name text is committed to input_map only when settled (blur) —
   *  live-writing every keystroke would leave "b", "br", "bra"… junk keys
   *  behind a rename */
  nameSettled: boolean;
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
  /** the input_map when the edit began — Cancel restores it */
  const [snap, setSnap] = useState<Record<string, string> | null>(null);
  /** the key this edit replaces in input_map (its original row, if any) */
  const originKey = useRef<string | null>(null);

  // node switches reset the editing row (a stale edit would write into the
  // next node's input_map)
  useEffect(() => {
    setEditing(null);
    setSnap(null);
  }, [node?.key]);

  const resolve = (expr: string) =>
    resolveMapExpr(expr, { upstream, taskFields, triggerFields });

  /** Applies an edit state: the map entry is written when the name is
   *  settled (blur) and both name + expr are usable; the edited row's
   *  original key always moves out of the way (renames replace it). */
  const write = (next: EditState) => {
    setEditing(next);
    if (!next.nameSettled) return;
    const name = next.name.trim();
    if (!name || !slugOk(name) || !next.expr.trim()) return;
    const m: Record<string, string> = { ...map };
    const origin = originKey.current;
    if (origin && origin !== name) delete m[origin];
    m[name] = next.expr.trim();
    onChange({ input_map: m });
  };

  const beginEdit = (name: string, fixedName: boolean) => {
    originKey.current = map[name] != null ? name : null;
    setSnap({ ...map });
    setEditing({ name, expr: map[name] ?? "", fixedName, isNew: false, nameSettled: true });
  };
  const beginNew = () => {
    originKey.current = null;
    setSnap({ ...map });
    setEditing({ name: "", expr: "", fixedName: false, isNew: true, nameSettled: true });
  };
  const cancelEdit = () => {
    if (snap) onChange({ input_map: snap });
    setEditing(null);
    setSnap(null);
  };
  const removeMap = (name: string) => {
    const m = { ...map };
    delete m[name];
    onChange({ input_map: m });
  };
  /** the editing row's Remove: a mapped row drops its override (falls back
   *  to inherited); a fresh row discards the partial entry (the snapshot
   *  restore doubles as the cleanup) */
  const discardEdit = () => {
    const origin = originKey.current;
    if (origin && map[origin] != null) removeMap(origin);
    else if (snap) onChange({ input_map: snap });
    setEditing(null);
    setSnap(null);
  };
  const discardable =
    editing != null &&
    (editing.isNew ||
      (originKey.current != null && map[originKey.current] != null));

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

  const editingRow = editing
    ? rows.findIndex((r) => r.name === editing.name && !editing.isNew)
    : -1;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <p className="text-[12.5px] font-medium m-0">Inputs — what this node receives</p>
        <p className="text-[11px] text-muted-foreground m-0">
          Inherited rows come from the connected parents&apos; outputs (addressed
          as <code className="font-mono">{`{{input.<field>}}`}</code> in
          prompts). Map a field to pull it from anywhere in the flow context
          instead.
        </p>
      </div>

      {upstream.length === 0 && rows.length === 0 && !editing && (
        <p className="text-[12px] text-muted-foreground m-0">
          No upstream node — connect one on the canvas; whatever it publishes
          becomes this node&apos;s input. You can still map fields from the
          task context or the trigger payload.
        </p>
      )}

      {(rows.length > 0 || editing) && (
        <Card className="p-0 overflow-hidden">
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
              editing={editing}
              upstream={upstream}
              taskFields={taskFields}
              triggerFields={triggerFields}
              templateId={templateId}
              onWrite={write}
              onCancel={cancelEdit}
              onRemove={discardable ? discardEdit : undefined}
            />
          )}
        </Card>
      )}

      {!editing && (
        <Button variant="outline" size="sm" className="self-start" onClick={beginNew}>
          <Plus size={12} /> Map a field
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground m-0">
        Mapped rows are raw JSONata over the flow context (
        <code className="font-mono">nodes.&lt;key&gt;.output.*</code>,{" "}
        <code className="font-mono">task.*</code>,{" "}
        <code className="font-mono">trigger.payload.*</code>,{" "}
        <code className="font-mono">flow.*</code> /{" "}
        <code className="font-mono">repo.*</code>) — evaluated when the node
        runs, overlaying the inherited merge.
      </p>
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
  const sourceText = mapped
    ? (resolveMapExpr(expr!)?.source ?? expr!)
    : `${(from ?? []).join(" + ")} · output.${name}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0",
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
        title={mapped ? expr : sourceText}
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
          {from!.length} sources
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
 *  the separated advanced item). Writes are live on source picks and
 *  expression typing; the name commits on blur — Cancel restores the
 *  snapshot. */
function EditRow({
  editing,
  upstream,
  taskFields,
  triggerFields,
  templateId,
  onWrite,
  onCancel,
  onRemove,
}: {
  editing: EditState;
  upstream: UpstreamVarSource[];
  taskFields?: { key: string; label?: string; type?: string }[];
  triggerFields?: { key: string; label?: string; type?: string }[];
  templateId?: string;
  onWrite: (next: EditState) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const known = resolveMapExpr(editing.expr, { upstream, taskFields, triggerFields });
  const custom = known == null;
  const nameBad = editing.name.trim() !== "" && !slugOk(editing.name.trim());
  return (
    <div className="grid gap-1.5 px-3 py-2 border-b border-border bg-info/[0.04]">
      <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-1.5 items-start">
        <div className="grid gap-1">
          <Input
            value={editing.name}
            disabled={editing.fixedName}
            placeholder="field name"
            className="font-mono text-[12px]"
            aria-label="Field name"
            onChange={(e) =>
              onWrite({ ...editing, name: e.target.value, nameSettled: false })
            }
            onBlur={() => onWrite({ ...editing, nameSettled: true })}
          />
          {nameBad && (
            <p className="text-[10.5px] text-warning m-0">
              lowercase letters, digits and _ — starts with a letter
            </p>
          )}
        </div>
        <div className="grid gap-1">
          <Select
            value={custom ? "__custom__" : editing.expr.trim()}
            onValueChange={(v) =>
              onWrite({ ...editing, expr: v && v !== "__custom__" ? v : "" })
            }
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
              {(taskFields?.length ?? 0) > 0 && (
                <SelectGroup>
                  <SelectLabel>Task context</SelectLabel>
                  {taskFields!.map((f) => (
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
              {(triggerFields?.length ?? 0) > 0 && (
                <SelectGroup>
                  <SelectLabel>Trigger payload</SelectLabel>
                  {triggerFields!.map((f) => (
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
              value={editing.expr}
              autoFocus
              varGroups={asJsonataGroups(conditionVarGroups(
                buildVarGroups({ taskFields, triggerFields, upstream }),
              ))}
              templateId={templateId}
              scope="context"
              rows={1}
              placeholder="JSONata — e.g. nodes.build.output.plan.items[0]"
              onChange={(v) => onWrite({ ...editing, expr: v })}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
          <X size={12} /> Cancel
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            title={editing.isNew ? "Discard" : "Remove mapping — falls back to the inherited value"}
            onClick={onRemove}
          >
            <Trash2 size={12} /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
