"use client";
/**
 * The per-field "Variables ▾" picker (Phase 3), the presentational half
 * extracted from ConfigFieldRow.tsx: the trigger button, the anchored panel
 * with its search box, and the grouped vocabulary as click-to-insert
 * `{{...}}` rows. Open/query/dismiss state comes from `useVariablesPopover`.
 */
import { Fragment } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { ScrollArea } from "../../ui/scroll-area";
import { cn } from "../../../lib/utils";
import { useVariablesPopover } from "../hooks/use-variables-popover";
import { varGroupAccent, type VarGroup } from "../variables";

export function VariablesPicker({
  groups,
  onInsert,
}: {
  groups: VarGroup[];
  onInsert: (ref: string) => void;
}) {
  const { open, query, setQuery, shown, rootRef, close, toggle } =
    useVariablesPopover(groups);
  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        className="rounded-full text-[11px] text-muted-foreground hover:text-foreground"
      >
        Variables{" "}
        <ChevronDown
          size={10}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-72 max-h-64 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search variables…"
            className="mb-1 border-border bg-muted/60 px-2 py-1 text-[12px]"
          />
          <ScrollArea className="flex-1">
            {shown.length === 0 && (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
                No matching variable
              </div>
            )}
            {shown.map((g) => (
              <Fragment key={g.id + g.title}>
                <div className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {g.title}
                  </span>
                  {g.origin && (
                    <span className="text-[9.5px] text-muted-foreground/70 truncate">
                      {g.origin}
                    </span>
                  )}
                </div>
                {g.fields.map((f) => (
                  <button
                    key={f.insert}
                    title={f.insert}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onInsert(f.insert);
                      close();
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-muted/60 transition-colors"
                  >
                    <span className="truncate">{f.name}</span>
                    {f.type && (
                      <span className="shrink-0 text-[9.5px] text-muted-foreground/70">
                        {f.type}
                      </span>
                    )}
                    <span className="flex-1" />
                    <code
                      className={cn(
                        "font-mono text-[9.5px] truncate max-w-[140px]",
                        varGroupAccent(g.id),
                      )}
                    >
                      {f.insert}
                    </code>
                  </button>
                ))}
              </Fragment>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
