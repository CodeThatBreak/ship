import "server-only";

import type { ChangeRequest, Pipeline } from "../../../ports/git-host";

/** Result of resolving the MR head pipeline against the MR head SHA. */
export type HeadPipelineLookup =
  | { kind: "ok"; pipe: Pipeline }
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "error" };

/**
 * Classify MR head pipeline lookup — API failures, missing pipeline, stale SHA,
 * and a current head pipeline are distinct (CR-075).
 */
export const classifyHeadPipeline = (
  cr: ChangeRequest | null,
  crFailed: boolean,
  pipe: Pipeline | null,
  pipeFailed: boolean,
): HeadPipelineLookup => {
  if (crFailed) return { kind: "error" };
  if (!cr?.headPipeline) return { kind: "none" };
  if (pipeFailed || !pipe) return { kind: "error" };
  if (cr.sha && pipe.sha && pipe.sha !== cr.sha) return { kind: "stale" };
  return { kind: "ok", pipe };
};

/** True when the gate should not auto-trigger a pipeline (grace or API backoff). */
export const shouldDeferPipelineTrigger = (
  head: HeadPipelineLookup,
  inFixGrace: boolean,
): boolean => head.kind === "error" || inFixGrace;
