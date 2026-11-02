"use client";
/** One read row: `name ← source` + badges + the re-map / remove controls. */
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from '../../../../ui/badge';
import { Button } from '../../../../ui/button';
import type { InputRowModel } from '../../../hooks/useInputMap';
import { resolveMapExpr } from '../../../variables';

export function InputRow({
  name,
  type,
  from,
  expr,
  onRemap,
  onRemove,
}: InputRowModel & {
  /** re-map: the flag picks the override edit (fixed name) vs the mapped edit */
  onRemap: (name: string, mapped: boolean) => void;
  /** mapped rows only — an inherited-only row has nothing to remove */
  onRemove?: (name: string) => void;
}) {
  const mapped = expr != null;
  const conflict = from != null && from.length > 1;
  const e = expr ?? "";
  const sourceText = mapped
    ? (resolveMapExpr(e)?.source ?? e)
    : `${(from ?? []).join(" + ")} · output.${name}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-0 first:rounded-t-lg last:rounded-b-lg",
        !mapped && "bg-muted/30",
      )}
    >
      <code
        className={cn(
          "font-mono text-[12px] shrink-0",
          mapped ? "text-info" : "text-muted-foreground",
        )}
      >
        {name}
      </code>
      {type && <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{type}</span>}
      <span className="text-muted-foreground/70 shrink-0">←</span>
      <span
        className={cn(
          "text-[12px] min-w-0 truncate flex-1",
          mapped ? "font-mono text-[11.5px]" : "text-muted-foreground",
        )}
        title={mapped ? e : sourceText}
      >
        {sourceText}
      </span>
      {mapped ? (
        <Badge className="bg-info/10 text-info text-[10px] py-0 shrink-0">mapped</Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] py-0 shrink-0">inherited</Badge>
      )}
      {conflict && !mapped && (
        <Badge
          className="bg-warning/10 text-warning text-[10px] py-0 shrink-0"
          title="Two parents publish this field — the last one to finish wins. Map it to pick a source explicitly."
        >
          {from?.length} sources
        </Badge>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground shrink-0 h-7 px-2"
        onClick={() => onRemap(name, mapped)}
      >
        re-map
      </Button>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground shrink-0 h-7 px-1.5"
          title="Remove mapping — falls back to the inherited value"
          onClick={() => onRemove(name)}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}
