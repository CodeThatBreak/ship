"use client";
import { PlainArtifact } from "./components/PlainArtifact";
import type { ArtifactPayload } from "./types/artifactPayload";

/** The JSON artifact body — preformatted text, like the unknown-kind fallback. */
export const JsonArtifact = ({ artifact }: { artifact: ArtifactPayload }) => (
  <PlainArtifact content={artifact.content} />
);
