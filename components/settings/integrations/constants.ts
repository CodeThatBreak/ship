/** Feature constants for the integrations tabs (AGENTS.md §1.6): provider
 *  kinds and instance surfaces are closed value sets — every comparison and
 *  key-building call uses these constants, never raw strings. */

/** API family an instance belongs to (mirror of the endpoint path segments). */
export const INSTANCE_SURFACE = {
  HOST: "host",
  TASK: "task",
} as const;
export type InstanceSurface = (typeof INSTANCE_SURFACE)[keyof typeof INSTANCE_SURFACE];

/** Registered provider kinds, by tab. */
export const PROVIDER_KIND = {
  GITLAB: "gitlab",
  JIRA: "jira",
  CURSOR: "cursor",
} as const;
export type ProviderKind = (typeof PROVIDER_KIND)[keyof typeof PROVIDER_KIND];

/** PATCH key + field names for the harness's local-run execution settings
 *  (mirror of the settings API contract: partial { local_agent: {...} }). */
export const LOCAL_AGENT = {
  KEY: "local_agent",
  FIELD: {
    FORCE: "force",
    SANDBOX: "sandbox",
  },
} as const;

/** Labels/copy for the Local agent options card (moved from the General page). */
export const LOCAL_AGENT_LABELS = {
  TITLE: "Local agent options",
  DESCRIPTION: "How agents run locally on this machine.",
  FORCE: "Auto-approve tools (--force)",
  SANDBOX: "Sandbox",
  TIMEOUT_PREFIX: "Timeout:",
  TIMEOUT_UNIT: "min",
  FORCE_OFF_WARNING:
    "Note: local runs are unattended — without --force the agent may stall waiting for tool approval.",
} as const;

/** Chip-state suffix shown after a toggle label ("…: on" / "…: off"). */
export const TOGGLE_STATE = {
  ON: "on",
  OFF: "off",
} as const;

/** ms→minutes conversion for the read-only timeout display. */
export const MS_PER_MINUTE = 60_000;
