import "server-only";

import type { PlanMeta } from '../schema';

/** The latest plan artifact row + its parsed meta. */
export interface LatestPlan {
  art: { id: string; version: number; content: string };
  meta: PlanMeta;
  /** the artifact meta as it was persisted — re-published verbatim on merge */
  rawMeta: Record<string, unknown>;
}
