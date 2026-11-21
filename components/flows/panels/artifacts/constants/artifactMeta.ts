/** Artifact-meta keys shared across kinds (§2.7) — the client mirror of the
 *  engine's artifact-meta vocabulary (the client never imports `lib/`; the
 *  diffFactMeta/reviewFactMeta mirror precedent — keep the two in sync). */
export const ARTIFACT_META = {
  /** The artifact came from a `dry-run` execution-mode flow (task 27 sets the
   *  flag on its facts): simulated side effects on fake ports — every
   *  renderer shows the provenance badge through the shared wrapper so the
   *  output is never mistaken for a real artifact (use case 8h). */
  DRY_RUN: "dryRun",
  /** The fan-out rollup's parent-attached MERGED diff (vs the integration
   *  base) — distinguishes it from the per-step diff facts (task 25) that
   *  share the node's artifact list. */
  FANOUT: "fanout",
} as const;
