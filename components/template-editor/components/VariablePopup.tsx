"use client";
/**
 * The "@" variable popover (presentational): the grouped, filtered list and
 * its highlight — ownership of the Tiptap wiring stays in the hook, this only
 * renders it and reports picks / hovers back.
 */
import { Fragment } from "react";
import { ScrollArea } from "../../ui/scroll-area";
import { cn } from "../../../lib/utils";
import { varGroupAccent } from "../variables";
import type { VarItem } from "../hooks/use-variable-popup";

export function VariablePopup({
  position,
  items,
  query,
  highlight,
  onInsert,
  onHover,
}: {
  /** viewport coords (the suggestion's clientRect anchor, +4px gap) */
  position: { top: number; left: number };
  /** the flat filtered list — group headers render above their group's rows */
  items: VarItem[];
  /** the "@<query>" filter typed so far ("" = unfiltered) */
  query: string;
  /** the highlighted row index (arrow keys / hover) */
  highlight: number;
  /** a pick — insert the ref at the cursor; the hook closes the popup */
  onInsert: (item: VarItem) => void;
  /** hover moves the keyboard highlight */
  onHover: (index: number) => void;
}) {
  return (
    <div
      className="fixed z-[60] flex w-80 max-h-64 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ top: position.top + 4, left: position.left }}
    >
      <ScrollArea className="flex-1">
        {query && (
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Variables <span className="normal-case tracking-normal">· &ldquo;{query}&rdquo;</span>
          </div>
        )}
        {items.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching variable</div>
        )}
        {items.map((item, i) => {
          // a header per group, rendered only where the group has fields —
          // the flat filtered list keeps headers attached to their rows
          const header = i === 0 || items[i - 1].group !== item.group;
          return (
            <Fragment key={`${item.group.id}:${item.field.insert}:${i}`}>
              {header && (
                <div
                  className={cn(
                    "flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5",
                    i === 0 && "pt-1",
                  )}
                >
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {item.group.title}
                  </span>
                  {item.group.origin && (
                    <span className="text-[9.5px] text-muted-foreground/70 truncate">
                      {item.group.origin}
                    </span>
                  )}
                </div>
              )}
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  onInsert(item);
                }}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                )}
              >
                <span className="truncate">{item.field.name}</span>
                {item.field.type && (
                  <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{item.field.type}</span>
                )}
                <span className="flex-1" />
                <code
                  className={cn(
                    "font-mono text-[9.5px] truncate max-w-[150px]",
                    varGroupAccent(item.group.id),
                  )}
                >
                  {item.field.insert}
                </code>
              </button>
            </Fragment>
          );
        })}
      </ScrollArea>
    </div>
  );
}
