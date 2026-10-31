import { Bot, FileCode2, GitBranch, Globe, type LucideIcon } from "lucide-react";
import type { NodeTemplateKind } from "@/components/templateEditor/boilerplate";
import type { NodeRow } from "./types";

/** The declarative kinds a Template Node can have, in display order. */
export const NODE_KINDS: { kind: NodeTemplateKind; title: string }[] = [
  { kind: "agent", title: "Agent" },
  { kind: "decision", title: "Decision" },
  { kind: "http", title: "HTTP" },
  { kind: "script", title: "Script" },
];

export const isNodeKind = (k: string): k is NodeTemplateKind =>
  NODE_KINDS.some((n) => n.kind === k);

export const KIND_ICONS: Record<NodeTemplateKind, LucideIcon> = {
  agent: Bot,
  decision: GitBranch,
  http: Globe,
  script: FileCode2,
};

/** A kind's scope badge: built-ins are code, library rows are shared,
 *  template-local rows belong to one template's builder. */
export type NodeScope = "built-in" | "library" | "template-local";

export function scopeOf(n: Pick<NodeRow, "is_builtin" | "is_local">): NodeScope {
  if (n.is_builtin) return "built-in";
  return n.is_local ? "template-local" : "library";
}

/** "3 nodes" / "1 node" — shared by the gallery's Nodes column. */
export const nodeCountLabel = (n: number): string => `${n} node${n === 1 ? "" : "s"}`;
