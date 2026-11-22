import type { BranchRow, FlowData } from '@/types/flow';

/** An MR is already recorded when the flow or any of its branch facts carries
 *  an MR URL — the change-request verb then pushes and adopts it. */
export const hasChangeRequest = (flow: FlowData, branches: BranchRow[]): boolean =>
  Boolean(flow.mr_url) || branches.some(branch => Boolean(branch.mr_url));
