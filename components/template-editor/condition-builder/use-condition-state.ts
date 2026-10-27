"use client";
/**
 * The condition builder's draft state (the container's data layer): the
 * rows/combinator drafting with the compile-then-emit rule, the raw-mode
 * draft (the parent's value only moves on a complete edit — typing raw does
 * not ping-pong through the parent), the seed from the incoming value and
 * the "build visually" escape hatch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compileCondition,
  decomposeCondition,
  type ConditionRow,
} from "../condition-grammar";
import { EMPTY_ROW } from "./constants";
import type { Combinator } from "./types";

/** decomposeCondition's pick — non-null-ish rows plus combinator. */
type Decomposed = NonNullable<ReturnType<typeof decomposeCondition>>;

export function useConditionState({
  value,
  onChange,
}: {
  /** the raw JSONata condition (null / "" = none) */
  value: string | null;
  onChange: (raw: string | null) => void;
}) {
  /** the builder's local rows — emitted only when they compile */
  const [rows, setRows] = useState<ConditionRow[]>([]);
  const [combinator, setCombinator] = useState<Combinator>("and");
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  /** the compiled text last emitted — external values equal to it don't reset the rows */
  const lastEmitted = useRef<string | null>(null);
  /** the raw text while in raw mode (the parent's value only moves on a
   *  complete edit — typing raw does not ping-pong through the parent) */
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  // seed from the incoming value: decomposable → builder rows, else raw mode
  // ("" and null are the same "no condition" — a clear doesn't re-seed)
  useEffect(() => {
    if (value === lastEmitted.current || (!value && !lastEmitted.current))
      return;
    lastEmitted.current = null;
    const dec = decomposeCondition(value);
    if (dec) {
      setRows(dec.rows.length ? dec.rows : [EMPTY_ROW]);
      setCombinator(dec.combinator);
      setMode("builder");
    } else {
      setMode("raw");
      setRawDraft(value ?? "");
    }
  }, [value]);

  const emit = (next: ConditionRow[], comb: Combinator) => {
    setRows(next);
    setCombinator(comb);
    const out = compileCondition(next, comb);
    // store what the parent will hold ("" collapses to null) — the seed
    // effect skips values that match, so a clear doesn't re-seed and wipe
    // the rows mid-edit
    lastEmitted.current = out || null;
    onChange(out || null);
  };

  const patchRow = (index: number, patch: Partial<ConditionRow>) =>
    emit(
      rows.map((x, j) => (j === index ? { ...x, ...patch } : x)),
      combinator,
    );
  const removeRow = (index: number) =>
    emit(rows.filter((_, j) => j !== index), combinator);
  const addCondition = () => emit([...rows, EMPTY_ROW], combinator);
  const changeCombinator = (raw: Combinator | null) =>
    emit(rows, raw ?? "and");

  /** raw mode: the draft edit — emitted as typed (raw commits on its own) */
  const editRaw = (v: string) => {
    setRawDraft(v);
    lastEmitted.current = v || null;
    onChange(v || null);
  };

  const switchToRaw = () => {
    setRawDraft(value ?? "");
    setMode("raw");
  };

  // decomposable again while editing raw? (drives the "build visually" escape)
  const rawDecomposed = useMemo(() => decomposeCondition(rawDraft), [rawDraft]);

  const buildVisually = () => {
    if (!rawDecomposed) return;
    setRows(rawDecomposed.rows.length ? rawDecomposed.rows : [EMPTY_ROW]);
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
    editRaw,
    switchToRaw,
    buildVisually,
  };
}

export type DecomposedCondition = Decomposed;
