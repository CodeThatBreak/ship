'use client';
import { useMemo } from 'react';
import type { Artifact } from '@/types/flow';
import { computeWholePlanDiff } from '../utils/branchDiff';
import { DiffBanner } from './DiffBanner';

/**
 * The whole-plan refine diff banner (§6a): the newest version's refine provenance,
 * above its content — only while that newest version is being viewed. Renders
 * nothing when the viewed version didn't refine.
 */
export function WholeDiffBanner({ plans, isCurrent }: { plans: Artifact[]; isCurrent: boolean }) {
  // whole-plan refine diff banner data: fires only on a version carrying a
  // refine provenance mark, computed client-side from the plan metas
  const wholeDiff = useMemo(() => computeWholePlanDiff(plans), [plans]);

  if (!wholeDiff || !isCurrent) return null;

  return <DiffBanner info={wholeDiff} />;
}
