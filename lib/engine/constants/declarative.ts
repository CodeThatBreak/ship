import "server-only";

/** Declarative node-kind vocabularies (agent / decision / http / script kinds).
 *  The zod schemas in `nodes/declarative-schemas.ts` consume these and re-export
 *  them, so its public surface is unchanged. */

// ── agent kind ────────────────────────────────────────────────────────────────

/** The agent run mode: plan = read-only judgment run; agent = repo workspace run. */
export const AGENT_MODE = {
  PLAN: "plan",
  AGENT: "agent",
} as const;
export type AgentMode = (typeof AGENT_MODE)[keyof typeof AGENT_MODE];
/** The closed set, for zod `z.enum` (AgentDefSchema.mode). */
export const AGENT_MODES = Object.values(AGENT_MODE) as [AgentMode, ...AgentMode[]];

/** What an agent node publishes: a markdown artifact or a validated json payload. */
export const AGENT_OUTPUT_FORMAT = {
  MARKDOWN: "markdown",
  JSON: "json",
} as const;
export type AgentOutputFormat = (typeof AGENT_OUTPUT_FORMAT)[keyof typeof AGENT_OUTPUT_FORMAT];
/** The closed set, for zod `z.enum` (AgentDefSchema.output). */
export const AGENT_OUTPUT_FORMATS = Object.values(AGENT_OUTPUT_FORMAT) as [
  AgentOutputFormat,
  ...AgentOutputFormat[],
];

export const DECISION_SOURCES = ["expression", "manual", "agent"] as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

export const SCRIPT_RUNTIMES = ["shell", "node", "python"] as const;
