import type { ConfigField } from "../../../../templates/node-config";
import { fanoutConfigFields, mcpSourceConfigFields } from "../../../../templates/node-config";
import { MODE_CONFIG_FIELD } from "./mode";
import { PROMPT_CONFIG_FIELD } from "./prompt";
import { MODEL_CONFIG_FIELD } from "./model";
import { OUTPUT_CONFIG_FIELD } from "./output";
import { OUTPUT_SCHEMA_CONFIG_FIELD } from "./output-schema";

/**
 * The agent node's full authoring form — one entry per knob, option values
 * pulled from the kind's vocabulary (`constants/declarative.ts`). It lives in
 * the configurator drawer (not just the create dialog): the prompt is edited
 * in place, after the node is connected, so the upstream run-context
 * variables are clickable chips.
 */
export const AGENT_CONFIG_FIELDS: readonly ConfigField[] = [
  MODE_CONFIG_FIELD,
  PROMPT_CONFIG_FIELD,
  MODEL_CONFIG_FIELD,
  // the MCP-sources knob (Cursor local.settingSources): the shared agent-run
  // field set — empty = runtime default (inline servers only)
  ...mcpSourceConfigFields,
  // plan fan-out knobs (Phase 3C): any agent node downstream of a plan node
  // may fan out into per-step child flows — the declarative agent kind is
  // the established fan-out-capable custom parent (§5 "Fanout section on
  // the config tab"). The child picker lists the gallery (hidden
  // auto-wrapped templates excluded). decision / http / script keep
  // JSON-level fan-out config (their strict def schemas would strip the
  // flat knob keys).
  ...fanoutConfigFields,
  OUTPUT_CONFIG_FIELD,
  OUTPUT_SCHEMA_CONFIG_FIELD,
];
