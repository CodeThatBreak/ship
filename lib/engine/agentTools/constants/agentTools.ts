import "server-only";

import type { ToolDescriptor } from "../types/tools";

/**
 * The agent-tools vocabulary (step 08, Invariant 10): the closed set of
 * built-in tools a node kind's running agent may call on the agent-tools
 * endpoint, the env var the capability token rides, and the `completed_by`
 * provenance the checklist API stamps. Domain values live here — never
 * inline the strings (AGENTS §2.7).
 */
export const AGENT_TOOL = {
  /** The prompt-snapshot facts (node statuses, open checklist steps, open
   *  comments, pipeline state) queryable live at T+5min. */
  READ_FLOW_STATE: "read_flow_state",
  /** Authoritative build/step-build progress — the prose fence's replacement
   *  path (the fence stays as a logged fallback). */
  CLAIM_CHECKLIST_PROGRESS: "claim_checklist_progress",
  /** Bounded self-failure: the agent fails its own node with a reason
   *  instead of hallucinating success. One call per attempt. */
  REPORT_FAILURE: "report_failure",
  /** Task 13 (C4, use case 4): the agent ASKS to open the MR — the tool runs
   *  the SAME `create_change_request` verb the declarative effects dispatch
   *  (the engine authoritatively establishes the change_request fact; agent
   *  prose never claims one exists). Opt-in per node via `agent_tools`. */
  CREATE_CHANGE_REQUEST: "create_change_request",
} as const;

export type AgentToolName = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

/** The full tool-name list in vocabulary order — the def schemas' `z.enum`
 *  source (one vocabulary, no drift). */
export const AGENT_TOOL_NAMES = [
  AGENT_TOOL.READ_FLOW_STATE,
  AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS,
  AGENT_TOOL.REPORT_FAILURE,
  AGENT_TOOL.CREATE_CHANGE_REQUEST,
] as const;

/** The run-environment variable the capability token is injected under (cloud). */
export const AGENT_TOKEN_ENV = "DEVFLOW_AGENT_TOKEN";

/** The `plan_steps.completed_by` provenance an API claim stamps. */
export const AGENT_API_COMPLETED_BY = "api";

/**
 * The built-in tools' prompt-facing descriptors — the single source both the
 * defs' `agentTools()` allowlists and the tools block render from, so the
 * advertised text and the enforced capability can never drift.
 */
export const AGENT_TOOL_DESCRIPTORS: Record<AgentToolName, ToolDescriptor> = {
  [AGENT_TOOL.READ_FLOW_STATE]: {
    name: AGENT_TOOL.READ_FLOW_STATE,
    description:
      "read_flow_state — the live flow state: node statuses, open checklist steps, open comments, pipeline state. Use it to re-check facts that were frozen into this prompt.",
  },
  [AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS]: {
    name: AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS,
    description:
      "claim_checklist_progress — {\"stepIds\": [\"s1\", …]} marks the plan steps you FULLY completed as done (authoritative; the prose fence is only a fallback).",
  },
  [AGENT_TOOL.REPORT_FAILURE]: {
    name: AGENT_TOOL.REPORT_FAILURE,
    description:
      "report_failure — {\"reason\": \"…\", \"detail\": \"…\"} fails this node with your reason. Use it when you cannot complete the work; never claim success you do not have.",
  },
  [AGENT_TOOL.CREATE_CHANGE_REQUEST]: {
    name: AGENT_TOOL.CREATE_CHANGE_REQUEST,
    description:
      "create_change_request — {\"branchName\": \"feat/x\" (optional; default = your run's latest branch)} opens the merge request for the branch your run established. The engine creates it authoritatively — never claim an MR exists that you did not open through this tool.",
  },
};

/** The built-in kinds' tool allowlists (step 08): build/step-build get the
 *  original three; plan/review/resolve/decision/agent get read +
 *  report_failure; http/script/start get none (the `NodeDefinition` default).
 *  `create_change_request` is in NO built-in set — declarative agent kinds opt
 *  in per node through the `agent_tools` config (task 13, Invariant 10). */
export const AGENT_TOOL_SETS = {
  build: [
    AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.READ_FLOW_STATE],
    AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS],
    AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.REPORT_FAILURE],
  ],
  readAndReport: [
    AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.READ_FLOW_STATE],
    AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.REPORT_FAILURE],
  ],
} as const;
