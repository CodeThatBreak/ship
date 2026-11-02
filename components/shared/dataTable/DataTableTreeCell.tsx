import type { Row } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const DataTableTreeCell = <TData,>({
  row,
  content,
}: {
  row: Row<TData>;
  content: React.ReactNode;
}) => {
  const canExpand = row.getCanExpand();
  return (
    <div className="flex items-center" style={{ paddingLeft: row.depth * 18 }}>
      {canExpand ? (
        <button
          type="button"
          aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
          title={row.getIsExpanded() ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform", row.getIsExpanded() && "rotate-90")}
          />
        </button>
      ) : (
        <span className="mr-1 inline-block h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );
};
