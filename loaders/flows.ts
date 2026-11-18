import "server-only";
/**
 * Server-side data loaders for flow pages (§2.1: server components fetch
 * through the services the thin API routes wrap — never through self-fetch).
 *
 * Lives outside `app/**` / `components/**` because the Phase 0 lint zone
 * (docs/architecture/client-bundle-boundaries.md) restricts `lib/**` imports from those trees even
 * for server-only code; a loader module is the sanctioned importer (see the
 * pending lint-config note about server-zone exceptions).
 */
import { flowEngine } from "../lib/engine/flowEngine";
import { Reconciler } from "../lib/engine/runtime/reconcile/reconciler";
import type { FlowData } from "@/types/flow";
import { flowSummaries, type FlowSummary } from "@/types/flows";

/** The web process's reconcile pass (idempotent, DB-fenced — no lock needed). */
const reconciler = new Reconciler();

/**
 * The flow cockpit's initial snapshot — the same service read the thin
 * `GET /api/flows/:id` route wraps. Returns `null` when the flow doesn't
 * exist — the caller maps that to 404.
 *
 * Step 03: opening a flow also triggers the reconcile pass (fire-and-forget,
 * idempotent) — the UI recovers a crashed flow immediately instead of at the
 * next worker tick. User-initiated like every web-process claim, it shares
 * the same DB-fenced paths, so it needs no writer lock.
 */
export const getFlowCockpitData = async (id: string): Promise<FlowData | null> => {
  void reconciler.reconcileFlow(id).catch(() => {});
  return flowEngine.get(id);
};

/**
 * The flows list page's first pageful — the same read the thin
 * `GET /api/flows` route wraps, narrowed into the typed list rows
 * (`types/flows.ts`), handed to the client island as initial data.
 */
export const getFlowListData = async (): Promise<FlowSummary[]> => {
  return flowSummaries(await flowEngine.list());
};
