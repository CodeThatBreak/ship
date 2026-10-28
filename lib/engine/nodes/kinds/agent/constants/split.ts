import type { ConfigField } from "../../../../templates/node-config";

/**
 * The agent node's "Split into units" knob (agent-node split plan Phase 3) —
 * the whole `split` block's enable/disable. The per-knob editors inside it
 * (the output-schema array picker, the per-item field paths, the default
 * target) render bespoke in `SplitConfigFields`, driven by the node's
 * compiled output schema — a plain ConfigField can't express a picker over
 * another knob's schema.
 */
export const SPLIT_CONFIG_FIELD: ConfigField = {
  key: "split",
  label: "Split into units",
  type: "boolean",
  help: "Publish the output's array field as split units — a per-unit consumer then runs one child per unit. Requires output json with an array field in the output schema; the agent's prompt gets the matching unit-shape directive.",
};
