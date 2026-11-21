import type { ComponentType } from "react";
import type { ActionPayload } from "../../context";
import type { ArtifactPayload } from "./artifactPayload";

/** The panel-action dispatcher a renderer may fire through — the same
 *  `action(a, payload)` the panels read off `useNodePanel`. Optional: the
 *  registry contract keeps renderers presentational, and only renderers that
 *  own an affordance (Task 08's refresh diff) take it. */
export type PanelActionFn = (action: string, payload?: ActionPayload) => void;

/** One artifact-kind renderer: presentational, loaded artifact in, JSX out.
 *  `action` rides along when the panel provides it — renderers never fetch. */
export type ArtifactRenderer = ComponentType<{ artifact: ArtifactPayload; action?: PanelActionFn }>;