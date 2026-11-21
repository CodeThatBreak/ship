import "server-only";

import type { ToolDescriptor } from "../../agentTools/types/tools";
import type { SettingSource } from "../../templates/schemas/mcpSources";
import type { ExecMode } from "./runContext/types/flowContext";
import { CLOUD_AMBIENT_SETTING_SOURCES, type RecordedToolPolicy } from "../../constants/agentRunPolicy";

/**
 * Task 16 (design C2): the recorded-policy computation for agent runs — pure,
 * so the recorder in `AgentRunNode.execute` and the enforcer in
 * `AgentToolService` cannot drift: what a run records is exactly what was
 * advertised and enforced.
 */

/**
 * The ONE effective-tool-set seam (Invariant 10): the kind's `agentTools()`
 * allowlist narrowed by the node's declared `agent_tools`. A declared set can
 * only NARROW the kind's allowlist, never widen it; null declared = the kind's
 * allowlist governs alone (today's behavior, byte-for-byte).
 */
export const effectiveAgentTools = (
  allowlist: readonly ToolDescriptor[],
  declared: readonly ToolDescriptor["name"][] | null,
): ToolDescriptor["name"][] =>
  allowlist
    .filter((tool) => declared == null || declared.includes(tool.name))
    .map((tool) => tool.name);

/**
 * The policy a run records: the effective engine tools plus what the mode
 * adapter actually did with the node's requested MCP layers. Cloud runtimes
 * always load their fixed ambient layers and drop the local-only knob (the
 * recorded decision — formerly a silent drop in the cloud adapter's start());
 * local runtimes forward the requested layers verbatim, where empty means the
 * SDK default (inline servers only).
 */
export const recordedRunToolPolicy = (params: {
  execMode: ExecMode;
  /** the node's requested `mcp_sources` (the mode adapter's input) */
  requested: readonly SettingSource[] | undefined;
  /** the effective engine-tool names (the `agentTools()` ∩ declared seam) */
  tools: readonly ToolDescriptor["name"][];
}): RecordedToolPolicy => {
  if (params.execMode === "cloud") {
    return {
      tools: [...params.tools],
      settingSources: [...CLOUD_AMBIENT_SETTING_SOURCES],
      settingSourcesDropped: (params.requested?.length ?? 0) > 0,
    };
  }
  return {
    tools: [...params.tools],
    settingSources: params.requested ? [...params.requested] : [],
    settingSourcesDropped: false,
  };
};
