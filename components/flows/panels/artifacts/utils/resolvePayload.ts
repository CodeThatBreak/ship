import type { ArtifactPayload } from "../types/artifactPayload";

/** One per-comment decision a resolve run recorded — the client mirror of
 *  the engine's `ResolveCommentDecision` (`{id, action, reply?, resolve,
 *  note?}`; the client cannot import `lib/`, the pipelinePayload precedent). */
export interface ResolveDecisionView {
  id: string;
  action: string;
  reply: string | null;
  resolve: boolean;
  note: string | null;
}

/** The `resolve` artifact's meta narrowed to what the renderer shows
 *  (task 19): the run's summary and the per-comment decision ledger. */
export interface ResolvePayloadView {
  summary: string;
  decisions: ResolveDecisionView[];
}

const decisionOf = (value: unknown): ResolveDecisionView | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const action = typeof o.action === "string" ? o.action : "";
  if (!id || !action) return null;
  return {
    id,
    action,
    reply: typeof o.reply === "string" && o.reply.trim() ? o.reply : null,
    resolve: o.resolve === true,
    note: typeof o.note === "string" && o.note.trim() ? o.note : null,
  };
};

/** Parse the artifact meta into the renderer's view (the summary/decisions
 *  ledger rides the meta — the content is the rendered summary text). Null
 *  when the meta carries no summary or decision ledger at all — the
 *  renderer's plain-body fallback (the usagePayload precedent). */
export const parseResolvePayload = (meta: ArtifactPayload["meta"]): ResolvePayloadView | null => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const summary = typeof meta.summary === "string" ? meta.summary.trim() : "";
  const rawDecisions = meta.decisions;
  const decisions = Array.isArray(rawDecisions)
    ? rawDecisions.map(decisionOf).filter((d): d is ResolveDecisionView => d != null)
    : [];
  // no summary and no ledger → the fallback body, not an empty ledger card
  if (!summary && decisions.length === 0) return null;
  return { summary, decisions };
};
