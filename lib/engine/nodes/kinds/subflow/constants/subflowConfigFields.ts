import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";

/** The subflow kind's authoring form (one entry per knob, drawer order). */
export const SUBFLOW_CONFIG_FIELDS: readonly ConfigField[] = [
  {
    key: "child",
    label: "Child template",
    type: "string" as const,
    help: "The flow template id this node delegates to — the stage gate expands exactly ONE child flow from it with the input_map-evaluated start payload",
  },
  {
    key: "parallel_max",
    label: "Parallel max",
    type: "number" as const,
    help: "Concurrency ceiling for the delegation (a subflow expands one child today; the knob is validated data for a later multi-child shape)",
  },
  {
    key: "pass",
    label: "Pass mapping",
    type: "json" as const,
    help: "Optional JSON object of field → JSONata over the child's terminal output; the mapped fields publish as this node's aggregate. Empty = the child's terminal output publishes as-is",
  },
] as const;
