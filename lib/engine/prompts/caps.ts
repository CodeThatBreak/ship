import "server-only";

/** The task PRD block cap shared by the review / plan / build prompt paths. */
export const TASK_PRD_CAP = 4000;

/** The MR diff cap the review prompt assembles (engine-side; the GitLab-side
 *  change-set truncation is separate and stays noted by the host payload). */
export const REVIEW_DIFF_CAP = 60_000;
