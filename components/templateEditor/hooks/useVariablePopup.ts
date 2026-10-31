"use client";
/**
 * The prompt editor's "@" variable popup (Phase 3): the Tiptap Suggestion
 * extension plus the popup's React state. The extension is created once —
 * its callbacks read the live vocabulary through a ref, so rewiring edges
 * updates the popover without re-creating the editor.
 */
import { useEffect, useRef, useState } from "react";
import type { Extension as CoreExtension } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { filterVarGroups, type VarField, type VarGroup } from "../variables";

/** One pickable item in the flat filtered list — the field plus its group. */
export interface VarItem {
  field: VarField;
  group: VarGroup;
}

/** The groups' fields → one flat, ordered list for the suggestion engine. */
function flatItems(groups: VarGroup[], query: string): VarItem[] {
  return filterVarGroups(groups, query).flatMap((group) =>
    group.fields.map((field) => ({ field, group })),
  );
}

/**
 * The "@" variable suggestion: a plain-text insert (no mention node in the
 * doc — the ref text IS the value), with the popup owned by the React tree.
 */
function variableSuggest(options: {
  items: (query: string) => VarItem[];
  onPopup: (props: SuggestionProps<VarItem> | null) => void;
  /** true when the popup owns the key (arrows / Enter / Escape) */
  onSuggestKeyDown?: (event: KeyboardEvent) => boolean;
}): CoreExtension {
  return Extension.create({
    name: "variableSuggest",
    addProseMirrorPlugins() {
      return [
        Suggestion<VarItem>({
          editor: this.editor,
          char: "@",
          allowSpaces: false,
          items: ({ query }) => options.items(query),
          command: ({ editor, range, props: item }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [{ type: "text", text: `${item.field.insert} ` }])
              .run();
          },
          render: () => ({
            onStart: (props) => options.onPopup(props),
            onUpdate: (props) => options.onPopup(props),
            onExit: () => options.onPopup(null),
            onKeyDown: ({ event }) =>
              options.onSuggestKeyDown?.(event) ?? false,
          }),
        }),
      ];
    },
  });
}

/** The variable-pickup popup's state + the Tiptap extension driving it. */
export function useVariablePopup(groups: VarGroup[]) {
  // the variable list rides a ref — rewiring edges updates the popover
  // without re-creating the editor
  const varsRef = useRef(groups);
  varsRef.current = groups;

  const propsRef = useRef<SuggestionProps<VarItem> | null>(null);
  const popupOpenRef = useRef(false);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  // created once at mount — every callback it captures is a stable ref /
  // setState, so the suggestion engine never re-wires across renders
  const [extension] = useState<CoreExtension>(() =>
    variableSuggest({
      items: (query) => flatItems(varsRef.current, query),
      onPopup: (props) => {
        propsRef.current = props;
        popupOpenRef.current = props != null;
        if (!props) {
          setPopup(null);
          return;
        }
        const rect = props.clientRect?.();
        setPopup(rect ? { top: rect.bottom, left: rect.left } : null);
        setHighlight(0);
      },
      onSuggestKeyDown: (event) =>
        popupOpenRef.current &&
        ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key),
    }),
  );

  // popup keyboard control (capture phase — runs before the editor sees keys)
  const popupOpen = popup != null;
  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const props = propsRef.current;
      const items = props?.items ?? [];
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.min(items.length - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.max(0, h - 1));
      } else if ((e.key === "Enter" || e.key === "Tab") && props) {
        e.preventDefault();
        e.stopPropagation();
        props.command(items[Math.min(highlight, items.length - 1)]);
        setPopup(null);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPopup(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // highlight rides a fresh closure per render — the listener re-binds on it
  }, [popupOpen, highlight]);

  /** a popup pick: insert the ref at the cursor and close the popup */
  const onInsert = (item: VarItem) => {
    propsRef.current?.command(item);
    setPopup(null);
  };

  return {
    extension,
    popup,
    items: propsRef.current?.items ?? [],
    query: propsRef.current?.query ?? "",
    highlight,
    onInsert,
    onHover: setHighlight,
  };
}
