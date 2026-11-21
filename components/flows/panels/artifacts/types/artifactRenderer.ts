import type { ComponentType } from "react";
import type { ArtifactPayload } from "./artifactPayload";

/** One artifact-kind renderer: presentational, loaded artifact in, JSX out. */
export type ArtifactRenderer = ComponentType<{ artifact: ArtifactPayload }>;
