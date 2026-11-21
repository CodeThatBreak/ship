"use client";
import { PlainArtifact } from "./components/PlainArtifact";
import type { ArtifactPayload } from "./types/artifactPayload";

/** The fallback for an artifact kind with no registered renderer. */
export const GenericArtifactFallback = ({ artifact }: { artifact: ArtifactPayload }) => (
  <PlainArtifact content={artifact.content} />
);
