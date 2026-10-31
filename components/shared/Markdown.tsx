"use client";

import * as React from "react";
import { Streamdown, defaultComponents } from "streamdown";
import { createMermaidPlugin, type MermaidConfig } from "@streamdown/mermaid";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";
import { markdownRehypePlugins } from "./markdownRehypePlugins";

/**
 * Markdown renderer per the shadcn AI-elements "Markdown" pattern:
 * Streamdown for prose, fenced code routed to the shadcn/ui Code Block
 * (line numbers + copy button). Mermaid fences keep Streamdown's chart
 * renderer via the mermaid plugin.
 *
 * The mermaid plugin is a module-level singleton — mermaid initializes once.
 */

// dark-only app: both sides of the shiki theme pair must be a dark theme
const shikiTheme = ["github-dark", "github-dark"] as const;

// theme variables mirror the old `components/Mermaid.tsx` app theme
const mermaidPlugin = createMermaidPlugin({
  config: {
    startOnLoad: false,
    securityLevel: "strict", // sanitize labels; content comes from the agent
    theme: "base",
    themeVariables: {
      background: "transparent",
      primaryColor: "#1f2937",
      primaryBorderColor: "#4b5563",
      primaryTextColor: "#f9fafb",
      secondaryColor: "#111827",
      tertiaryColor: "#030712",
      lineColor: "#6b7280",
      textColor: "#e5e7eb",
      edgeLabelBackground: "#111827",
      clusterBkg: "#111827",
      clusterBorder: "#374151",
      fontFamily:
        'Inter, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
      fontSize: "13px",
    },
  } satisfies MermaidConfig,
});

function markdownPlainText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  return React.Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? `${child}`
        : ""
    )
    .join("");
}

type MarkdownCodeProps = React.ComponentPropsWithoutRef<"code"> & {
  node?: unknown;
};

/** Fenced code → shadcn Code Block; inline code → inline chip. */
function MarkdownCode(props: MarkdownCodeProps) {
  const { node, className, children, ...rest } = props;
  const isFence = "data-block" in rest;
  const code = markdownPlainText(children);
  const language =
    /language-([\w-]+)/.exec(className ?? "")?.[1]?.toLowerCase() ?? "";

  // Load highlighting for the fence's language (plain lines until loaded).
  const lines = useHighlightedCode(isFence ? code : "", isFence ? language : "");

  if (!isFence) {
    return (
      <code
        className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-[92%]"
        {...rest}
      >
        {children}
      </code>
    );
  }

  if (language === "mermaid") {
    // delegate to Streamdown's built-in diagram renderer (needs the plugin ctx)
    const Code = defaultComponents.code as unknown as React.FC<
      Record<string, unknown> & { children?: React.ReactNode }
    >;
    return (
      <Code node={node as never} className={className} data-block="true">
        {children}
      </Code>
    );
  }

  const highlighted = lines?.some(
    (line) => typeof line !== "string"
  );

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        lineNumbers
        className="max-h-96 min-h-0"
      >
        {highlighted
          ? lines?.map((line, index) => (
              <CodeBlockLine key={index}>{line}</CodeBlockLine>
            ))
          : code}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const markdownProps = { components: { code: MarkdownCode } } as const;

export type MarkdownProps = React.ComponentProps<"div"> & {
  children: string;
};

export const Markdown = React.memo(({ children, className, ...props }: MarkdownProps) => (
  <div className={cn("text-sm leading-relaxed", className)} {...props}>
    <Streamdown
      shikiTheme={shikiTheme as never}
      plugins={{ mermaid: mermaidPlugin }}
      rehypePlugins={markdownRehypePlugins}
      components={markdownProps.components}
      mode="static"
    >
      {children}
    </Streamdown>
  </div>
));

Markdown.displayName = "Markdown";
