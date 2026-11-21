"use client";
import { Badge } from "@/components/ui/badge";
import { ThreadList } from "../review/ThreadList";
import type { ReviewThread } from "../review/buildThreads";
import { PlainArtifact } from "./components/PlainArtifact";
import { REVIEW_FACT_META, REVIEW_THREAD_AUTHOR, REVIEW_THREAD_STATUS, REVIEW_VERDICT_VARIANT } from "./constants/reviewFactMeta";
import type { ArtifactPayload } from "./types/artifactPayload";
import { parseReviewPayload, reviewVerdictOf, type ReviewCommentView } from "./utils/reviewPayload";

/**
 * The `review` artifact renderer (task 19): the comment threads a review run
 * published, rendered through the shared `ThreadList` (the built-in review
 * panel's markup) plus the verdict badge — so a declarative review node's
 * panel renders threads via the registry, not just the built-in `review`
 * def. Presentational only (AGENTS §2.2): the loaded artifact in, JSX out —
 * the live MR threads stay the review panel's own query; this renders what
 * the run durably published. A non-review body renders plain.
 */
export const ReviewArtifactView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const payload = parseReviewPayload(artifact.content);
  if (!payload) {
    return <PlainArtifact content={artifact.content} />;
  }
  const verdict = reviewVerdictOf(artifact.meta);
  const posted = typeof artifact.meta?.[REVIEW_FACT_META.POSTED] === "number"
    ? (artifact.meta[REVIEW_FACT_META.POSTED] as number)
    : payload.comments.length;
  return (
    <div>
      {verdict && (
        <Badge className={`mb-2 ${REVIEW_VERDICT_VARIANT[verdict] ?? ""}`}>
          {verdict.replaceAll("_", " ")} · {posted} posted
        </Badge>
      )}
      <ThreadList threads={payload.comments.map(projectedThread)} />
    </div>
  );
};

/** One published comment as a projected open thread — a freshly posted
 *  review comment is an open discussion on the host (the resolve loop owns
 *  the closing), so the projection mirrors that state. */
const projectedThread = (comment: ReviewCommentView, index: number): ReviewThread => ({
  id: `${REVIEW_FACT_META.POSTED}_${index}`,
  root: {
    id: `${REVIEW_FACT_META.POSTED}_${index}`,
    author: REVIEW_THREAD_AUTHOR,
    body: comment.body,
    path: comment.file,
    line: comment.line,
    status: REVIEW_THREAD_STATUS.OPEN,
    resolvable: true,
    resolved: false,
    createdAt: "",
  },
  replies: [],
  resolvable: true,
  open: true,
  resolved: false,
});