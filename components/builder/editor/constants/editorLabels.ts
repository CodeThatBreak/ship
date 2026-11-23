import { KIND_LABELS } from "@/components/templateEditor/draft";
import type { LayoutSync } from "@/components/templateEditor/hooks/useNodePositions";
import { EDITOR_NODE_KIND } from "./editorGraph";

/** Node-type badge copy — the palette's proper labels, not the raw kind key. */
export const NODE_TYPE_LABELS: Record<string, string> = {
  ...KIND_LABELS,
  [EDITOR_NODE_KIND.BUILTIN]: "Built-in",
};

/** Header status line per layout-sync state. `idle` is omitted so it renders
 *  nothing; this lookup replaces the nested status ternary (§2.7). */
export const LAYOUT_SYNC_MESSAGE: Partial<
  Record<LayoutSync, { text: string; className?: string }>
> = {
  pending: { text: "saving layout…" },
  saved: { text: "layout autosaved" },
  error: { text: "layout save failed", className: "text-destructive" },
};
