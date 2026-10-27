import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One collapsible locked part of the prompt (rules / output contract / run
 * data): a header row with a chevron, an optional editable child (the rules
 * box), and the locked text in a read-only block when expanded.
 */
export function LockedSection({
  title,
  badge,
  open,
  onToggle,
  lockedText,
  lockedEmpty,
  note,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  lockedText?: string;
  lockedEmpty: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg px-3 py-2.5 grid gap-2">
      <button
        type="button"
        className="flex items-center gap-2 text-left cursor-pointer select-none"
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronDown size={13} className={cn("text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">{title}</span>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">{badge}</span>
        {lockedText != null && lockedText.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{lockedText.length.toLocaleString()} chars</span>
        )}
      </button>
      {children}
      {open && (
        <div className="grid gap-1">
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
          <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground m-0 max-h-56 overflow-y-auto rounded-lg bg-muted/40 px-2.5 py-2">
            {lockedText?.trim() ? lockedText : lockedEmpty}
          </pre>
        </div>
      )}
    </div>
  );
}
