import { NextResponse } from "next/server";
import { flowEngine } from "../../../../lib/engine/flow";
import { flowPoller } from "../../../../lib/engine/poller";
import { reconciler } from "../../../../lib/engine/reconcile";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  flowPoller.start();
  const { id } = await params;
  // Re-sync any node stuck in `running` with the real state of its agent run
  // (throttled internally). Fire-and-forget: state changes land via events,
  // which the page polls every 3s — never block the page load on this.
  void reconciler.reconcileFlow(id).catch(() => {});
  const data = flowEngine.get(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
