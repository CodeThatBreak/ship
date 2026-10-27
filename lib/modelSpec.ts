import { FAST_OFF, FAST_ON, FAST_PARAM } from "../constants/models";

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

/**
 * Normalize a model spec. The SDK passes ModelSelection params verbatim, and
 * an unstated `fast` parameter falls through to the account's default variant
 * — fast=true for composer models. `fast[]` values are therefore NOT noise:
 * `composer-2.5[fast=false]` is the meaningful default-off pick and is KEPT
 * (dropping it re-enabled fast), and `[fast=true]` is an explicit opt-in.
 * Only unusable fast values are stripped (`composer-2.5[fast]` — a valueless
 * param the SDK can't resolve — or an unknown value); every other param is
 * kept verbatim (`composer-2.5[effort=high]` stays).
 */
export function normalizeModelSpec(raw: string): string {
  const parsed = parseModelSpec(raw);
  if (!parsed) return raw;
  const usable = (p: ModelParamValue): boolean =>
    !(p.id === FAST_PARAM && p.value !== FAST_ON && p.value !== FAST_OFF);
  return composeModelSpec(parsed.id, (parsed.params ?? []).filter(usable));
}
