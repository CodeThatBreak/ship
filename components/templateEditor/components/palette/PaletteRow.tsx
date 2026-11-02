/**
 * A pickable persisted-row palette entry: icon, name, description, and the
 * plus (or a lock with a reason — e.g. the second Start node).
 */
import { Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeCatalogEntry } from '../../hooks/useNodeCatalog';
import { iconForIconName } from '../../icons';

export function PaletteRow({
  n,
  disabled,
  lockTitle,
  onAdd,
}: {
  n: NodeCatalogEntry;
  disabled?: boolean;
  lockTitle?: string;
  /** the palette's placement callback (stable) — one placement per row,
   *  the row hands over its own identity; no handlers minted in `.map()` */
  onAdd: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
}) {
  const Icon = iconForIconName(n.icon, n.is_builtin ? n.key : n.kind, n.key);
  return (
    <button
      onClick={() => onAdd(n.id, n.is_builtin, n.key, n.name)}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed text-muted-foreground"
          : "hover:bg-muted/60 text-foreground",
      )}
      title={lockTitle ?? (disabled ? "Read-only template — duplicate from the gallery to edit" : `Add ${n.name}`)}
    >
      <Icon size={14} className={cn("shrink-0", n.kind === "decision" ? "text-violet-300" : "text-muted-foreground")} />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight truncate">{n.name}</span>
        {n.description && <span className="block text-[10.5px] text-muted-foreground truncate">{n.description}</span>}
      </span>
      {lockTitle ? <Lock size={11} className="text-muted-foreground shrink-0" /> : <Plus size={12} className="text-muted-foreground shrink-0" />}
    </button>
  );
}
