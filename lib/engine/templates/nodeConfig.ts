import "server-only";

import { z } from "zod";
import { getDb } from "../../db/dbAccess";
import { settingUnknownRecord } from "../../schemas/settingValues";

// ── MCP config sources (Cursor SDK `local.settingSources`) ───────────────────

/**
 * The setting layers an agent run may load ambient MCP servers from — the
 * Cursor SDK's `SettingSource` union (`local.settingSources`), gated per run
 * by the `mcp_sources` knob on agent-running nodes. Empty/absent = the SDK
 * default: only inline servers load (byte-for-byte today's behavior).
 * Cloud runs always load `project` / `team` / `plugins` plus the
 * cursor.com/agents dashboard servers; this knob is a local-runtime knob.
 */
export const SETTING_SOURCES = ["project", "user", "team", "mdm", "plugins", "all"] as const;
export type SettingSource = (typeof SETTING_SOURCES)[number];

/** Zod fragment for the knob on a node's config/def schema (default = today's behavior). */
export const mcpSourcesSchema = z.array(z.enum(SETTING_SOURCES)).default([]);

/** The "enable everything" knob value — SDLC plan + build default to it. */
export const DEFAULT_MCP_SOURCES: SettingSource[] = ["all"];

/**
 * The shared "MCP sources" `ConfigField` — spread into every agent-running
 * def's `configFields` (one shared field set, same pattern as `fanoutConfigFields`).
 */
export const mcpSourceConfigFields: readonly ConfigField[] = [
  {
    key: "mcp_sources",
    label: "MCP sources",
    type: "multi",
    help: "Which ambient settings layers supply MCP servers for this node's agent runs (Cursor's local.settingSources): project = .cursor/mcp.json in the checkout, user = ~/.cursor/mcp.json on this machine, plugins = servers shipped by Cursor plugins, team/mdm = managed layers, all = every source the runtime knows. Empty = the node's class default (SDLC plan and build enable ALL sources; every other agent-running node loads inline servers only). Local runtime only — cloud runs always load project/team/plugins plus the dashboard servers.",
    options: [
      { value: "project", label: "project", description: ".cursor/mcp.json in the agent's checkout" },
      { value: "user", label: "user", description: "~/.cursor/mcp.json on this machine" },
      { value: "plugins", label: "plugins", description: "Servers shipped by Cursor plugins" },
      { value: "team", label: "team", description: "Team-managed settings layer" },
      { value: "mdm", label: "mdm", description: "Enterprise/MDM-managed settings layer" },
      { value: "all", label: "all", description: "Every source the runtime knows about" },
    ],
  },
] as const;

/**
 * Defensive read of the `mcp_sources` knob from a merged config layer —
 * snapshots ride raw into `run(config)` on the built-in kinds, and unknown or
 * invalid values bow out (never throw a run down).
 */
export function mcpSourcesOf(cfg: Record<string, unknown> | null | undefined): SettingSource[] {
  const v = cfg?.mcp_sources;
  if (!Array.isArray(v)) return [];
  const allowed = SETTING_SOURCES as readonly string[];
  return [...new Set(v.filter((x): x is SettingSource => typeof x === "string" && allowed.includes(x)))];
}

/** Descriptor for one config knob — drives the auto-generated form (Phase 2). */
export interface ConfigField {
  key: string;
  label: string;
  /**
   * Renderers: the five basics are the generic form rows; the declarative
   * kinds add their own — `ts_output` is the TS-lite schema box (agent node),
   * `choices` is the decision branch editor, `multi` renders the options as
   * a checkbox group writing a string array (e.g. the MCP sources knob).
   */
  type: "boolean" | "number" | "string" | "text" | "select" | "json" | "ts_output" | "choices" | "map" | "multi";
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
 * The app-settings layer: `settings["node_config.<defKey>"]` wins. Template
 * and per-flow configs sit above this layer in the merge order.
 */
export function appLayerConfig(defKey: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stored = getDb().getSetting(`node_config.${defKey}`, settingUnknownRecord.nullable(), null);
  if (stored && typeof stored === "object") Object.assign(out, stored);
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

// ── split consumption knobs (agent-node split plan §2.4, Phase 4) ─────────────
// The consumer knob on any node downstream of a split source — the next node
// decides (§1): whole = one run with the full upstream output (today's edge
// semantics, the default); per-unit = the split runtime expands one child run
// per unit and joins; source = the source def's `splitResolution()` decides.
// Flat keys, same layering as every knob (class defaults ← app settings ←
// flow snapshot); `splitConsumeOf`/`splitParallelMaxOf` in
// nodes/shared/split.ts are the defensive readers.

export const SPLIT_CONSUME_CONFIG_FIELD = {
  key: "split_consume",
  label: "Split consumption",
  type: "select",
  help:
    "How this node runs when an upstream split source publishes units: "
    + "whole = one run receiving everything (today's edge semantics); per-unit = one child run per unit, joined into an aggregate; "
    + "source = the source's published recommendation decides.",
  options: [
    { value: "whole", label: "whole", description: "One run for the whole output (default)" },
    { value: "per-unit", label: "per-unit", description: "One child flow per unit, then join" },
    { value: "source", label: "source", description: "The source's splitResolution decides" },
  ],
} as const satisfies ConfigField;

export const SPLIT_PARALLEL_MAX_CONFIG_FIELD = {
  key: "split_parallel_max",
  label: "Split parallel max",
  type: "number",
  help: "How many per-unit split children may run at once (1 = sequential). Scheduling still honors the units' declared dependencies.",
} as const satisfies ConfigField;

/** The shared split-consumer field set — spread into every def whose node can
 *  sit after a split source (the `fanoutConfigFields` pattern). */
export const splitConsumerConfigFields: readonly ConfigField[] = [
  SPLIT_CONSUME_CONFIG_FIELD,
  SPLIT_PARALLEL_MAX_CONFIG_FIELD,
];
