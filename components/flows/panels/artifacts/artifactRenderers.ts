import { ARTIFACT_KIND } from "./constants/artifactKinds";
import { DiffView } from "./DiffView";
import { GenericArtifactFallback } from "./GenericArtifactFallback";
import { JsonArtifact } from "./JsonArtifact";
import { MarkdownArtifact } from "./MarkdownArtifact";
import { PlanArtifactView } from "./PlanArtifactView";
import type { ArtifactRenderer } from "./types/artifactRenderer";

/**
 * The only artifact-kind dispatch point: rendering keys off `artifact.kind`,
 * never the node's kind/type (extensibility plan Task 01). Renderers are
 * presentational — they receive the loaded artifact and do no fetching.
 */
export const artifactRenderers: Record<string, ArtifactRenderer> = {
  [ARTIFACT_KIND.MARKDOWN]: MarkdownArtifact,
  [ARTIFACT_KIND.JSON]: JsonArtifact,
  [ARTIFACT_KIND.DIFF]: DiffView,
  [ARTIFACT_KIND.PLAN]: PlanArtifactView,
};

/** An unregistered kind still renders — as the existing `<pre>` fallback. */
export const fallbackArtifactRenderer: ArtifactRenderer = GenericArtifactFallback;

/** The renderer for one kind: built-in when registered, the `<pre>` otherwise. */
export const rendererForKind = (kind: string): ArtifactRenderer =>
  artifactRenderers[kind] ?? fallbackArtifactRenderer;
