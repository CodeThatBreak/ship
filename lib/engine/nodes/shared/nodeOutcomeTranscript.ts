import "server-only";

import { engineParts } from "@/lib/composition/container";
import type { QueryExecutor } from "../../../db/database";
import { ARTIFACT_KIND } from "../../constants/vocabulary";
import type { TranscriptPayload } from "../../transcript/transcriptPayload";

/**
 * The transcript side-channel's persistence (task 22, Invariant F2): a
 * finished agent run's capped tool-call log saves as a `kind: "transcript"`
 * artifact — inside the same transaction as the outcome's own writes (the
 * `persistRunUsage` sibling). The payload is pure data by the time it reaches
 * `applyOutcome`; no I/O happens here, only the artifact insert.
 */
export const persistRunTranscript = async (flowId: string, nodeId: string, transcript: TranscriptPayload, tx: QueryExecutor): Promise<void> => {
  await engineParts.nodeSupport.saveArtifact(
    nodeId,
    flowId,
    ARTIFACT_KIND.TRANSCRIPT,
    JSON.stringify(transcript),
    undefined,
    undefined,
    tx,
  );
};
