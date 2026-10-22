/**
 * Model spec strings: "<model-id>" or "<model-id>[param=value,param=value]".
 * The ID carries variation parameters (fast mode, effort/thinking level, …)
 * from the Cursor catalog; both runtimes parse them into the SDK's
 * ModelSelection { id, params }.
 */
export type ModelParamValue = { id: string; value: string };
export type ModelSelection = { id: string; params?: ModelParamValue[] };

export function parseModelSpec(raw: string | undefined | null): ModelSelection | undefined {
  const spec = raw?.trim();
  if (!spec) return undefined;
  const m = spec.match(/^([^[]+?)\s*(?:\[(.*)\])?$/);
  const base = (m?.[1] ?? spec).trim();
  const params = (m?.[2] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((kv) => {
      const eq = kv.indexOf("=");
      if (eq < 0) return { id: kv.trim(), value: "" };
      return { id: kv.slice(0, eq).trim(), value: kv.slice(eq + 1).trim() };
    })
    .filter((p) => p.id);
  return { id: base, ...(params.length ? { params } : {}) };
}

/** A model pick as structured data: model id + chosen parameter values. */
export type ModelChoice = { id: string; params?: Record<string, string> };

/** Catalog row (mirrors @cursor/sdk ModelListItem, normalized). */
export type CatalogModel = {
  id: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  parameters?: Array<{
    id: string;
    displayName?: string;
    values: Array<{ value: string; displayName?: string }>;
  }>;
  variants?: {
    params: ModelParamValue[];
    displayName: string;
    description?: string;
    isDefault?: boolean;
  }[];
};

/** The wire format the engine carries: "<id>" or "<id>[param=value,…]". */
export function composeModelChoice(choice: ModelChoice | null | undefined): string {
  if (!choice?.id) return "";
  const body = Object.entries(choice.params ?? {})
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return body ? `${choice.id}[${body}]` : choice.id;
}

export function composeModelSpec(id: string, params?: ModelParamValue[]): string {
  const body = (params ?? []).filter((p) => p.id).map((p) => `${p.id}=${p.value}`).join(",");
  return body ? `${id}[${body}]` : id;
}
