import "server-only";

import type { SplitUnitStatus } from "./splitUnitStatus";

/** Live state of one unit, derived from the linkage + the child flow — what
 *  the scheduler, the join and the actions all read. */
export interface SplitUnitState {
  key: string;
  title: string;
  dependsOn: string[];
  childFlowId: string | null;
  status: SplitUnitStatus;
  /** the child's merged node outputs ({} when the unit never produced output) */
  output: Record<string, unknown>;
}
