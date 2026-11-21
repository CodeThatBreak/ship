import "server-only";

/** The staleness read the artifact detail payload carries (Task 08). */
export interface DiffStaleness {
  /** the live branch head differs from the capture's recorded headSha */
  branchHeadStale: boolean;
}