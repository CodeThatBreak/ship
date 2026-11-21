import { PIPELINE_FACT_META } from "../constants/pipelineFactMeta";
import type { ArtifactPayload } from "../types/artifactPayload";

/** One watched pipeline job, as the hosts normalize it — the client mirror
 *  of the engine's `HostJob` (the client cannot import `lib/engine`, so the
 *  shape is restated here; the diffFactMeta precedent). */
export interface PipelineJobView {
  id: number;
  name: string;
  status: string;
  /** the job waits for a human/agent to press play */
  manual: boolean;
}

/** One fix run the gate spent, as the snapshot's ledger carries it (the
 *  client mirror of the `fix` artifact's `{ pipelineId, attempt }` meta plus
 *  the run's result head). */
export interface PipelineFixRunView {
  attempt: number;
  summary: string;
}

/** The `pipeline` artifact's stored JSON narrowed to what the renderer shows
 *  (task 18): the watched pipeline's status, the job snapshot and the
 *  fix-run ledger. Mirrors the engine's `PipelineOutput` plus the job/fix
 *  projection — restated client-side (no `lib/` imports). */
export interface PipelinePayloadView {
  status: string;
  pipelineId: number | null;
  fixes: number;
  jobs: PipelineJobView[];
  fixRuns: PipelineFixRunView[];
}

const numOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const idOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const jobOf = (value: unknown): PipelineJobView | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const id = idOf(o.id);
  const name = typeof o.name === "string" ? o.name : "";
  if (id == null || !name) return null;
  return { id, name, status: typeof o.status === "string" ? o.status : "", manual: o.manual === true };
};

const fixRunOf = (value: unknown): PipelineFixRunView | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const attempt = idOf(o.attempt);
  const summary = typeof o.summary === "string" ? o.summary : "";
  if (attempt == null || !summary) return null;
  return { attempt, summary };
};

const listOf = <T>(value: unknown, itemOf: (item: unknown) => T | null): T[] =>
  Array.isArray(value)
    ? value.map(itemOf).filter((item): item is T => item != null)
    : [];

/** Parse the artifact content into the renderer's view. Null when the
 *  content is not a pipeline snapshot (the renderer's plain-body fallback)
 *  or carries no pipeline facts at all — the empty payload is not a status
 *  card (the usagePayload precedent). */
export const parsePipelinePayload = (content: string): PipelinePayloadView | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status : "";
  const pipelineId = idOf(o.pipelineId);
  const jobs = listOf(o.jobs, jobOf);
  const fixRuns = listOf(o.fixRuns, fixRunOf);
  // no pipeline facts at all → the fallback body, not an empty snapshot card
  if (!status && pipelineId == null && jobs.length === 0 && fixRuns.length === 0) {
    return null;
  }
  return { status, pipelineId, fixes: numOf(o.fixes), jobs, fixRuns };
};

/** The retrigger verb's target node key, when the snapshot's meta recorded
 *  it — without it the affordance has nothing to dispatch to. */
export const pipelineNodeKeyOf = (meta: ArtifactPayload["meta"]): string | undefined => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const nodeKey = meta[PIPELINE_FACT_META.NODE_KEY];
  return typeof nodeKey === "string" && nodeKey ? nodeKey : undefined;
};
