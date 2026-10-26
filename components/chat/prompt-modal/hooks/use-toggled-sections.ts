"use client";
import { useCallback, useState } from "react";

/**
 * The collapsible section state shared by the prompt modal's locked blocks
 * (rules / output contract / run data): a Set of currently expanded ids plus
 * a toggle. AGENTS.md §2.2 (2): the stateful idiom extracted from the
 * container so the modal body stays declarative.
 */
export function useToggledSections(): [Set<string>, (id: string) => void] {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setOpenSections((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  return [openSections, toggle];
}
