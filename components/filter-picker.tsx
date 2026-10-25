"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

/**
 * GitLab-style filter picker: one input-shaped box that holds the applied
 * filters as removable tokens, a trailing free-text field, and a "+" menu
 * (filter → value submenu) to add filters. Filters are single-select —
 * re-adding a filter replaces its value.
 */
export type FilterDef = {
  key: string;
  label: string;
  /** selectable values; a filter with no values is skipped in the menu */
  values: { value: string; label: string }[];
};

export function FilterPicker({
  defs,
  filters,
  onFiltersChange,
  text,
  onTextChange,
  placeholder = "Search…",
  className,
}: {
  defs: FilterDef[];
  /** applied filters: def.key → value (value must be one of the def's values) */
  filters: Record<string, string>;
  onFiltersChange: (filters: Record<string, string>) => void;
  text: string;
  onTextChange: (text: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const setFilter = (key: string, value: string) =>
    onFiltersChange({ ...filters, [key]: value });

  const removeFilter = (key: string) => {
    const next = { ...filters };
    delete next[key];
    onFiltersChange(next);
  };

  const valueLabel = (def: FilterDef, value: string) =>
    def.values.find((v) => v.value === value)?.label ?? value;

  const addable = defs.filter((d) => d.values.length > 0);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 flex-wrap h-8 min-w-[280px] max-w-full rounded-lg border border-border bg-input/50 px-1.5 py-0.5 transition-[color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        className,
      )}
    >
      {/* applied filter tokens */}
      {defs
        .filter((d) => filters[d.key])
        .map((def) => (
          <span
            key={def.key}
            className="inline-flex h-6 items-center gap-1 rounded-lg bg-muted pl-2 pr-1 text-[11.5px] font-medium"
          >
            <span className="text-muted-foreground">{def.label}</span>
            <span className="text-foreground">·</span>
            <span>{valueLabel(def, filters[def.key])}</span>
            <button
              onClick={() => removeFilter(def.key)}
              className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
              title={`Remove ${def.label} filter`}
            >
              <X size={10} />
            </button>
          </span>
        ))}

      {/* free text */}
      <input
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Search tasks…"
        className="h-6 min-w-[90px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />

      {/* add-filter menu */}
      {addable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                title="Add filter"
                className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Plus size={12} />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {/* plain header (Base UI's GroupLabel requires a Menu.Group parent) */}
            <div className="px-2 py-1 text-xs text-muted-foreground">Filter by</div>
            {addable.map((def, i) => (
              <div key={def.key}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{def.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[140px]">
                    <DropdownMenuRadioGroup
                      value={filters[def.key] ?? ""}
                      onValueChange={(v) => {
                        if (!v) removeFilter(def.key);
                        else setFilter(def.key, v);
                      }}
                    >
                      {def.values.map((v) => (
                        <DropdownMenuRadioItem key={v.value} value={v.value}>
                          {v.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
