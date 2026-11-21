import "server-only";

import { engineParts } from "@/lib/composition/container";
import type { QueryExecutor } from "../../../db/database";
import { ARTIFACT_KIND } from "../../constants/vocabulary";
import type { RunUsagePayload } from "../../usage/runUsagePayload";

/**
 * The usage side-channel's persistence (Task 21, Invariant F2): a finished
 * agent run's token/cost facts save as a `kind: "usage"` artifact — inside
 * the same transaction as the outcome's own writes (the `persistRunFacts`
 * sibling). The payload is pure data by the time it reaches `applyOutcome`;
 * no I/O happens here, only the artifact insert.
 */
export const persistRunUsage = async (flowId: string, nodeId: string, usage: RunUsagePayload, tx: QueryExecutor): Promise<void> => {
  await engineParts.nodeSupport.saveArtifact(
    nodeId,
    flowId,
    ARTIFACT_KIND.USAGE,
    JSON.stringify(usage),
    undefined,
    undefined,
    tx,
  );
};
