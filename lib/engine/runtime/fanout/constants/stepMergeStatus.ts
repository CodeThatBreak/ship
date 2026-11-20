import "server-only";

import { STEP_MERGE_STATUSES, type StepMergeStatus } from "../../../../db/constants/rowStatuses";

/**
 * Named handles on the durable `step_merges` status vocabulary (§2.7): the
 * closed set itself is owned by `STEP_MERGE_STATUSES` in
 * `lib/db/constants/rowStatuses.ts` (mirrors the sticky `StepMergeStatus` PG
 * enum) — these aliases exist so engine call sites never repeat the raw
 * literals. Names mirror the vocabulary tuple order.
 */
const [running, conflict, rejected, merged, failed] = STEP_MERGE_STATUSES;
export const STEP_MERGE_STATUS = {
  RUNNING: running,
  CONFLICT: conflict,
  REJECTED: rejected,
  MERGED: merged,
  FAILED: failed,
} as const satisfies Readonly<Record<string, StepMergeStatus>>;
