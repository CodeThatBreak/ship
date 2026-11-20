import "server-only";

/**
 * Shared shapes for the template-lint rule modules (`lintTemplate` and the
 * `lint*.ts` rules it orchestrates). Types only — every rule module stays
 * pure data in / problems out, no runtime class instantiation (keeps the
 * store import-cycle free).
 */

/** The task universe passed in by the store (registry-resolved, Phase 3). */
export interface TaskUniverse {
  /** the template's declared task type (trigger.taskType) */
  kind: string;
  /** the provider's contextFields — the {{task.*}} vocabulary */
  fields: { key: string; label: string }[];
}

/** A template node instance under lint. */
export interface LintNode {
  key: string;
  nodeTemplateId: string;
  inputMap: Record<string, unknown>;
  config: Record<string, unknown>;
  /** raw trigger from the template instance (YAML/import or editor draft) */
  trigger?: unknown;
}

/** A template edge instance under lint. */
export interface LintEdge {
  from: string;
  to: string;
  condition: string | null;
  label: string | null;
  kind: string;
}

/** A node-template catalog entry behind a linted node (nodeTemplateId → entry). */
export interface CatalogEntry {
  kind: string;
  config: unknown;
  key: string;
  isBuiltin: boolean;
}

/** The output contract (addressable `{{nodes.<key>.output.<field>}}` fields) one node publishes. */
export interface NodeContract {
  fields: string[] | null;
  kind: string;
}

/** The static `{{nodes.<key>.output.<field>}}` address check shared by ref and condition rules. */
export type AddressesOutput = (expr: string, onUnknown: (field: string) => void) => boolean;
