import { fetchJson } from "@/hooks/fetch-json";
import { schemaRows } from "../variables";
import type { Repo } from "../../settings";

/** The saved template's start-node row (same catalog id the editor looks
 *  for); its instance config carries the start contract. */
const START_NODE_TEMPLATE_ID = "nt_start";

/** One start-contract field — the sample body's input params. */
export type ContractField = {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
};

/** The template's flow-trigger hook (GET /api/templates response slice). */
export type HookInfo = { id: string; secret: string; filter: string | null };

type TemplateDetailPayload = {
  hook?: HookInfo | null;
  nodes?: {
    node_template_id: string;
    config: Record<string, unknown> | null;
  }[];
};

async function fetchContractFields(
  config: Record<string, unknown> | null,
): Promise<ContractField[]> {
  const p = new URLSearchParams();
  p.set("def", START_NODE_TEMPLATE_ID);
  if (config && Object.keys(config).length) p.set("config", JSON.stringify(config));
  const contract = await fetchJson<{ output?: unknown }>(`/api/contracts?${p.toString()}`);
  return schemaRows(contract.output).map((r) => ({
    key: r.name,
    label: r.description,
    type: r.type,
    required: r.required,
  }));
}

/** The dialog's context: the input fields + the provisioned hook (null until
 *  the template is saved with its side effects — the curl needs it). */
export async function fetchWebhookContext(
  templateId: string,
): Promise<{ fields: ContractField[]; hook: HookInfo | null }> {
  const detail = await fetchJson<TemplateDetailPayload>(`/api/templates/${templateId}`);
  const start = detail.nodes?.find((n) => n.node_template_id === START_NODE_TEMPLATE_ID);
  const fields = start ? await fetchContractFields(start.config ?? null) : [];
  return { fields, hook: detail.hook ?? null };
}

/** A placeholder value matching the declared field type (the sender replaces
 *  whatever applies). */
export const sampleValue = (field: ContractField): unknown => {
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "object":
      return {};
    case "array":
      return [];
    default:
      return `<${field.key}>`;
  }
};

/** The friendly repo label (the "(local)" suffix marks the local checkout). */
export const repoLabel = (r: Repo) => `${r.name}${r.local_path ? " (local)" : ""}`;

/** Shell-quote a string for the curl's `-d '…'` (embedds safely even when the
 *  body carries apostrophes). */
export const shellSingleQuoted = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
