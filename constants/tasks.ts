/** Live task feed query parameter names (GET /api/tasks/live). */
export const TASK_FILTER = {
  ASSIGNEE: "assignee",
  PROVIDER: "provider",
  STATUS_CATEGORY: "statusCategory",
  TEXT: "text",
} as const;

/** Assignee filter values. */
export const TASK_ASSIGNEE = {
  ME: "me",
  ANY: "any",
} as const;

/** Provider query param on the live feed (maps to `kind` on the wire). */
export const TASK_PROVIDER_PARAM = "kind" as const;
