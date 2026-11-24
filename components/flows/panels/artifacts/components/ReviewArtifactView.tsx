"use client";
import { Badge } from "@/components/ui/badge";
import { ThreadList } from "../../review/components/ThreadList";
import { PlainArtifact } from "./PlainArtifact";
import { REVIEW_FACT_META, REVIEW_VERDICT_VARIANT } from "../constants/reviewFactMeta";
import type { ArtifactPayload } from "../types/artifactPayload";
import { parseReviewPayload, reviewVerdictOf } from "../utils/reviewPayload";
import { projectedThread } from "../utils/projectedThread";

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