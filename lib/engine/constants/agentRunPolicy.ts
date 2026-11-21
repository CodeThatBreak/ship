import "server-only";

import type { ToolDescriptor } from "../agentTools/types/tools";
import type { SettingSource } from "../templates/schemas/mcpSources";

/**
 * Task 16 (design C2): the recorded effective tool/MCP policy — the `env`
 * channel's sibling. A run's effective engine-tool set (the kind's
 * `agentTools()` allowlist ∩ the node's declared `agent_tools`) and the
 * ambient MCP setting layers the mode adapter actually applied ride the
 * recorded-input blob, so cloud-vs-local tool divergence is a recorded
 * decision, never silent folklore.
 */

/** The recorded-input blob key the policy rides (sibling of `prompt`/`prompt_source`). */
export const TOOL_POLICY_INPUT_KEY = "tool_policy";

/**
 * The ambient setting layers a cloud runtime always loads — project/team/
 * plugins plus the MCP servers configured on cursor.com/agents (the dashboard
 * servers sit outside the `SettingSource` vocabulary). The `mcp_sources` knob
 * is local-runtime only: the cloud adapter never forwards it.
 */
export const CLOUD_AMBIENT_SETTING_SOURCES: readonly SettingSource[] = ["project", "team", "plugins"];

/** The effective tool/MCP policy one run ran under. */
export interface RecordedToolPolicy {
  /** The engine tools the run's prompt block advertised AND the agent-tools
   *  endpoint enforces — the `agentTools()` ∩ declared seam (Invariant 10). */
  tools: ToolDescriptor["name"][];
  /** The ambient setting layers the runtime loaded: cloud = its fixed ambient
   *  set; local = the requested layers (empty = the SDK default, inline only). */
  settingSources: SettingSource[];
  /** The node's requested `mcp_sources` were dropped by runtime policy
   *  (cloud — the knob is local-runtime only). */
  settingSourcesDropped: boolean;
}
