import { getFlowListData } from "@/loaders/flows";
import { FlowsView } from '@/components/flows/components/FlowsView';

export const dynamic = "force-dynamic";

/**
 * Flows list (server): the first pageful of rows is read via the loader (the
 * same engine read the thin API route wraps) and handed to the client island
 * as initial data — no loading flash on the table. Live refresh, delete and
 * worktree polling stay client-side (see components/flows).
 */
export default function FlowsPage() {
  return <FlowsView initialFlows={getFlowListData()} />;
}
