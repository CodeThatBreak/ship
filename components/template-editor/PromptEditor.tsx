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
 * changes.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Extension as CoreExtension } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "../../lib/utils";
import { filterVarGroups, refColorClass, varGroupAccent, type VarField, type VarGroup } from "./variables";

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

/** The prompt text → an HTML doc (paragraph per line) for the editor seed. */
function textToHtml(text: string): string {
  const escape = (l: string) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (text ?? "").split("\n").map((l) => `<p>${escape(l)}</p>`).join("");
}

/**
 * Inline decorations for the `{{...}}` refs already in the text: the root
 * color coding, plus a wavy underline (and a tooltip) on refs the live
 * linter reports. The invalid map rides a ref — a validation response lands
 * without recreating the editor.
 */
function refHighlightFactory(
  invalid: { current: Record<string, string> | undefined },
): CoreExtension {
  return Extension.create({
    name: "refHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                for (const m of node.text.matchAll(/\{\{([^{}]+)\}\}/g)) {
                  const start = pos + (m.index ?? 0);
                  const ref = m[1].trim();
                  const classes = ["prompt-var", refColorClass(ref)];
                  const problem = invalid.current?.[ref];
                  if (problem) classes.push("prompt-var-invalid");
                  decos.push(
                    Decoration.inline(start, start + m[0].length, {
                      class: classes.join(" "),
                      ...(problem ? { title: problem } : {}),
                    }),
                  );
                }
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
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
  // the variable list rides a ref — rewiring edges updates the popover
  // without re-creating the editor
  const varsRef = useRef(groups);
  varsRef.current = groups;
  // so do the linter's invalid refs — decorations recompute per transaction
  const invalidRef = useRef(invalidRefs);
  invalidRef.current = invalidRefs;

  const propsRef = useRef<SuggestionProps<VarItem> | null>(null);
  const popupOpenRef = useRef(false);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const extensions = useMemo(() => {
    const suggest = variableSuggest({
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
    });
    return [suggest, refHighlightFactory(invalidRef)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // plain-text doc — the prompt is a string with {{...}} refs
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        link: false,
        blockquote: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      ...extensions,
    ],
    content: textToHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[120px] max-h-[320px] overflow-y-auto w-full rounded-lg border border-border bg-card px-3 py-2",
          "text-[12.5px] leading-relaxed outline-none focus:border-info/60",
          className,
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getText({ blockSeparator: "\n" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // a validation response lands without a transaction — nudge the view so the
  // decorations (colors / invalid underlines) recompute (no doc change → the
  // onChange persist loop can't trigger)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.view.state.tr);
    }
  }, [invalidRefs, editor]);

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
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        props!.command(items[Math.min(highlight, items.length - 1)]);
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

  const items = propsRef.current?.items ?? [];
  const query = propsRef.current?.query ?? "";

  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {popup && (
        <div
          className="fixed z-[60] w-80 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{ top: popup.top + 4, left: popup.left }}
        >
          {query && (
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Variables <span className="normal-case tracking-normal">· &ldquo;{query}&rdquo;</span>
            </div>
          )}
          {items.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching variable</div>
          )}
          {items.map((item, i) => {
            // a header per group, rendered only where the group has fields —
            // the flat filtered list keeps headers attached to their rows
            const header = i === 0 || items[i - 1].group !== item.group;
            return (
              <Fragment key={`${item.group.id}:${item.field.insert}:${i}`}>
                {header && (
                  <div
                    className={cn(
                      "flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5",
                      i === 0 && "pt-1",
                    )}
                  >
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.group.title}
                    </span>
                    {item.group.origin && (
                      <span className="text-[9.5px] text-muted-foreground/70 truncate">
                        {item.group.origin}
                      </span>
                    )}
                  </div>
                )}
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    propsRef.current?.command(item);
                    setPopup(null);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                    i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                  )}
                >
                  <span className="truncate">{item.field.name}</span>
                  {item.field.type && (
                    <span className="shrink-0 text-[9.5px] text-muted-foreground/70">{item.field.type}</span>
                  )}
                  <span className="flex-1" />
                  <code
                    className={cn(
                      "font-mono text-[9.5px] truncate max-w-[150px]",
                      varGroupAccent(item.group.id),
                    )}
                  >
                    {item.field.insert}
                  </code>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
