import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";

/** The agent node's "Output schema" knob — the TS-lite schema box for the json output contract. */
export const OUTPUT_SCHEMA_CONFIG_FIELD: ConfigField = {
  key: "output_schema",
  label: "Output schema",
  type: "ts_output",
  help: "TypeScript-style members (or a JSON Schema) the json output must satisfy",
};
