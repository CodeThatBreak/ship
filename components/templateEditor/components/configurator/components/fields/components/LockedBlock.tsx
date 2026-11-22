"use client";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One collapsible reference block (built-in body / locked rules / contract /
 * assembled preview): header row with the char count, read-only pre when open.
 */
export function LockedBlock({
  title,
  badge,
  open,
  onToggle,
  text,
  note,
  muted,
}: {
  title: string;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  text: string;
  note?: string;
  /** the built-in body — informational, not engine-locked */
  muted?: boolean;
}) {
  return (
    <div className="border border-border rounded-lg px-3 py-2 grid gap-1.5">
      <button
        type="button"
        className="flex items-center gap-2 text-left cursor-pointer select-none"
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronDown size={13} className={cn("text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">{title}</span>
        {badge && <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">{badge}</span>}
        <span className="text-[11px] text-muted-foreground">{text.length.toLocaleString()} chars</span>
      </button>
      {open && (
        <div className="grid gap-1">
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
          <pre
            className={cn(
              "text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap m-0 max-h-56 overflow-y-auto rounded-lg px-2.5 py-2 bg-muted/40",
              muted ? "text-foreground/80" : "text-muted-foreground",
            )}
          >
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
