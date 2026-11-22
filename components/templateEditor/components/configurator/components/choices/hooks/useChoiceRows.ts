"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ChoiceDraft {
  id: string;
  label: string;
  description: string;
  condition: string;
}

interface ChoiceValue {
  label: string;
  description?: string;
  condition?: string;
}

interface UseChoiceRowsOptions {
  value: unknown;
  defaultValue?: unknown;
  onChange: (v: unknown) => void;
}

const newRowId = (): string => crypto.randomUUID();

const seedRows = (effective: ChoiceValue[]): ChoiceDraft[] =>
  effective.map((c) => ({
    id: newRowId(),
    label: c.label,
    description: c.description ?? "",
    condition: c.condition ?? "",
  }));

export const useChoiceRows = ({
  value,
  defaultValue,
  onChange,
}: UseChoiceRowsOptions) => {
  const effective = useMemo(
    () =>
      (Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : []) as ChoiceValue[],
    [value, defaultValue],
  );
  const [rows, setRows] = useState<ChoiceDraft[]>(() => seedRows(effective));

  useEffect(() => {
    setRows(seedRows(effective));
  }, [effective]);

  const write = useCallback(
    (next: ChoiceDraft[]) => {
      setRows(next);
      const labeled = next
        .map((c) => ({
          label: c.label.trim(),
          description: c.description.trim() || undefined,
          condition: c.condition.trim() || undefined,
        }))
        .filter((c) => c.label);
      if (labeled.length) onChange(labeled);
    },
    [onChange],
  );

  const editChoice = useCallback(
    (index: number, patch: Partial<ChoiceDraft>) => {
      write(rows.map((x, j) => (j === index ? { ...x, ...patch } : x)));
    },
    [rows, write],
  );
  const addChoice = useCallback(
    () =>
      write([
        ...rows,
        { id: newRowId(), label: "", description: "", condition: "" },
      ]),
    [rows, write],
  );
  const removeChoice = useCallback(
    (index: number) => write(rows.filter((_, j) => j !== index)),
    [rows, write],
  );

  return { rows, editChoice, addChoice, removeChoice };
};
