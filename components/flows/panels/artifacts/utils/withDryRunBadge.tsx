import type { ArtifactRenderer } from "../types/artifactRenderer";
import { DryRunArtifactBadge } from "../components/DryRunArtifactBadge";

/** The composition glue the registry dispatch point applies once per entry
 *  (at registration, so the wrapped component's identity is stable): a
 *  registry renderer whose output passes through the shared badge. */
export const withDryRunBadge = (Renderer: ArtifactRenderer): ArtifactRenderer => {
  const Wrapped: ArtifactRenderer = ({ artifact, action }) => (
    <DryRunArtifactBadge artifact={artifact}>
      <Renderer artifact={artifact} action={action} />
    </DryRunArtifactBadge>
  );
  return Wrapped;
};
