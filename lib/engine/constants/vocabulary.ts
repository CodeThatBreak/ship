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

/** GitLab (or host) pipeline states referenced by the pipeline node. */
export const PIPELINE_STATUS = {
  CANCELED: "canceled",
} as const;

/** Artifact row status. */
export const ARTIFACT_KIND = {
  PLAN: "plan",
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

/** Settings keys stored in the app settings table. */
export const SETTING_KEY = {
  DEFAULT_MODEL: "default_model",
} as const;
