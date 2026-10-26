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
 * changes. The Tiptap wiring lives in `hooks/`, the popup in `components/`.
 */
import { EditorContent } from "@tiptap/react";
import { useVariablePopup } from "./hooks/use-variable-popup";
import { usePromptEditor } from "./hooks/use-prompt-editor";
import { VariablePopup } from "./components/VariablePopup";
import type { VarGroup } from "./variables";

export function PromptEditor({
  value,
  groups,
  onChange,
  className,
  invalidRefs,
}: {
  value: string;
  /** the grouped variable vocabulary (variables.ts) */
  groups: VarGroup[];
  onChange: (text: string) => void;
  className?: string;
  /** ref (inner text) → the linter's problem — underlined inline */
  invalidRefs?: Record<string, string>;
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

  return (
    <div className="relative">
      <EditorContent editor={editor} />
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
