"use client";
/**
 * The "Variables ▾" anchored popover's state, extracted from
 * ConfigFieldRow.tsx (Phase 3): the open flag, the search query, the
 * vocabulary filtered live against it, and the close-on-outside click /
 * Escape effect. One affordance for every {{...}}-bearing field — the
 * grouped vocabulary (inherited → task → upstream → trigger) in an anchored
 * panel; picking a variable inserts its `{{...}}` ref (click-to-insert
 * supersedes the old chip rows; the braces ride along — the raw-JSONata
 * surfaces compile their options separately via `asJsonataGroups`).
 */
import { useEffect, useRef, useState } from "react";
import { filterVarGroups, type VarGroup } from "../variables";

export function useVariablesPopover(groups: VarGroup[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = filterVarGroups(groups, query);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
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

  const close = () => setOpen(false);
  const toggle = () => setOpen((o) => !o);
  return { open, query, setQuery, shown, rootRef, close, toggle };
}
