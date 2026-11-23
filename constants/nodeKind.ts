/** Authorable declarative node kinds (TemplateStore KINDED_NODE_TEMPLATE_KINDS). */
export const NODE_KIND = {
  AGENT: "agent",
  DECISION: "decision",
  HTTP: "http",
  SCRIPT: "script",
} as const;

export type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

export const NODE_KIND_VALUES: NodeKind[] = [
  NODE_KIND.AGENT,
  NODE_KIND.DECISION,
  NODE_KIND.HTTP,
  NODE_KIND.SCRIPT,
];

/** Built-in node_templates row keys (catalog_key / key column). */
export const CATALOG_KEY = {
  START: "start",
  PLAN: "plan",
} as const;

/** Built-in node_templates row ids. */
export const BUILTIN_TEMPLATE_ID = {
  START: "nt_start",
  PLAN: "nt_plan",
} as const;

export const isNodeKind = (value: string): value is NodeKind =>
  (NODE_KIND_VALUES as readonly string[]).includes(value);
