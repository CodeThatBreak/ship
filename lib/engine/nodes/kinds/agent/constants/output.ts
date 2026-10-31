import "server-only";

import type { ConfigField } from "../../../../templates/node-config";
import { AGENT_OUTPUT_FORMAT } from "../../../../constants/declarative";

/** The agent node's "Output" knob — the artifact contract (markdown artifact vs validated json payload). */
export const OUTPUT_CONFIG_FIELD: ConfigField = {
  key: "output",
  label: "Output",
  type: "select",
  help: "markdown → {{nodes.<key>.output.markdown}} artifact; json → validated payload fields",
  options: [
    { value: AGENT_OUTPUT_FORMAT.MARKDOWN, label: "text", description: "saved as a markdown artifact" },
    { value: AGENT_OUTPUT_FORMAT.JSON, label: "json", description: "validated against the output schema" },
  ],
};
