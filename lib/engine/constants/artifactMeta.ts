import "server-only";

/**
 * The engine's shared artifact-meta keys (§2.7) — the server side of the
 * vocabulary the client mirrors in
 * `components/flows/panels/artifacts/constants/artifactMeta.ts` (client code
 * never imports `lib/`; keep the two in sync).
 */
export const ARTIFACT_META = {
  /** The artifact came from a `dry-run` execution-mode flow (task 27): the
   *  run's side effects were simulated on the fake ports, so every renderer
   *  shows the provenance badge and the output is never mistaken for a real
   *  artifact (use case 8h, finding D1). */
  DRY_RUN: "dryRun",
} as const;
