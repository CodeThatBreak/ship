"use client";
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import type { ArtifactPayload } from "../types/artifactPayload";
import { isDryRunArtifact } from "../utils/dryRunMeta";

/**
 * The one shared dry-run provenance wrapper (Task 23): composed around every
 * artifact-renderer registry entry at the registry dispatch point, never
 * inside a renderer. When the artifact's meta carries the dry-run flag, the
 * renderer's output is framed under an unmissable badge — simulated output
 * from the `dry-run` execution mode (task 27 sets the flag) must never be
 * mistaken for a real artifact (use case 8h). Without the flag the output
 * renders unchanged.
 */
export const DryRunArtifactBadge = ({
  artifact,
  children,
}: {
  artifact: ArtifactPayload;
  children: ReactNode;
}) => {
  if (!isDryRunArtifact(artifact.meta)) return <>{children}</>;
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3.5">
      <p className="mb-2.5 mt-0 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.8px] text-warning">
        <FlaskConical size={12} /> Dry run — simulated output, no real side effects
      </p>
      {children}
    </div>
  );
};