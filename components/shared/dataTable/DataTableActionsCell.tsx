import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DataTableAction } from "./types";

/** Upfront button + ⋯ overflow menu for one row's actions (see `getActions`). */
export const DataTableActionsCell = <TData,>({
  row,
  actions,
}: {
  row: TData;
  actions: DataTableAction<TData>[];
}) => {
  if (actions.length === 0) return null;
  const [primary, ...overflow] = actions;
  const href = primary.href;
  const onSelect = primary.onSelect;
  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {href ? (
        <Button
          size="sm"
          variant="outline"
          disabled={primary.disabled}
          title={primary.title}
          render={<a href={href(row)} />}
        >
          {primary.icon}
          {primary.label}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          title={primary.title}
          disabled={primary.disabled}
          onClick={() => onSelect?.(row)}
        >
          {primary.icon}
          {primary.label}
        </Button>
      )}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
                title="More actions"
              />
            }
          >
            <Ellipsis size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[150px]">
            {overflow.map((action, index) => {
              const actionHref = action.href;
              const actionOnSelect = action.onSelect;
              return (
                <DropdownMenuItem
                  key={`${index}-${action.label}`}
                  variant={action.destructive ? "destructive" : "default"}
                  disabled={action.disabled}
                  title={action.title}
                  onClick={
                    actionHref
                      ? () => window.location.assign(actionHref(row))
                      : actionOnSelect
                        ? () => actionOnSelect(row)
                        : undefined
                  }
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
