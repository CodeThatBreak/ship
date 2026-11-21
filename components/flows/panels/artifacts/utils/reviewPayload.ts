import { REVIEW_FACT_META, REVIEW_VERDICT, type ReviewVerdict } from "../constants/reviewFactMeta";
import type { ArtifactPayload } from "../types/artifactPayload";

/** One review comment a run published — the client mirror of the engine's
 *  `ReviewCommentItem` (`{file?, line?, body}`; the client cannot import
 *  `lib/`, the pipelinePayload precedent). */
export interface ReviewCommentView {
  file: string | null;
  line: number | null;
  body: string;
}

/** The `review` artifact's stored JSON narrowed to what the renderer shows
 *  (task 19): the comment threads the run published. */
export interface ReviewPayloadView {
  comments: ReviewCommentView[];
}

const commentOf = (value: unknown): ReviewCommentView | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!body) return null;
  const file = typeof o.file === "string" && o.file.trim() ? o.file.trim() : null;
  const line = typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0 ? o.line : null;
  return { file, line, body };
};

const commentListOf = (value: unknown): ReviewCommentView[] =>
  Array.isArray(value) ? value.map(commentOf).filter((c): c is ReviewCommentView => c != null) : [];

/** Parse the artifact content into the renderer's view. Accepts the comment
 *  array itself or an object carrying one (the verb's projection shape) —
 *  null when the content is not a review payload at all (the renderer's
 *  plain-body fallback; the usagePayload/pipelinePayload precedent). */
export const parseReviewPayload = (content: string): ReviewPayloadView | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const comments = commentListOf(Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown> | null)?.["comments"]);
  // no comments at all → the fallback body, not an empty thread list
  return comments.length > 0 ? { comments } : null;
};

/** The verdict the meta stamps (task 19's structured fact projection) —
 *  null when the meta carries none or an unrecognized value (the closed
 *  vocabulary never widens from data). */
export const reviewVerdictOf = (meta: ArtifactPayload["meta"]): ReviewVerdict | null => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const raw = meta[REVIEW_FACT_META.VERDICT];
  return raw === REVIEW_VERDICT.APPROVE || raw === REVIEW_VERDICT.REQUEST_CHANGES ? raw : null;
};
