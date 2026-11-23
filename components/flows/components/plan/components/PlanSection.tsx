'use client';
import { MasterPlanSection } from './masterPlanSection/MasterPlanSection';

/**
 * The plan document section (level 1): the master plan. Renders nothing
 * without a plan version to show.
 */
export function PlanSection({ planId }: { planId: string | null }) {
  if (!planId) return null;
  return <MasterPlanSection planId={planId} />;
}
