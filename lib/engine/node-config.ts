import { db } from "../db";

/** Descriptor for one config knob — drives the auto-generated form (Phase 2). */
export interface ConfigField {
  key: string;
  label: string;
  /**
   * Renderers: the five basics are the generic form rows; the declarative
   * kinds add their own — `ts_output` is the TS-lite schema box (agent node),
   * `choices` is the decision branch editor.
   */
  type: "boolean" | "number" | "string" | "text" | "select" | "ts_output" | "choices" | "map";
  /** help text shown under the field */
  help?: string;
  /** for select fields — a description renders as gray text under the label
   *  in the dropdown item (rich variant: no "(default)" option — the
   *  effective value always resolves to one of the options) */
  options?: { value: string; label: string; description?: string }[];
  /** string fields: clearing the input writes an explicit `null` override
   *  ("cleared") instead of dropping it to the catalog default — the runtime
   *  schema must accept null for the field (e.g. the agent model override) */
  nullable?: boolean;
  /** for select fields: a lucide icon name per option value (icon variant —
   *  no empty "(default)" option; the form renders icons next to the labels) */
  optionIcons?: Record<string, string>;
}

/**
 * The app-settings layer: `settings["node_config.<defKey>"]` wins, then legacy
 * aliases that must keep working after the settings mechanism folds into this
 * layer (`prompt_templates` = the prompt-body knob's storage; `resolve.delay_ms`
 * and `RESOLVE_DELAY_MINUTES` = the resolve quiet-period knob).
 *
 * Values set by the user on the settings page keep working unchanged; template
 * and per-flow configs sit above this layer in the merge order.
 */
export function appLayerConfig(defKey: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stored = db.getSetting<Record<string, unknown> | null>(`node_config.${defKey}`, null);
  if (stored && typeof stored === "object") Object.assign(out, stored);

  // legacy alias: prompt body knobs still read the prompt_templates overlay
  const promptTemplates = db.getSetting<Record<string, { userTemplate?: string } | undefined>>(`prompt_templates`, {});
  if (defKey === "pipeline") {
    // the pipeline node's fix-run body lives under its own template key
    if (promptTemplates["pipeline_fix"]?.userTemplate) out.fix_prompt_body = promptTemplates["pipeline_fix"]!.userTemplate;
  }
  if (promptTemplates[defKey]?.userTemplate) out.prompt_body = promptTemplates[defKey]!.userTemplate;

  // legacy alias: resolve quiet minutes (settings value is milliseconds)
  if (defKey === "resolve") {
    const storedMs = db.getSetting<number | null>("resolve.delay_ms", null);
    if (typeof storedMs === "number" && Number.isFinite(storedMs) && storedMs >= 0) {
      out.quiet_minutes = storedMs / 60_000;
    }
    const envRaw = (process.env.RESOLVE_DELAY_MINUTES ?? "").trim();
    if (typeof storedMs !== "number" && envRaw) {
      const env = Number(envRaw);
      if (Number.isFinite(env) && env >= 0) out.quiet_minutes = env;
    }
  }
  return out;
}

/** Merge config layers shallowly-per-key (later layers win; objects merge one level deep). */
export function mergeConfigLayers(...layers: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      const prev = out[k];
      out[k] =
        v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v;
    }
  }
  return out;
}

/**
 * Bake the effective config snapshot for a new flow node:
 *   class defaults ← app settings ← template node config
 * (the per-flow instance layer overrides at read time).
 */
export function bakeNodeConfig(
  defKey: string,
  defDefaults: Record<string, unknown>,
  templateConfig: unknown,
): string {
  const merged = mergeConfigLayers(
    defDefaults,
    appLayerConfig(defKey),
    normalize(templateConfig)
  );
  return JSON.stringify(merged);
}

function normalize(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Parse a stored config snapshot (nodes.config) defensively. */
export function parseConfigSnapshot(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return normalize(parsed) ?? {};
  } catch {
    return {};
  }
}

/** Typed read helpers used by nodes. */
export function configNumber(cfg: Record<string, unknown>, key: string, fallback: number): number {
  const v = cfg[key];
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return fallback;
}

export function configBool(cfg: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = cfg[key];
  if (typeof v === "boolean") return v;
  return fallback;
}

export function configString(cfg: Record<string, unknown>, key: string): string | undefined {
  const v = cfg[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}
