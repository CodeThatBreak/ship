"use client";
/**
 * The Inputs tab's stateful core (split from the tab body, Phase 4): the
 * one open editing row (`InputMapEdit`) and the combined row model the list
 * renders. All writes stay local until the row's Add button commits them
 * (Cancel is a plain close, Remove drops an override).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorNode } from "../types";
import { mergeUpstreamFields, resolveMapExpr, type UpstreamVarSource } from "../variables";

/** A task-context or trigger-payload field the source picker offers. */
export interface SourceField {
  key: string;
  label?: string;
  type?: string;
}

/** A field name the persisted input_map can carry: lowercase slug. */
export function slugOk(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(s);
}

/** The string-valued subset of the node's input_map (the engine ignores
 *  empty / non-string entries — `evalInputMap` filters the same way). */
export function stringMapOf(inputMap: unknown): Record<string, string> {
  if (!inputMap || typeof inputMap !== "object" || Array.isArray(inputMap)) return {};
  return Object.fromEntries(
    Object.entries(inputMap as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && (v as string).trim())
      .map(([k, v]) => [k, v as string]),
  );
}

/** The one row being (re)mapped. */
export interface InputMapEdit {
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

/** One combined list row: inherited order first (a mapped override shadows
 *  its inherited namesake in place), then mapped-only fields. */
export interface InputRowModel {
  name: string;
  type?: string;
  /** parents publishing this field — 2+ badges the last-wins conflict */
  from?: string[];
  /** set when input_map maps this field (wins over the inherited value) */
  expr?: string;
}

export interface InputMapOptions {
  node: EditorNode;
  onChange: (p: Partial<EditorNode>) => void;
  /** the `next`-edge parents' published fields (resolved contracts) */
  upstream: UpstreamVarSource[];
  taskFields?: SourceField[];
  triggerFields?: SourceField[];
}

/** One editing row at a time over a node's input_map, plus the combined
 *  inherited + mapped row list. Callers own rendering (see InputsTab). */
export function useInputMap({
  node,
  onChange,
  upstream,
  taskFields,
  triggerFields,
}: InputMapOptions) {
  const inherited = useMemo(() => mergeUpstreamFields(upstream), [upstream]);
  const map = useMemo(() => stringMapOf(node.input_map), [node.input_map]);

  /** the row being (re)mapped — null when the list is plain */
  const [editing, setEditing] = useState<InputMapEdit | null>(null);

  // node switches reset the editing row (a stale edit would write into the
  // next node's input_map)
  useEffect(() => {
    setEditing(null);
  }, [node?.key]);

  /** Add: the single commit point — the settled name + expression land in
   *  input_map together (nothing is written while typing, so outside clicks
   *  and Cancel are a plain close). A rename moves the edited row's original
   *  key out of the way; mapping an inherited name writes the shadowing
   *  override. */
  const commitEdit = useCallback(
    (name: string, expr: string) => {
      const n = name.trim();
      const e = expr.trim();
      if (!n || !slugOk(n) || !e) return;
      const m: Record<string, string> = { ...map };
      const origin = editing?.originName;
      if (origin && origin !== n) delete m[origin];
      m[n] = e;
      onChange({ input_map: m });
      setEditing(null);
    },
    [map, editing, onChange],
  );

  const beginEdit = useCallback((name: string, fixedName: boolean) => {
    setEditing({ name, expr: map[name] ?? "", originName: name, fixedName, isNew: false });
  }, [map]);
  const beginNew = useCallback(() => {
    setEditing({ name: "", expr: "", originName: null, fixedName: false, isNew: true });
  }, []);
  const cancelEdit = useCallback(() => setEditing(null), []);
  const removeMap = useCallback(
    (name: string) => {
      const m = { ...map };
      delete m[name];
      onChange({ input_map: m });
    },
    [map, onChange],
  );
  /** the editing row's Remove: a mapped row drops its override (falls back
   *  to the inherited value); a fresh row has nothing written yet, so
   *  Remove only shows for mapped rows — Cancel covers the fresh case */
  const removeEditing = useCallback(() => {
    if (editing?.originName && map[editing.originName] != null) removeMap(editing.originName);
    setEditing(null);
  }, [editing, map, removeMap]);

  const rows: InputRowModel[] = useMemo(() => {
    const resolve = (expr: string) =>
      resolveMapExpr(expr, { upstream, taskFields, triggerFields });
    return [
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
  }, [inherited, map, upstream, taskFields, triggerFields]);

  // the edit hides the row it replaces (matched on the origin key — the
  // typed name moves freely before Add)
  const editingRow =
    editing && !editing.isNew && editing.originName != null
      ? rows.findIndex((r) => r.name === editing.originName)
      : -1;

  return { map, editing, rows, editingRow, commitEdit, beginEdit, beginNew, cancelEdit, removeMap, removeEditing };
}
