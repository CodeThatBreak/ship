import "server-only";

/** The declarative node kinds (the `node_templates` rows the engine hydrates). */
export const DECLARATIVE_KINDS = ["agent", "decision", "http", "script"] as const;
export type DeclarativeKind = (typeof DECLARATIVE_KINDS)[number];
