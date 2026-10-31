"use client";
import { useEffect, useRef } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import type { Extension as CoreExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cn } from "@/lib/utils";
import { refColorClass } from "../variables";

const textToHtml = (text: string): string => {
  const escape = (l: string) =>
    l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (text ?? "").split("\n").map((l) => `<p>${escape(l)}</p>`).join("");
};

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

export const usePromptEditor = ({
  value,
  onChange,
  className,
  invalidRefs,
  suggestionExtension,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  invalidRefs?: Record<string, string>;
  suggestionExtension: CoreExtension;
}): Editor | null => {
  const invalidRef = useRef(invalidRefs);
  invalidRef.current = invalidRefs;
  const lastEmitted = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
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
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText({ blockSeparator: "\n" });
      lastEmitted.current = text;
      onChange(text);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== lastEmitted.current) {
      editor.commands.setContent(textToHtml(value));
      lastEmitted.current = value;
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.view.state.tr);
    }
  }, [invalidRefs, editor]);

  return editor;
};
