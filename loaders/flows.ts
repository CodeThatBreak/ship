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
import { flowPoller } from "../lib/engine/runtime/flow-poller";
import { reconciler } from "../lib/engine/runtime/flow-reconciler";
import type { FlowData } from "@/types/flow";
import { flowSummaries, type FlowSummary } from "@/types/flows";

/**
 * The flow cockpit's initial snapshot — the same service + lifecycle the thin
 * `GET /api/flows/:id` route wraps: poller activation and a throttled stuck-run
 * reconcile (fire-and-forget, never blocking the render), then the flow read.
 *
 * Returns `null` when the flow doesn't exist — the caller maps that to 404.
 */
export function getFlowCockpitData(id: string): FlowData | null {
  flowPoller.start();
  // state changes land via the client island's event polling; this merge just
  // converges any stuck `running` node before the first paint
  void reconciler.reconcileFlow(id).catch(() => {});
  // the engine's snapshot is the exact JSON payload the API route serializes —
  // the client types mirror it (types/flow.ts)
  return flowEngine.get(id) as unknown as FlowData | null;
}

/**
 * The flows list page's first pageful — the same read the thin
 * `GET /api/flows` route wraps, narrowed into the typed list rows
 * (`types/flows.ts`), handed to the client island as initial data.
 */
export function getFlowListData(): FlowSummary[] {
  // the background poller feeds active flows' status — started by the API
  // route too; keeping it here covers the server-render-first path
  flowPoller.start();
  return flowSummaries(flowEngine.list());
}
