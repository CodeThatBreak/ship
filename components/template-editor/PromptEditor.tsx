"use client";
/**
 * The agent prompt's rich text editor (§8) — Tiptap, the editor shadcn
 * recommends. Plain-text documents only (no formatting marks to surprise the
 * runtime interpolation), with two affordances on top:
 *
 *   • typing "@" opens the variable popover — the connected upstream nodes'
 *     published outputs, filtered as you type; picking one inserts its raw
 *     `{{nodes.<key>.output.<field>}}` ref at the cursor;
 *   • existing `{{...}}` refs anywhere in the text are highlighted inline, so
 *     the prompt's variables stay visible while editing.
 *
 * The stored value stays the plain prompt string — the editor round-trips it
 * (paragraphs ⇄ newlines), so nothing in the runtime or the save format
 * changes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Extension as CoreExtension } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "../../lib/utils";

export interface PromptVariable {
  /** friendly label — "Review · comment_count" */
  label: string;
  /** the raw ref inserted into the prompt — {{nodes.review.output.comment_count}} */
  insert: string;
}

type VarItem = PromptVariable;

/** The prompt text → an HTML doc (paragraph per line) for the editor seed. */
function textToHtml(text: string): string {
  const escape = (l: string) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (text ?? "").split("\n").map((l) => `<p>${escape(l)}</p>`).join("");
}

/** Inline decorations for the `{{...}}` refs already in the text. */
const refHighlightPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        for (const m of node.text.matchAll(/\{\{[^{}]+\}\}/g)) {
          const start = pos + (m.index ?? 0);
          decos.push(Decoration.inline(start, start + m[0].length, { class: "prompt-var" }));
        }
      });
      return DecorationSet.create(state.doc, decos);
    },
  },
});

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
              .insertContentAt(range, [{ type: "text", text: `${item.insert} ` }])
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
        refHighlightPlugin,
      ];
    },
  });
}

export function PromptEditor({
  value,
  variables,
  onChange,
  className,
}: {
  value: string;
  variables: PromptVariable[];
  onChange: (text: string) => void;
  className?: string;
}) {
  // the variable list rides a ref — rewiring edges updates the popover
  // without re-creating the editor
  const varsRef = useRef(variables);
  varsRef.current = variables;

  const propsRef = useRef<SuggestionProps<VarItem> | null>(null);
  const popupOpenRef = useRef(false);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggest = useMemo(
    () =>
      variableSuggest({
        items: (query) =>
          varsRef.current.filter((v) => v.label.toLowerCase().includes(query.toLowerCase())),
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
    [],
  );

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
      suggest,
    ],
    content: textToHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[120px] max-h-[320px] overflow-y-auto w-full rounded-lg border border-border bg-card px-3 py-2",
          "text-[12.5px] leading-relaxed outline-none focus:border-blue-500/60",
          className,
        ),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getText({ blockSeparator: "\n" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

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
          className="fixed z-[60] w-72 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
          style={{ top: popup.top + 4, left: popup.left }}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Variables {query && <span className="normal-case tracking-normal">· “{query}”</span>}
          </div>
          {items.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching variable</div>
          )}
          {items.map((v, i) => (
            <button
              key={v.insert}
              onMouseDown={(e) => {
                e.preventDefault();
                propsRef.current?.command(v);
                setPopup(null);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
              )}
            >
              <span className="truncate">{v.label}</span>
              <span className="flex-1" />
              <code className="font-mono text-[9.5px] text-muted-foreground truncate max-w-[150px]">{v.insert}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
