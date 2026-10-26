"use client";
/**
 * The prompt editor's Tiptap instance (§8 data layer): the plain-text doc
 * (paragraph per line) plus two extensions — the caller's variable-suggestion
 * extension and the inline `{{...}}` ref highlighter. The linter's invalid
 * refs ride a ref: a validation response lands without recreating the editor.
 */
import { useEffect, useRef } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import type { Extension as CoreExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "../../../lib/utils";
import { refColorClass } from "../variables";

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

export function usePromptEditor({
  value,
  onChange,
  className,
  invalidRefs,
  suggestionExtension,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  /** ref (inner text) → the linter's problem — underlined inline */
  invalidRefs?: Record<string, string>;
  /** the "@" variable suggestion (useVariablePopup's extension) */
  suggestionExtension: CoreExtension;
}): Editor | null {
  // so do the linter's invalid refs — decorations recompute per transaction
  const invalidRef = useRef(invalidRefs);
  invalidRef.current = invalidRefs;

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
      suggestionExtension,
      refHighlightFactory(invalidRef),
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
  });

  // a validation response lands without a transaction — nudge the view so the
  // decorations (colors / invalid underlines) recompute (no doc change → the
  // onChange persist loop can't trigger)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.view.state.tr);
    }
  }, [invalidRefs, editor]);

  return editor;
}
