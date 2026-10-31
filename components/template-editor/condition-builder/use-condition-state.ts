"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compileCondition,
  decomposeCondition,
  inferValueKind,
  type ConditionRow,
} from "../condition-grammar";
import { EMPTY_ROW } from "./constants";
import type { Combinator } from "./types";

type Decomposed = NonNullable<ReturnType<typeof decomposeCondition>>;
type RowState = ConditionRow & { id: string };

const newRowId = (): string => crypto.randomUUID();

const withIds = (rows: ConditionRow[]): RowState[] =>
  rows.map((r) => ({ ...r, id: newRowId() }));

export const useConditionState = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (raw: string | null) => void;
}) => {
  const [rows, setRows] = useState<RowState[]>(() => withIds([EMPTY_ROW]));
  const [combinator, setCombinator] = useState<Combinator>("and");
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  const lastEmitted = useRef<string | null>(null);
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = null;
    const dec = decomposeCondition(value);
    if (dec) {
      setRows(dec.rows.length ? withIds(dec.rows) : withIds([EMPTY_ROW]));
      setCombinator(dec.combinator);
      setMode("builder");
    } else {
      setMode("raw");
      setRawDraft(value ?? "");
    }
  }, [value]);

  const emit = (next: RowState[], comb: Combinator) => {
    setRows(next);
    setCombinator(comb);
    const out = compileCondition(next, comb);
    lastEmitted.current = out || null;
    onChange(out || null);
  };

  const patchRow = (index: number, patch: Partial<ConditionRow>) => {
    const merged =
      patch.value !== undefined && patch.valueKind === undefined
        ? { ...patch, valueKind: inferValueKind(patch.value) }
        : patch;
    emit(
      rows.map((x, j) => (j === index ? { ...x, ...merged } : x)),
      combinator,
    );
  };
  const removeRow = (index: number) =>
    emit(rows.filter((_, j) => j !== index), combinator);
  const addCondition = () => emit([...rows, { ...EMPTY_ROW, id: newRowId() }], combinator);
  const changeCombinator = (raw: Combinator | null) => emit(rows, raw ?? "and");

  const editRawDraft = (v: string) => setRawDraft(v);

  const commitRaw = () => {
    const v = rawDraft ?? "";
    lastEmitted.current = v || null;
    onChange(v || null);
  };

  const switchToRaw = () => {
    setRawDraft(value ?? "");
    setMode("raw");
  };

  const rawDecomposed = useMemo(() => decomposeCondition(rawDraft), [rawDraft]);

  const buildVisually = () => {
    if (!rawDecomposed) return;
    setRows(
      rawDecomposed.rows.length ? withIds(rawDecomposed.rows) : withIds([EMPTY_ROW]),
    );
    setCombinator(rawDecomposed.combinator);
    setMode("builder");
  };

  return {
    rows,
    combinator,
    mode,
    rawDraft,
    rawDecomposed,
    patchRow,
    removeRow,
    addCondition,
    changeCombinator,
    editRawDraft,
    commitRaw,
    switchToRaw,
    buildVisually,
  };
};

export type DecomposedCondition = Decomposed;
