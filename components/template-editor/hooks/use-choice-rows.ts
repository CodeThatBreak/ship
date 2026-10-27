"use client";
/**
 * The decision branch-choices editor's row state (Phase 5), extracted from
 * ConfigFieldRow.tsx: the in-place label / description / condition rows and
 * the write-through to the config. At least one labeled choice is required by
 * the decision schema; an all-empty edit keeps the last good set (the write
 * skips when no row has a label) and the editor warns instead.
 */
import { useCallback, useState } from "react";

/** One in-place choices row: the editable draft strings. */
export interface ChoiceDraft {
  label: string;
  description: string;
  condition: string;
}

/** The persisted choice shape: label required, the rest undefined when empty. */
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

export function useChoiceRows({
  value,
  defaultValue,
  onChange,
}: UseChoiceRowsOptions) {
  const effective = (
    Array.isArray(value)
      ? value
      : Array.isArray(defaultValue)
        ? defaultValue
        : []
  ) as ChoiceValue[];
  const [rows, setRows] = useState<ChoiceDraft[]>(() =>
    effective.map((c) => ({
      label: c.label,
      description: c.description ?? "",
      condition: c.condition ?? "",
    })),
  );

  // the write-through: only labeled choices persist (empty drafts stay in
  // the editor for the next attempt)
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

  // monolithic indexed callbacks for the presentational rows (§2.5 — no
  // per-row closures inside the editor's map)
  const editChoice = useCallback(
    (index: number, patch: Partial<ChoiceDraft>) => {
      write(rows.map((x, j) => (j === index ? { ...x, ...patch } : x)));
    },
    [rows, write],
  );
  const addChoice = useCallback(
    () => write([...rows, { label: "", description: "", condition: "" }]),
    [rows, write],
  );
  const removeChoice = useCallback(
    (index: number) => write(rows.filter((_, j) => j !== index)),
    [rows, write],
  );

  return { rows, editChoice, addChoice, removeChoice };
}
