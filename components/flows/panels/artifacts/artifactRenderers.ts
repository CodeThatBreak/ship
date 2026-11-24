import { ARTIFACT_KIND } from "./constants/artifactKinds";
import { DiffView } from "./components/DiffView";
import { FailedOutputView } from "./components/FailedOutputView";
import { GenericArtifactFallback } from "./components/GenericArtifactFallback";
import { JsonArtifact } from "./components/JsonArtifact";
import { MarkdownArtifact } from "./components/MarkdownArtifact";
import { PipelineStatusView } from "./components/PipelineStatusView";
import { PlanArtifactView } from "./components/PlanArtifactView";
import { ResolveArtifactView } from "./components/ResolveArtifactView";
import { ReviewArtifactView } from "./components/ReviewArtifactView";
import { TranscriptView } from "./components/TranscriptView";
import { UsageView } from "./components/UsageView";
import { withDryRunBadge } from "./utils/withDryRunBadge";
import type { ArtifactRenderer } from "./types/artifactRenderer";

/**
 * The only artifact-kind dispatch point: rendering keys off `artifact.kind`,
 * never the node's kind/type (extensibility plan Task 01). Renderers are
 * presentational — they receive the loaded artifact and do no fetching.
 * Task 23: every registry entry composes the shared dry-run provenance badge
 * here at the dispatch point (the only place it applies), so a new renderer
 * inherits the badge by registering — no renderer touches its own internals.
 */
const registryRenderers: Record<string, ArtifactRenderer> = {
  [ARTIFACT_KIND.MARKDOWN]: MarkdownArtifact,
  [ARTIFACT_KIND.JSON]: JsonArtifact,
  [ARTIFACT_KIND.DIFF]: DiffView,
  [ARTIFACT_KIND.PLAN]: PlanArtifactView,
  [ARTIFACT_KIND.USAGE]: UsageView,
  [ARTIFACT_KIND.TRANSCRIPT]: TranscriptView,
  [ARTIFACT_KIND.PIPELINE]: PipelineStatusView,
  [ARTIFACT_KIND.REVIEW]: ReviewArtifactView,
  [ARTIFACT_KIND.RESOLVE]: ResolveArtifactView,
  [ARTIFACT_KIND.FAILED_OUTPUT]: FailedOutputView,
};

export const artifactRenderers: Record<string, ArtifactRenderer> = Object.fromEntries(
  Object.entries(registryRenderers).map(([kind, renderer]) => [kind, withDryRunBadge(renderer)]),
);

/** An unregistered kind still renders — as the existing `<pre>` fallback. */
export const fallbackArtifactRenderer: ArtifactRenderer = GenericArtifactFallback;

/** The renderer for one kind: built-in when registered, the `<pre>` otherwise. */
export const rendererForKind = (kind: string): ArtifactRenderer =>
  artifactRenderers[kind] ?? fallbackArtifactRenderer;
