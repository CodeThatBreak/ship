import "server-only";

import type { ConfigField } from "../../../../templates/node-config";

/** The agent node's "Model override" knob — text or a `{{...}}` ref; empty = the flow's default model. */
export const MODEL_CONFIG_FIELD: ConfigField = {
  key: "model",
  label: "Model override",
  type: "string",
  nullable: true,
  help: "text, or a {{...}} ref — e.g. {{nodes.<key>.output.model}} — empty = the flow's default model",
};
