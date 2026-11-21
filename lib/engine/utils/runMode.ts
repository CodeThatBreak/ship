import "server-only";

import { RUN_MODE, type RunMode } from "@/constants/execution";

/**
 * Coerce the persisted `flows.execution_mode` string onto the closed mode
 * union. Unknown/legacy values read as cloud — the pre-dry-run behavior —
 * so a stale column value can never hard-fail a run; the dry-run mode is
 * explicit and survives the coercion intact.
 */
export const resolveRunMode = (mode: string | null | undefined): RunMode => {
  if (mode === RUN_MODE.LOCAL) return RUN_MODE.LOCAL;
  if (mode === RUN_MODE.DRY_RUN) return RUN_MODE.DRY_RUN;
  return RUN_MODE.CLOUD;
};

/**
 * The MR-duty gate (task 27, design §7): a dry-run flow's MRs are the
 * simulation harness's fabrications — the reconciler/poller MR duties must
 * never resolve them against a real git host, so dry-run flows are excluded
 * at those seams.
 */
export const isRealMrFlow = (mode: string | null | undefined): boolean =>
  mode !== RUN_MODE.DRY_RUN;
