import "server-only";

/** Persisted on `flows.kind` — how the instance was created. */
export const FLOW_KIND = {
  SDLC: "sdlc",
  STEP: "step",
  SPLIT: "split",
} as const;

export type FlowKind = (typeof FLOW_KIND)[keyof typeof FLOW_KIND];
