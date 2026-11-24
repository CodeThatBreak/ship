import type { ReviewThread } from "../../review/utils/buildThreads";
import { REVIEW_FACT_META, REVIEW_THREAD_AUTHOR, REVIEW_THREAD_STATUS } from "../constants/reviewFactMeta";
import type { ReviewCommentView } from "./reviewPayload";

/** One published comment as a projected open thread — a freshly posted
 *  review comment is an open discussion on the host (the resolve loop owns
 *  the closing), so the projection mirrors that state. */
export const projectedThread = (comment: ReviewCommentView, index: number): ReviewThread => ({
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
