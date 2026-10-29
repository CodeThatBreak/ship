'use client';
import { useMemo } from 'react';
import type { Artifact } from '@/types/flow';
import { VersionTabs } from '../../../panels/shared';
import { planTabCaption } from '../utils/branchDiff';

/**
 * The plan's version tabs (§6b): one tab per plan artifact, its provenance
 * echo captioned from the artifact's plan-meta. Renders nothing while the
 * flow has a single version — the tabs seam only exists for refinements.
 */
export function PlanVersionTabs({
  plans,
  selectedId,
  onSelection,
}: {
  plans: Artifact[];
  selectedId: string | null;
  onSelection: (id: string) => void;
}) {
  // version tab captions: each artifact's provenance echo, per its meta
  const captions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of plans) {
      const caption = planTabCaption(a.meta);
      if (caption) map.set(a.id, caption);
    }
    return map;
  }, [plans]);

  if (plans.length <= 1) return null;

  return <VersionTabs arts={plans} sel={selectedId ?? undefined} onSel={onSelection} captions={captions} />;
}
