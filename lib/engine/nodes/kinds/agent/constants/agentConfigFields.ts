import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";

/**
 * The agent node's `base_ref` knob (Task 03): the ref the node's runs branch
 * from — plain text or a `{{...}}` ref rendered against the flow context at
 * run time. Empty/null = the flow's MR branch (the kind's previous default).
 */
export const baseRefConfigFields: readonly ConfigField[] = [
  {
    key: "base_ref",
    label: "Base ref",
    type: "string",
    nullable: true,
    help: "branch/ref the agent runs start from — text, or a {{...}} ref (e.g. {{task.key}}); empty = the flow's MR branch",
  },
] as const;

/**
 * The agent node's `retry_budget` knob (Task 03): how many bounded feedback
 * retries the json output contract may spend on a contract miss (0 = the
 * first miss is terminal). Config wins; the class default is the fallback.
 */
export const retryBudgetConfigFields: readonly ConfigField[] = [
  {
    key: "retry_budget",
    label: "Retry budget",
    type: "number",
    help: "feedback retries the json output contract may spend on a schema miss (0–5; 0 = the first miss fails the node; default 1)",
  },
] as const;
