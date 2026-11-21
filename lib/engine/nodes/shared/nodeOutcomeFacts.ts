import "server-only";

import { engineParts } from "@/lib/composition/container";
import type { QueryExecutor } from "../../../db/database";
import type { RunOutcome } from "./types/runOutcome";

/**
 * The fact side-channel's persistence (Task 07, Invariant F2): the run's
 * captured git facts ride the terminal batch — `branch` facts upsert the
 * branch rows, `diff` facts save `kind: "diff"` artifacts — inside the
 * same transaction as the outcome's own writes. The payloads were captured
 * from git BEFORE the batch (the stepRollup precedent): git I/O never
 * joins a transaction.
 */
export const persistRunFacts = async (flowId: string, nodeId: string, outcome: RunOutcome, tx: QueryExecutor): Promise<void> => {
  const facts = outcome.facts;
  if (!facts) return;
  for (const branch of facts.branches) {
    await engineParts.facts.recordBranch(flowId, branch, tx);
  }
  for (const diff of facts.diffs) {
    await engineParts.facts.recordDiff(flowId, nodeId, diff, tx);
  }
};
