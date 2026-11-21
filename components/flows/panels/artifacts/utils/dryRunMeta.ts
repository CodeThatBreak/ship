import { ARTIFACT_META } from "../constants/artifactMeta";

/** Tolerant read of the artifact meta's dry-run flag (the `usagePayload.ts`
 *  client-parse precedent): `meta` is an untyped JSON bag that may be absent,
 *  so anything short of the literal `true` reads as a real artifact. */
export const isDryRunArtifact = (meta: unknown): boolean =>
  typeof meta === "object" && meta !== null && !Array.isArray(meta)
  && (meta as Record<string, unknown>)[ARTIFACT_META.DRY_RUN] === true;
