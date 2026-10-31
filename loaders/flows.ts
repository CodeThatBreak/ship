import "server-only";
/**
 * Server-side data loaders for flow pages (§2.1: server components fetch
 * through the services the thin API routes wrap — never through self-fetch).
 *
 * Lives outside `app/**` / `components/**` because the Phase 0 lint zone
 * (docs/phase0-baseline.md) restricts `lib/**` imports from those trees even
 * for server-only code; a loader module is the sanctioned importer (see the
 * pending lint-config note about server-zone exceptions).
 */
import { flowEngine } from "../lib/engine/flow-engine";
import type { FlowData } from "@/types/flow";
import { flowSummaries, type FlowSummary } from "@/types/flows";

/**
 * The flow cockpit's initial snapshot — the same service read the thin
 * `GET /api/flows/:id` route wraps. Returns `null` when the flow doesn't
 * exist — the caller maps that to 404.
 */
export const getFlowCockpitData = (id: string): FlowData | null => {
  return flowEngine.get(id);
};

/**
 * The flows list page's first pageful — the same read the thin
 * `GET /api/flows` route wraps, narrowed into the typed list rows
 * (`types/flows.ts`), handed to the client island as initial data.
 */
export const getFlowListData = (): FlowSummary[] => {
  return flowSummaries(flowEngine.list());
};
