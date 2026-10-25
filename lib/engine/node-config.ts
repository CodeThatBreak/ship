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

// ── plan fan-out (step sub-flows, Phase 1) ────────────────────────────────────
// The fan-out knob on any node instance downstream of a plan node:
//   fanout: { mode: "whole"|"steps"|"from-plan", child: <template id>|null, parallel_max: 1 }
//
// Representation note: the auto-form (`ConfigField`s) and the knob layering
// are flat-per-key, so the knob lives as flat keys (`fanout_mode`,
// `fanout_child`, `fanout_parallel_max`) in every config layer. A nested
// `fanout: {…}` object is honored when one was authored directly (template
// editor / YAML import) — `fanoutOf` reads both. Absent/blank ⇒ `whole`,
// today's byte-for-byte behavior.

export const FANOUT_MODES = ["whole", "steps", "from-plan"] as const;
export type FanoutMode = (typeof FANOUT_MODES)[number];

export interface FanoutKnob {
  mode: FanoutMode;
  /** explicit child flow-template id; null = auto-select (builtin step template / auto-wrap) */
  child: string | null;
  parallelMax: number;
}

/** The zero-behavior default — every node fans out "whole" unless configured. */
export const DEFAULT_FANOUT: FanoutKnob = { mode: "whole", child: null, parallelMax: 1 };

/** Read the effective fan-out knob from a merged config (nested object or flat keys). */
export function fanoutOf(cfg: Record<string, unknown> | null | undefined): FanoutKnob {
  if (!cfg) return DEFAULT_FANOUT;
  const nested = cfg.fanout;
  let mode: string | undefined;
  let child: unknown;
  let parallelMax: unknown;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    mode = (nested as Record<string, unknown>).mode as string | undefined;
    child = (nested as Record<string, unknown>).child;
    parallelMax = (nested as Record<string, unknown>).parallel_max;
  }
  if (mode === undefined) mode = typeof cfg.fanout_mode === "string" ? cfg.fanout_mode : undefined;
  if (child === undefined) child = cfg.fanout_child;
  if (parallelMax === undefined) parallelMax = cfg.fanout_parallel_max;
  const resolvedMode = (FANOUT_MODES as readonly string[]).includes(String(mode)) ? (mode as FanoutMode) : "whole";
  return {
    mode: resolvedMode,
    child: typeof child === "string" && child.trim() ? child.trim() : null,
    parallelMax: typeof parallelMax === "number" && Number.isFinite(parallelMax) && parallelMax >= 1
      ? Math.floor(parallelMax)
      : 1,
  };
}

/** The `node-instance` knobs stripped from a config copy that becomes a child's own config (lint rule 3: no nesting). */
export function stripFanoutKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "fanout" || k.startsWith("fanout_")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The shared fan-out `ConfigField`s (the auto-form's Fanout section) — spread
 * into plan-downstream-capable defs' `configFields`. `fanout_child` is a free
 * string field in Phase 1 (explicit template id; empty = auto-select) — the
 * gallery picker for both built-in and custom parents lands in Phase 3C.
 */
export const fanoutConfigFields: readonly ConfigField[] = [
  {
    key: "fanout_mode",
    label: "Fan-out mode",
    type: "select",
    help:
      "step sub-flows: run this node once per pending plan step as monitorable child flows. "
      + "whole = single run (today); steps = one child per step; from-plan = the plan's published execution decides.",
    options: [
      { value: "whole", label: "whole", description: "One run for the whole plan (default)" },
      { value: "steps", label: "steps", description: "One child flow per plan step" },
      { value: "from-plan", label: "from-plan", description: "The plan node's execution resolution decides" },
    ],
  },
  {
    key: "fanout_child",
    label: "Child template",
    type: "select",
    help: "Flow template each step child runs (gallery picker; hidden auto-wrapped child templates excluded, save-time lint applies to every pick). Empty: the built-in step build for build nodes; every other node auto-wraps itself as a hidden child template.",
  },
  {
    key: "fanout_parallel_max",
    label: "Parallel max",
    type: "number",
    help: "How many step children may run at once (1 = sequential). Raising it lets FILE-DISJOINT siblings build concurrently; merges still serialize per integration branch, in approval order.",
  },
] as const;
