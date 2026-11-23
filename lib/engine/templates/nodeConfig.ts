import "server-only";

import { getDb } from "../../db/dbAccess";
import { settingUnknownRecord } from "../../schemas/settingValues";
import { SETTING_SOURCES, type SettingSource } from "./schemas/mcpSources";

// ── MCP config sources (Cursor SDK `local.settingSources`) ───────────────────

/**
 * The shared "MCP sources" `ConfigField` — spread into every agent-running
 * def's `configFields` as one shared field set.
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
export async function appLayerConfig(defKey: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const stored = await getDb().getSetting(`node_config.${defKey}`, settingUnknownRecord.nullable(), null);
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
export async function bakeNodeConfig(
  defKey: string,
  defDefaults: Record<string, unknown>,
  templateConfig: unknown,
): Promise<string> {
  const merged = mergeConfigLayers(
    defDefaults,
    await appLayerConfig(defKey),
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
