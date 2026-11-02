import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";

/** The agent node's "Prompt" knob — the `{{...}}`-interpolated prompt body. */
export const PROMPT_CONFIG_FIELD: ConfigField = {
  key: "prompt",
  label: "Prompt",
  type: "text",
  help: "{{...}} references — {{input.*}} (the previous node's output), {{nodes.<key>.output.*}}, {{task.*}} (the starting task), {{repo.*}}, {{flow.*}}, {{trigger.payload.*}} and {{secrets.NAME}}",
};
