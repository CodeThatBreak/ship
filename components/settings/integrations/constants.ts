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
