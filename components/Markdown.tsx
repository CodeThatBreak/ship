"use client";
import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Mermaid from "./Mermaid";

/** Markdown renderer backed by react-markdown + GFM (tables, strikethrough, task lists). */
export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        // intercept ```mermaid fenced blocks and render them as diagrams
        pre: ({ children }) => {
          const code = Children.toArray(children)[0];
          if (isValidElement(code) && (code.props as any).className === "language-mermaid") {
            return <Mermaid code={String((code.props as any).children ?? "").trim()} />;
          }
          return <pre>{children}</pre>;
        },
      }}
    >
      {text ?? ""}
    </ReactMarkdown>
  );
}
