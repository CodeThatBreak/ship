import "server-only";

import type { ConfigField } from "../../../../templates/nodeConfig";
import { PRODUCIBLE_FACTS } from "../../../../facts/types/facts";
import type { ProducibleFact } from "../../../../facts/types/facts";
import { AGENT_TOOL_DESCRIPTORS, AGENT_TOOL_NAMES } from "../../../../agentTools/constants/agentTools";

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

/**
 * The agent node's `agent_tools` knob (task 13, Invariant 10): which engine
 * tools the node's running agent may call. The AgentToolService enforces the
 * intersection with the kind's `agentTools()` allowlist — a declaration can
 * only narrow, never widen. Options come from the tool vocabulary
 * (`AGENT_TOOL_DESCRIPTORS`), so the form and the enforced capability cannot
 * drift.
 */
export const agentToolsConfigFields: readonly ConfigField[] = [
  {
    key: "agent_tools",
    label: "Agent tools",
    type: "multi",
    help: "engine tools this node's running agent may call — intersected with the kind's allowlist (default: read_flow_state + report_failure)",
    options: AGENT_TOOL_NAMES.map((name) => ({
      value: name,
      label: name,
      description: AGENT_TOOL_DESCRIPTORS[name].description,
    })),
  },
] as const;

/**
 * The agent node's `secret_refs` knob (Task 15, finding C1): which flow
 * secrets the node's runs may use. The options are NOT static — they mirror
 * the configured secret names (the secrets list API, GET /api/settings
 * `secrets`, names only — values never leave the server), injected by the
 * render hosts (`DeclarativeConfigFields`) the same way the http kinds'
 * `{{secrets.NAME}}` chip groups read them.
 */
export const secretRefsConfigFields: readonly ConfigField[] = [
  {
    key: "secret_refs",
    label: "Secret refs",
    type: "multi",
    help: "flow secrets this node's runs may use — referenced as {{secrets.NAME}} in the prompt and injected into the agent's env; resolved at run start, never persisted (default: none)",
  },
] as const;
