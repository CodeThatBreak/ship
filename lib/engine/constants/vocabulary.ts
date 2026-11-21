import "server-only";

/** Feed event `type` column and `db.emitEvent` first-class kinds. */
export const EVENT_KIND = {
  LIFECYCLE: "lifecycle",
  ERROR: "error",
  MR_FAILED: "mr_failed",
  PIPELINE: "pipeline",
  LOG: "log",
  ASSISTANT: "assistant",
  TOOL: "tool",
  STATUS: "status",
  /** stage start refused: the materialized input missed the node's `consumes`
   *  / `input_map` targets (step 04, Invariant 5) */
  INPUT_CONTRACT_VIOLATION: "input_contract_violation",
  /** a terminal outcome failed its declared output contract — never published
   *  (step 04, Invariant 5) */
  OUTPUT_CONTRACT_VIOLATION: "output_contract_violation",
  /** the agent-output pipeline retries a contract miss with feedback
   *  (step 05, Invariant 6) */
  OUTPUT_RETRY: "output_retry",
  /** the bounded feedback budget is spent — the node fails loudly (step 05) */
  OUTPUT_EXHAUSTED: "output_exhausted",
  /** the agent answered with the standard error envelope — its reason is the
   *  failure, never retried (step 05) */
  AGENT_REPORTED: "agent_reported",
  /** step 08 (Invariant 10): the running agent failed its OWN node via the
   *  bounded `report_failure` tool — the reason is the agent's, carried
   *  through the authority's declared `agentReportedFailure` transition */
  AGENT_REPORTED_FAILURE: "agent_reported_failure",
  /** a trigger lost the atomic claim (step 06, Invariant 11): the node is
   *  already in flight or not in the trigger's from-set. Debug-level and
   *  dedup-friendly in the UI — concurrent webhook/poller races on the same
   *  event emit one per losing source, so the feed groups identical skips. */
  SKIPPED_DUPLICATE_TRIGGER: "skipped_duplicate_trigger",
  /** a not-yet-started node's config snapshot was edited in-flow (task 05):
   *  only `pending`/`failed` nodes accept the edit, the feed renders the
   *  changed keys, and the next run re-reads the edited snapshot */
  CONFIG_UPDATED: "config_updated",
} as const;

export type EventKind = (typeof EVENT_KIND)[keyof typeof EVENT_KIND];

/** Agent port / `runs.status` terminal vocabulary. */
export const RUN_STATUS = {
  RUNNING: "running",
  FINISHED: "finished",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

/** Placeholder `runs.agent_ref` while the agent has not started yet (claim → persistRun). */
export const RUN_AGENT_REF = {
  PENDING: "pending",
} as const;

/** GitLab (or host) pipeline states referenced by the pipeline node. */
export const PIPELINE_STATUS = {
  CANCELED: "canceled",
} as const;

/** Artifact row `kind` values the engine writes. */
export const ARTIFACT_KIND = {
  PLAN: "plan",
  /** a diff fact's artifact — meta {branch, stat} (design §4.1, Task 06) */
  DIFF: "diff",
} as const;

export const ARTIFACT_STATUS = {
  DRAFT: "draft",
  APPROVED: "approved",
  SUPERSEDED: "superseded",
} as const;

/** MR comment row status. */
export const COMMENT_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
} as const;

/** The `comments.resolved_by` value the engine's own comment effects stamp —
 *  the `commentStore.ingest` guard keys off it to never re-open agent-closed
 *  rows when the poller/webhook re-deliver the same note. */
export const RESOLVED_BY_AGENT = "agent";

/** Settings keys stored in the app settings table. */
export const SETTING_KEY = {
  DEFAULT_MODEL: "default_model",
} as const;
