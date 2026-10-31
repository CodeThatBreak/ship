/**
 * Flow cockpit — server wrapper (§2.1): the id is resolved from the (Promise)
 * route params Next 15 hands page segments, and the flow's existence is
 * validated server-side through the engine service the thin API route wraps —
 * `notFound()` on a miss, no client guesswork. The initial snapshot is loaded
 * on the server and handed to the client island as its TanStack Query
 * `initialData`; the live parts (event stream, chat, node panels) render
 * client-side (see components/flows-cockpit).
 */
import { notFound } from "next/navigation";
import FlowCockpit from "@/components/flows/cockpit/FlowCockpit";
import { getFlowCockpitData } from "@/loaders/flows";

// the cockpit is live server data polling an append-only SQLite log — never
// prerendered (same as the API routes it mirrors)
export const dynamic = "force-dynamic";

export default async function FlowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialFlow = getFlowCockpitData(id);
  if (!initialFlow) notFound();
  // the id in the key resets the island's selection/event buffers on a
  // client-side navigation to a different flow (§2.6 key-reset)
  return <FlowCockpit key={id} flowId={id} initialFlow={initialFlow} />;
}

/**
 * Back-compat type re-exports: consumers historically import the flow payload
 * types from this page; the definitions moved to client-safe `types/flow.ts`
 * (Phase 0 guidance). New code imports from `@/types/flow` directly.
 */
export type {
  Artifact,
  Node,
  NodeCost,
  BranchRow,
  PlanStepRow,
  FlowData,
} from "@/types/flow";
