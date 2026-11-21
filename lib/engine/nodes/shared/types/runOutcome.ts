import "server-only";

import type { NodeRunStatus } from "../../../../../constants/flow";
import type { BranchFactInput, DiffFactInput } from "../../../facts/types/facts";
import type { RunUsagePayload } from "../../../usage/runUsagePayload";

/**
 * The fact side-channel a finished run may carry (Task 07, Invariant F4):
 * the run's self-reported git facts (`result.git`) mapped through the def's
 * `produces` declaration — pure data, captured from git BEFORE the terminal
 * write's batch. `applyOutcome` persists it inside that batch's transaction
 * (F2); shaping never persists anything itself.
 */
export interface RunOutcomeFacts {
  /** one `branch` fact per reported branch → branchStore rows */
  branches: BranchFactInput[];
  /** one `diff` fact per reported branch → `kind: "diff"` artifacts */
  diffs: DiffFactInput[];
}

/**
 * What a node stores in its `output` column when it finishes a run.
 * Each node narrows this with its own schema.
 */
export interface RunOutcome {
  output: Record<string, unknown>;
  /** final node status — the closed set in `NODE_RUN_STATUS` (§2.7) */
  status: NodeRunStatus;
  /** artifact to save (kind + content + meta); nodes may save more themselves */
  artifact?: { kind: string; content: string; meta?: unknown };
  /** the run's fact intents (Task 07) — persisted by `applyOutcome` inside
   *  the terminal batch's transaction; absent when the def declares nothing */
  facts?: RunOutcomeFacts;
  /** the run's token/cost usage (Task 21) — persisted as a `kind: "usage"`
   *  artifact inside the same terminal batch (Invariant F2); absent when the
   *  run reported no usage */
  usage?: RunUsagePayload;
  /** lifecycle event message */
  event: string;
  eventData?: Record<string, unknown>;
  /** text returned to chat callers */
  reply: string;
}
