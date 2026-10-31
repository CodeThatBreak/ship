/** Flow build execution mode (cloud agent vs local SDK) — not plan whole/steps. */
export const RUN_MODE = {
  CLOUD: "cloud",
  LOCAL: "local",
} as const;

export type RunMode = (typeof RUN_MODE)[keyof typeof RUN_MODE];

/** @deprecated Prefer RUN_MODE — alias for task doc naming. */
export const EXECUTION_MODE = RUN_MODE;

export type ExecutionMode = RunMode;
