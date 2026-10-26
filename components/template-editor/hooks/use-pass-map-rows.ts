"use client";
/**
 * The decision pass-down map's row state (Phase 5), extracted from
 * ConfigFieldRow.tsx: the field → JSONata rows edited in place and compiled
 * to a `Record<string, string>` on every change — a row with a name but no
 * expression (or vice versa) writes nothing.
 */
import { useCallback, useState } from "react";

/** One in-place pass-map row: the editable field name + expression draft. */
export interface PassMapDraft {
  field: string;
  expr: string;
}

interface UsePassMapRowsOptions {
  value: unknown;
  defaultValue?: unknown;
  onChange: (v: unknown) => void;
}

export function usePassMapRows({
  value,
  defaultValue,
  onChange,
}: UsePassMapRowsOptions) {
  const effective = (
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : defaultValue &&
          typeof defaultValue === "object" &&
          !Array.isArray(defaultValue)
        ? defaultValue
        : {}
  ) as Record<string, string>;
  const [rows, setRows] = useState<PassMapDraft[]>(() =>
    Object.entries(effective).map(([field, expr]) => ({
      field,
      expr: typeof expr === "string" ? expr : "",
    })),
  );

  // the write-through: only fully-filled rows map (empty drafts stay in the
  // editor)
  const write = useCallback(
    (next: PassMapDraft[]) => {
      setRows(next);
      const mapped: Record<string, string> = {};
      for (const r of next) {
        if (r.field.trim() && r.expr.trim())
          mapped[r.field.trim()] = r.expr.trim();
      }
      onChange(mapped);
    },
    [onChange],
  );

  // monolithic indexed callbacks for the presentational rows (§2.5 — no
  // per-row closures inside the editor's map)
  const editRow = useCallback(
    (index: number, patch: Partial<PassMapDraft>) => {
      write(rows.map((x, j) => (j === index ? { ...x, ...patch } : x)));
    },
    [rows, write],
  );
  const removeRow = useCallback(
    (index: number) => write(rows.filter((_, j) => j !== index)),
    [rows, write],
  );
  const addRow = useCallback(() => write([...rows, { field: "", expr: "" }]), [
    rows,
    write,
  ]);

  return { rows, editRow, addRow, removeRow };
}
