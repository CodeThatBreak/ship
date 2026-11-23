import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";
import { mcpSourceConfigFields } from "../../../../templates/nodeConfig";
import { EFFECTS_CONFIG_FIELD } from "../../../../constants/effectsConfig";
import { MODE_CONFIG_FIELD } from "./mode";
import { PROMPT_CONFIG_FIELD } from "./prompt";
import { MODEL_CONFIG_FIELD } from "./model";
import { baseRefConfigFields, agentToolsConfigFields, retryBudgetConfigFields, secretRefsConfigFields } from "./agentConfigFields";
import { OUTPUT_CONFIG_FIELD } from "./output";
import { OUTPUT_SCHEMA_CONFIG_FIELD } from "./outputSchema";

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
  // run-target knobs (Task 03): the ref the runs branch from (empty = the
  // flow's MR branch) and the bounded feedback-retry budget for the json
  // output contract — declarative data, not class-level behavior
  ...baseRefConfigFields,
  ...retryBudgetConfigFields,
  // the declarative effects map: side effects (e.g. create_change_request)
  // declared under a lifecycle — the declaration IS the capability for the
  // AUTOMATIC after-approval dispatch (a manual panel verb needs none)
  EFFECTS_CONFIG_FIELD,
  // the agent-tools knob (Task 13, Invariant 10): which engine tools the
  // node's running agent may call — narrowed by the kind's allowlist
  ...agentToolsConfigFields,
  // the secret-refs knob (Task 15, C1): which flow secrets the runs may use
  // — {{secrets.NAME}} in the prompt + the AgentStartSpec.env channel
  ...secretRefsConfigFields,
  // the MCP-sources knob (Cursor local.settingSources): the shared agent-run
  // field set — empty = runtime default (inline servers only)
  ...mcpSourceConfigFields,
  OUTPUT_CONFIG_FIELD,
  OUTPUT_SCHEMA_CONFIG_FIELD,
];
