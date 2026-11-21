import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";
import { PRODUCIBLE_FACTS } from "../../../../facts/types/facts";
import type { ProducibleFact } from "../../../../facts/types/facts";

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

/** Per-kind help for the `produces` checkbox options (the fact vocabulary). */
const PRODUCES_HELP: Record<ProducibleFact, string> = {
  branch: "pushed branches become branch facts (branch rows, status stamped)",
  diff: "each pushed branch also gets a diff artifact (meta {branch, stat})",
};

/**
 * The agent node's `produces` knob (Task 06, Invariant F4): which facts the
 * node's runs may establish from `result.git`. An undeclared kind stays
 * dropped. Options come from the fact vocabulary (`PRODUCIBLE_FACTS`) —
 * `change_request` is not an option: MRs are established by the
 * `create_change_request` verb, never directly by a run.
 */
export const producesConfigFields: readonly ConfigField[] = [
  {
    key: "produces",
    label: "Produces",
    type: "multi",
    help: "git side effects this node's runs may establish as facts — undeclared kinds are dropped (default: none)",
    options: PRODUCIBLE_FACTS.map((kind) => ({
      value: kind,
      label: kind,
      description: PRODUCES_HELP[kind],
    })),
  },
] as const;
