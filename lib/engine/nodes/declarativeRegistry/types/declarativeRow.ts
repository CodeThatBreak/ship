import "server-only";

/** A declarative `node_templates` row as the registry hydrates it. */
export interface DeclarativeRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  config: unknown;
}
