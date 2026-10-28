/** Trigger vocabularies shared by the template store, engine and editors.
 *  Closed value sets only — derived lists (e.g. TASK_TRIGGER_TYPES, which is
 *  computed from the task registry) stay with their consumer. */

/** Flow-level trigger types (webhook startups are always available — the
 *  inbound hook is provisioned for every template; the declared trigger only
 *  selects manual/schedule behavior). */
export const FLOW_TRIGGER_TYPES = ["manual", "schedule"] as const;
/** The task type assumed when a template's trigger declares none — the first
 *  registered provider kind ("none" when nothing registers). */
export const NO_TASK_TYPE = "none";
/** Per-node trigger types (debounced + wait_for wiring is engine-supported). */
export const NODE_TRIGGER_TYPES = ["auto", "manual", "approval", "debounced"] as const;
/** The same vocabulary keyed for comparisons — code reads
 *  `NODE_TRIGGER_TYPE.APPROVAL`, never the literal. */
export const NODE_TRIGGER_TYPE = {
  AUTO: "auto",
  MANUAL: "manual",
  APPROVAL: "approval",
  DEBOUNCED: "debounced",
} as const;
export type NodeTriggerType = (typeof NODE_TRIGGER_TYPE)[keyof typeof NODE_TRIGGER_TYPE];
/** wait_for event sources supported by the engine, host-neutral: "pipeline"
 * (the CI gate) and "comments" are the built-in gate + comment waits; webhook +
 * timer resume via the generic hook route / poller timers (Phase 4B). */
export const WAIT_FOR_SOURCES = ["pipeline", "comments", "webhook", "timer"] as const;
