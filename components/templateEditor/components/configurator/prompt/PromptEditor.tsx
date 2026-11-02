"use client";
/**
 * The agent prompt's rich text editor (§8) — Tiptap, the editor shadcn
 * recommends. Plain-text documents only (no formatting marks to surprise the
 * runtime interpolation), with three affordances on top:
 *
 *   • typing "@" opens the grouped variable popover (Phase 3) — inherited
 *     inputs → task context → upstream nodes → trigger payload, filtered as
 *     you type; picking one inserts its raw `{{...}}` ref at the cursor;
 *   • existing `{{...}}` refs anywhere in the text are highlighted inline and
 *     color-coded by root — `{{input.*}}` blue (logical), `{{nodes.*}}`
 *     violet (physical, wiring-dependent), other roots neutral;
 *   • refs the live linter can't resolve are underlined (tooltip says why) —
 *     validated where they're typed, not at Save.
 *
 * The stored value stays the plain prompt string — the editor round-trips it
 * (paragraphs ⇄ newlines), so nothing in the runtime or the save format
 * changes. A `lockedText` renders the engine's rules as read-only rows of
 * the same input (outside the doc — unpersisted, non-deletable). The Tiptap
 * wiring lives in `hooks/`, the popup in `components/`.
 */
import { EditorContent } from "@tiptap/react";
import { Lock } from "lucide-react";
import { useVariablePopup } from '../../../hooks/useVariablePopup';
import { usePromptEditor } from '../../../hooks/usePromptEditor';
import { VariablePopup } from './VariablePopup';
import type { VarGroup } from '../../../variables';

export function PromptEditor({
  value,
  groups,
  onChange,
  className,
  invalidRefs,
  lockedText,
}: {
  value: string;
  /** the grouped variable vocabulary (variables.ts) */
  groups: VarGroup[];
  onChange: (text: string) => void;
  className?: string;
  /** ref (inner text) → the linter's problem — underlined inline */
  invalidRefs?: Record<string, string>;
  /** the engine's locked rules — attached under the editable body as
   *  read-only rows of the same input; not part of the doc, so they can't
   *  be deleted or stored (built-ins only) */
  lockedText?: string;
}) {
  const {
    extension,
    popup,
    items,
    query,
    highlight,
    onInsert,
    onHover,
  } = useVariablePopup(groups);

  const editor = usePromptEditor({
    value,
    onChange,
    className,
    invalidRefs,
    suggestionExtension: extension,
  });

  const lockedLines = (lockedText ?? "")
    .split("\n")
    .filter((line) => line.trim());

  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {lockedLines.length > 0 && (
        // reads as the bottom half of the same input — but it's rendered
        // outside the Tiptap doc, so it's non-editable and never persisted
        <div
          className="rounded-b-lg border border-t-0 border-border bg-muted/40 px-3 py-2 select-none"
          aria-label="Engine rules — locked, appended on every run"
        >
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground m-0 mb-1">
            <Lock size={10} /> Engine rules · locked
          </p>
          {lockedLines.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Lock size={10} className="mt-[3px] shrink-0 text-muted-foreground/60" />
              <span className="font-mono text-[12px] leading-relaxed text-muted-foreground">
                {line}
              </span>
            </div>
          ))}
        </div>
      )}
      {popup && (
        <VariablePopup
          position={popup}
          items={items}
          query={query}
          highlight={highlight}
          onInsert={onInsert}
          onHover={onHover}
        />
      )}
    </div>
  );
}
