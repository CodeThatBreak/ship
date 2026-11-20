import "server-only";

/** The child trigger payload (spec §child shape). `parentNodeKey` is an extra
 *  field beside the spec'd shape — the rollup needs to know which parent node
 *  reschedules; auto-wrapped and step-build children read `step.*` only. */
export interface StepChildPayload {
  plan: { title: string; summary: string };
  step: { id: string; title: string; detail: string | null; files: string[]; branch?: string };
  /** Phase 3A: siblings refreshed at start time — `summary` carries a
   *  non-code sibling's output summary, `mergeStatus` a code sibling's
   *  merge-back state (conflict / fixing / …) so parallel children read the
   *  live picture, not the expand-time snapshot. */
  siblings: { id: string; title: string; files: string[]; status: string; summary?: string; mergeStatus?: string }[];
  parentNodeKey: string;
  /** The single work node instance key on the child flow (set at expand time). */
  workNodeKey?: string;
}
