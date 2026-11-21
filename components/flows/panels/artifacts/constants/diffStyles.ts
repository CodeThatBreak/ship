import type { ReactDiffViewerStylesOverride } from "react-diff-viewer-continued";

/** Dark-theme diff viewer overrides — the diff's whole visual style in one place. */
export const DIFF_VIEW_STYLES = {
  variables: {
    dark: {
      diffViewerBackground: "#0d1118",
      diffViewerColor: "#9aa7b8",
      addedBackground: "rgba(63,182,139,0.1)",
      addedColor: "#6ee7b7",
      removedBackground: "rgba(239,91,107,0.1)",
      removedColor: "#fda4af",
      wordAddedBackground: "rgba(63,182,139,0.25)",
      wordRemovedBackground: "rgba(239,91,107,0.25)",
      addedGutterBackground: "rgba(63,182,139,0.15)",
      removedGutterBackground: "rgba(239,91,107,0.15)",
      gutterBackground: "#0d1118",
      gutterBackgroundDark: "#0a0d13",
      highlightBackground: "rgba(91,141,239,0.12)",
      highlightGutterBackground: "rgba(91,141,239,0.15)",
      codeFoldGutterBackground: "#111722",
      codeFoldBackground: "#111722",
      emptyLineBackground: "#0d1118",
      gutterColor: "#64748b",
      addedGutterColor: "#3fb68b",
      removedGutterColor: "#ef5b6b",
      codeFoldContentColor: "#64748b",
      diffViewerTitleBackground: "#151d2a",
      diffViewerTitleColor: "#9aa7b8",
      diffViewerTitleBorderColor: "#1f2a3a",
    },
  },
  line: {
    fontSize: "12px",
    lineHeight: "1.5",
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
  },
} as const satisfies ReactDiffViewerStylesOverride;
