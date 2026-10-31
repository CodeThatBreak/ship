import { FAST_OFF, FAST_ON, FAST_PARAM } from "@/constants/models";
import type { CatalogModel } from "@/types/modelSpec";

/**
 * Model-parameter derivation and provider grouping (§2.2 step 3): pure
 * helpers extracted from the selector container. Static parameter
 * definitions are used as-is; models that only expose variants get their
 * parameters derived by diffing the variant param combos.
 */

/** One selectable model parameter (the Options menu's row definition). */
export type ModelParameterDefinition = {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
};

// ── provider grouping (the catalog has no provider field; infer from the id) ─

const PROVIDER_RULES: [RegExp, string][] = [
  [/^claude/, "Anthropic"],
  [/^(gpt|o\d)/, "OpenAI"],
  [/^(gemini|gemma|palm)/, "Google"],
  [/^(composer|auto|max)/, "Cursor"],
  [/^grok/, "xAI"],
  [/^llama/, "Meta"],
  [/^mistral/, "Mistral"],
  [/^(deepseek|qwen)/, "DeepSeek"],
];

export function providerOf(modelId: string): string {
  for (const [re, name] of PROVIDER_RULES) if (re.test(modelId.toLowerCase())) return name;
  const prefix = modelId.split(/[-_.]/)[0];
  return prefix ? prefix[0].toUpperCase() + prefix.slice(1) : "Other";
}

export function paramsOf(model: CatalogModel): ModelParameterDefinition[] {
  if (model.parameters?.length) return model.parameters;
  const combos = model.variants ?? [];
  if (combos.length < 2) return [];
  const defs = new Map<string, Set<string>>();
  for (const v of combos) {
    for (const p of v.params) {
      const values = defs.get(p.id) ?? new Set<string>();
      values.add(p.value);
      defs.set(p.id, values);
    }
  }
  return [...defs.entries()].map(([id, values]) => ({
    id,
    values: [...values].map((value) => ({ value })),
  }));
}

export function defaultParamsOf(model?: CatalogModel): Record<string, string> {
  // seed from the default variant so the options menu shows sane values —
  // except fast mode: the account default variant is fast=true on composer
  // models, but DevFlow runs non-fast by default (the run service pins
  // fast=false the same way), so the switch reflects the effective default
  const v = model?.variants?.find((x) => x.isDefault);
  const out: Record<string, string> = {};
  if (v) for (const p of v.params) out[p.id] = p.value;
  if (out[FAST_PARAM] === FAST_ON) out[FAST_PARAM] = FAST_OFF;
  return out;
}

export function prettyParamValue(def: ModelParameterDefinition, value: string): string {
  return def.values.find((v) => v.value === value)?.displayName ?? value;
}

/** Boolean params (values are exactly true/false) render as a Switch. */
export function isBoolParam(def: ModelParameterDefinition): boolean {
  const vs = def.values.map((v) => v.value).sort();
  return vs.length === 2 && vs[0] === "false" && vs[1] === "true";
}
