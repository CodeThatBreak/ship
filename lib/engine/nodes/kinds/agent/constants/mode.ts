import type { ConfigField } from "../../../../templates/node-config";
import { AGENT_MODE } from "../../../../constants/declarative";

/** The agent node's "Mode" knob: plan = read-only judgment run; agent = repo workspace run. */
export const MODE_CONFIG_FIELD: ConfigField = {
  key: "mode",
  label: "Mode",
  type: "select",
  help: "plan = read-only judgment run; agent = repo workspace run",
  options: [
    { value: AGENT_MODE.PLAN, label: "Plan" },
    { value: AGENT_MODE.AGENT, label: "Agent" },
  ],
  optionIcons: { [AGENT_MODE.PLAN]: "Compass", [AGENT_MODE.AGENT]: "Sparkles" },
};
