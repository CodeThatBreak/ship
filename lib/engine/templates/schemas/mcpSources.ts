import "server-only";

import { z } from "zod";

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
