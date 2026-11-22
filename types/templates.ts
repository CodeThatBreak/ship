import type { NodeTemplateKind } from "@/components/templateEditor/boilerplate";

/**
 * Client-safe template gallery / node-catalog row shapes (aligned with
 * GET /api/templates and GET /api/node-templates). Server row mappers live
 * in lib/db/rows — UI and loaders import from here.
 */

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  isBuiltin: number;
  /** flow trigger: { type: manual | webhook | schedule, ... } */
  trigger: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
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
  isBuiltin: boolean;
  config: Record<string, unknown>;
  templateId: string | null;
  isLocal: boolean;
  updatedAt: string;
};

/** The create/edit node form state (identity + the kind's whole definition). */
export type NodeFormState = {
  name: string;
  description: string;
  kind: NodeTemplateKind;
  config: Record<string, unknown>;
};
