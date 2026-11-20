/** A declarative `node_templates` row as the declarative node tiers consume it. */
export type DeclarativeTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
};
