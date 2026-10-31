"use client";
/**
 * The autocomplete popover — one anchored panel over the field showing the
 * matching paths (the same vocabulary as the prompt `@` menu). Shared by the
 * path fields and the raw expression boxes.
 */
import { Fragment, useMemo } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "../../ui/scroll-area";
import { cn } from "../../../lib/utils";
import type { JsonataPathOption } from "../variables";
import {
  AUTOCOMPLETE_LIMIT,
  PANEL_GAP,
  PANEL_MAX_HEIGHT,
  PANEL_WIDTH,
  VIEWPORT_MARGIN,
} from "./constants";

/** The path-ish token ending at the caret (letters, digits, `_`, `.`, `$`). */
export const tokenBefore = (
  text: string,
  caret: number,
): { start: number; token: string } => {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.$]/.test(text[start - 1])) start--;
  return { start, token: text.slice(start, caret) };
};

export const matchOptions = (
  options: JsonataPathOption[],
  token: string,
): JsonataPathOption[] => {
  const q = token.trim().toLowerCase();
  const hits = options.filter((o) => !q || o.path.toLowerCase().includes(q));
  return hits.slice(0, AUTOCOMPLETE_LIMIT);
};

export const handlePathPopoverKeyDown = ({
  e,
  count,
  highlight,
  setHighlight,
  shown,
  onPick,
  onDismiss,
  menuOpen,
  setMenuOpen,
}: {
  e: React.KeyboardEvent;
  count: number;
  highlight: number;
  setHighlight: (next: number | ((h: number) => number)) => void;
  shown: JsonataPathOption[];
  onPick: (path: string) => void;
  onDismiss: () => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}): void => {
  if (e.key === "ArrowDown") {
    if (!menuOpen && count > 0) {
      setMenuOpen(true);
      setHighlight(0);
      e.preventDefault();
      return;
    }
    if (menuOpen && count > 0) {
      e.preventDefault();
      setHighlight((h) => Math.min(count - 1, h < 0 ? 0 : h + 1));
    }
    return;
  }
  if (e.key === "ArrowUp" && menuOpen && count > 0) {
    e.preventDefault();
    setHighlight((h) => Math.max(0, h - 1));
    return;
  }
  if (e.key === "Enter" && menuOpen && highlight >= 0 && count > 0) {
    e.preventDefault();
    onPick(shown[highlight].path);
    return;
  }
  if (e.key === "Escape" && menuOpen) {
    e.preventDefault();
    onDismiss();
  }
};

export function PathPopover({
  options,
  token,
  onPick,
  align = "left",
  anchor,
  highlight,
  setHighlight,
}: {
  options: JsonataPathOption[];
  token: string;
  onPick: (path: string) => void;
  align?: "left" | "right";
  anchor: HTMLElement | null;
  highlight: number;
  setHighlight: (next: number | ((h: number) => number)) => void;
}) {
  const shown = useMemo(() => matchOptions(options, token), [options, token]);
  const count = shown.length;

  if (!count || !anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const opensBelow =
    rect.bottom + PANEL_GAP + PANEL_MAX_HEIGHT <= window.innerHeight;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      align === "right" ? rect.right - PANEL_WIDTH : rect.left,
      window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
    ),
  );
  const placement = opensBelow
    ? { top: rect.bottom + PANEL_GAP }
    : { bottom: window.innerHeight - rect.top + PANEL_GAP };

  return createPortal(
    <div
      role="listbox"
      className="overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5"
      style={{ position: "fixed", left, width: PANEL_WIDTH, zIndex: 50, ...placement }}
    >
      <ScrollArea viewportClassName="max-h-56">
        {shown.map((o, i) => (
          <Fragment key={o.path + i}>
            {(i === 0 || shown[i - 1].group !== o.group) && (
              <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {o.group}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(o.path);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                i === highlight
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/60",
              )}
            >
              <code className="font-mono text-[11px] truncate">{o.path}</code>
              {o.type && (
                <span className="shrink-0 text-[9.5px] text-muted-foreground/70">
                  {o.type}
                </span>
              )}
            </button>
          </Fragment>
        ))}
      </ScrollArea>
    </div>,
    document.body,
  );
}
