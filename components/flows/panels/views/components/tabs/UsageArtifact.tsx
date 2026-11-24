"use client";

import { Gauge } from "lucide-react";
import type { Node } from "@/types/flow";
import { GenericArtifact } from "../../../artifacts/components/GenericArtifact";
import { ARTIFACT_KIND } from "../../../artifacts/constants/artifactKinds";
import { rendererForKind } from "../../../artifacts/artifactRenderers";

/** The node's recorded run usage, with the shared artifact states. */
export function UsageArtifact({ node }: { node: Node }) {
  return (
    <GenericArtifact
      node={node}
      kind={ARTIFACT_KIND.USAGE}
      empty="No usage recorded yet."
      icon={Gauge}
      renderer={rendererForKind(ARTIFACT_KIND.USAGE)}
    />
  );
}
