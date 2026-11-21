"use client";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { Node } from "@/types/flow";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { ArtifactLoader } from "./ArtifactLoader";
import { GenericArtifactFallback } from "./GenericArtifactFallback";
import type { ArtifactRenderer } from "./types/artifactRenderer";
import { VersionTabs } from "./VersionTabs";

/** Versioned artifact tabs + a single fetched artifact rendered by the caller. */
export const GenericArtifact = ({
  node,
  kind,
  empty,
  icon: Icon,
  renderer,
}: {
  node: Node;
  kind: string;
  empty: string;
  icon?: LucideIcon;
  /** presentational renderer from the artifact-kind registry (default: `<pre>`) */
  renderer?: ArtifactRenderer;
}) => {
  const arts = node.artifacts.filter((a) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a) => a.id === sel) ?? arts[arts.length - 1];
  const Renderer = renderer ?? GenericArtifactFallback;
  return (
    <div>
      {arts.length > 1 && (
        <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />
      )}
      {current ? (
        <ArtifactLoader
          id={current.id}
          render={(loaded) => <Renderer artifact={loaded} />}
        />
      ) : (
        <EmptyHint icon={Icon}>{empty}</EmptyHint>
      )}
    </div>
  );
};
