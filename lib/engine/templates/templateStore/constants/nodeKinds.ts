export const KINDED_NODE_TEMPLATE_KINDS = ["agent", "http", "script", "decision"] as const;

export type DeclarativeNodeKind = (typeof KINDED_NODE_TEMPLATE_KINDS)[number];

export const NODE_KIND_LABELS: Record<DeclarativeNodeKind, string> = {
  agent: "Agent node",
  decision: "Decision node",
  http: "HTTP node",
  script: "Script node",
};
