import type { NodeTemplateKind } from "@/components/template-editor";

/**
 * The templates feature's client-side row shapes (aligned with the thin
 * /api/templates and /api/node-templates GET payloads). lib/db's row types
 * stay server-side — client code imports from here.
 */

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  is_builtin: number;
  /** flow trigger: { type: manual | webhook | schedule, ... } — null allowed
   *  by the schema (rowmapper), treated as "manual" everywhere below */
  trigger: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  nodeCount: number;
};

export type NodeRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  version: number;
  description: string | null;
  icon: string | null;
  is_builtin: boolean;
  config: Record<string, unknown>;
  template_id: string | null;
  is_local: boolean;
  updated_at: string;
};

/** The create/edit node form state (identity + the kind's whole definition). */
export type NodeFormState = {
  name: string;
  description: string;
  kind: NodeTemplateKind;
  /** the kind's full definition — edited field-by-field through
   *  DeclarativeConfigFields (same machinery as the builder drawer) */
  config: Record<string, unknown>;
};
