"use client";
import { PlainArtifact } from "./PlainArtifact";
import { PipelineStatusBody } from "./PipelineStatusBody";
import { PIPELINE_STATUS } from "../constants/pipelineStatus";
import type { ArtifactPayload } from "../types/artifactPayload";
import type { PanelActionFn } from "../types/artifactRenderer";
import { parsePipelinePayload, pipelineNodeKeyOf } from "../utils/pipelinePayload";

/**
 * The `pipeline` artifact renderer (task 18): the CI gate's durable-wait
 * progress — the status badge, the watched pipeline's job snapshot, the
 * fix-run ledger and the retrigger affordance — so any gate node's wait
 * renders through the registry, not just the built-in `pipeline` def.
 * Presentational only (AGENTS §2.2): the loaded artifact in, JSX out; the
 * retrigger rides the panel's action dispatcher (task 17's verb, the
 * DiffView task 08 pattern) and targets the node key the snapshot's meta
 * carries. A non-snapshot body renders plain.
 */
export const PipelineStatusView = ({ artifact, action }: { artifact: ArtifactPayload; action?: PanelActionFn }) => {
  const payload = parsePipelinePayload(artifact.content);
  if (!payload) {
    return <PlainArtifact content={artifact.content} />;
  }
  return (
    <PipelineStatusBody
      green={payload.status === PIPELINE_STATUS.SUCCESS}
      status={payload.status}
      pipelineId={payload.pipelineId}
      fixes={payload.fixes}
      jobs={payload.jobs}
      fixRuns={payload.fixRuns}
      action={action}
      nodeKey={pipelineNodeKeyOf(artifact.meta)}
    />
  );
};