/**
 * A New-node row: same shape as a palette row, but it places a draft def
 * (nothing persists until Save).
 */
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuthorKind } from "../hooks/usePaletteCatalog";
import { iconForIconName } from "../icons";

/** Title for the New-node rows (the same text the old kind tiles carried). */
function kindNodeTitle(title: string): string {
  return `Place a blank ${title.toLowerCase()} node — drag from a handle to connect it, then author it in the drawer. Nothing is saved until you Save the template.`;
}

export function KindRow({
  kind,
  title,
  disabled,
  onAddKind,
}: {
  kind: AuthorKind;
  title: string;
  disabled?: boolean;
  /** the palette's New-node placement callback (stable) — the row hands over
   *  its own kind; no handlers minted inside the rows' `.map()` */
  onAddKind: (kind: AuthorKind) => void;
}) {
  const Icon = iconForIconName(null, kind);
  return (
    <button
      onClick={() => onAddKind(kind)}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed text-muted-foreground"
          : "hover:bg-muted/60 text-foreground",
      )}
      title={kindNodeTitle(title)}
    >
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight truncate">{title}</span>
      </span>
      <Plus size={12} className="text-muted-foreground shrink-0" />
    </button>
  );
}
