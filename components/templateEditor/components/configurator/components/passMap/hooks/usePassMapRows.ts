"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface PassMapDraft {
  id: string;
  field: string;
  expr: string;
}

interface UsePassMapRowsOptions {
  value: unknown;
  defaultValue?: unknown;
  onChange: (v: unknown) => void;
}

const newRowId = (): string => crypto.randomUUID();

const seedRows = (effective: Record<string, string>): PassMapDraft[] =>
  Object.entries(effective).map(([field, expr]) => ({
    id: newRowId(),
    field,
    expr: typeof expr === "string" ? expr : "",
  }));

export const usePassMapRows = ({
  value,
  defaultValue,
  onChange,
}: UsePassMapRowsOptions) => {
  const effective = useMemo(
    () =>
      (value && typeof value === "object" && !Array.isArray(value)
        ? value
        : defaultValue &&
            typeof defaultValue === "object" &&
            !Array.isArray(defaultValue)
          ? defaultValue
          : {}) as Record<string, string>,
    [value, defaultValue],
  );
  const [rows, setRows] = useState<PassMapDraft[]>(() => seedRows(effective));

  useEffect(() => {
    setRows(seedRows(effective));
  }, [effective]);

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
  const addRow = useCallback(
    () => write([...rows, { id: newRowId(), field: "", expr: "" }]),
    [rows, write],
  );

  return { rows, editRow, addRow, removeRow };
};
