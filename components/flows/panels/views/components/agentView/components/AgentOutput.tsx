'use client';

import type { Artifact } from '@/types/flow';
import { ArtifactLoader, VersionTabs } from '../../../../shared';
import type { ArtifactPayload } from '../../../../shared';
import { rendererForKind } from '../../../../artifacts/artifactRenderers';
import { runVersionLabel } from '../utils/tabLabels';

/** The output tab: the selected run's version tabs and its rendered artifact. */
export default function AgentOutput({
  outputKind,
  outputArts,
  current,
  onSelectOutput,
}: {
  outputKind: string;
  outputArts: Artifact[];
  current: Artifact;
  onSelectOutput: (id: string) => void;
}) {
  // rendering is keyed off artifact kind, never the node kind: the output's
  // renderer comes from the registry, every other kind gets its own tab
  const OutputRenderer = rendererForKind(outputKind);

  return (
    <div>
      {outputArts.length > 1 && (
        <VersionTabs
          arts={outputArts}
          sel={current.id}
          onSel={onSelectOutput}
          versionLabel={runVersionLabel}
          className="mb-3.5"
        />
      )}
      <ArtifactLoader
        id={current.id}
        render={(loaded: ArtifactPayload) => <OutputRenderer artifact={loaded} />}
      />
    </div>
  );
}
