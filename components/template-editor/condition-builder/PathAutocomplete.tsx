"use client";
/**
 * The autocomplete popover — one anchored panel over the field showing the
 * matching paths (the same vocabulary as the prompt `@` menu). Shared by the
 * path fields and the raw expression boxes.
 *
 * It renders through a portal at fixed coordinates taken from the field's
 * viewport rect: the fields live inside scroll containers (the configurator's
 * ScrollArea, the rows card) whose overflow clips in-flow descendants, so an
 * absolutely-positioned panel gets truncated instead of overlaying the card.
 * The panel flips above the field when the viewport edge is too close and
 * clamps horizontally so narrow side panels can't cut it off.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
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
export function tokenBefore(
  text: string,
  caret: number,
): { start: number; token: string } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.$]/.test(text[start - 1])) start--;
  return { start, token: text.slice(start, caret) };
}

export function matchOptions(
  options: JsonataPathOption[],
  token: string,
): JsonataPathOption[] {
  const q = token.trim().toLowerCase();
  const hits = options.filter((o) => !q || o.path.toLowerCase().includes(q));
  return hits.slice(0, AUTOCOMPLETE_LIMIT);
}

export function PathPopover({
  options,
  token,
  onPick,
  onDismiss,
  align = "left",
  anchor,
}: {
  options: JsonataPathOption[];
  token: string;
  onPick: (path: string) => void;
  onDismiss: () => void;
  /** which edge of the field the panel hugs — "right" keeps the panel inside
   *  a narrow side panel when the field sits far from the left edge */
  align?: "left" | "right";
  /** the focused field element — the panel anchors to its viewport rect */
  anchor: HTMLElement | null;
}) {
  const shown = useMemo(() => matchOptions(options, token), [options, token]);
  const [highlight, setHighlight] = useState(0);
  const count = shown.length;
  useEffect(() => {
    setHighlight(0);
  }, [token, count]);
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.min(count - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onPick(shown[Math.min(highlight, count - 1)].path);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [count, highlight, shown, onPick, onDismiss]);

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
  // below the field, or flipped above it (anchored by its bottom edge) when
  // the viewport edge is too close for the panel's worst-case height
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
