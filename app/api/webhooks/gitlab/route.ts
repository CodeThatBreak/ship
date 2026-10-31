import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../lib/engine/ports/git-host";
import { flowEngine } from "../../../../lib/engine/flow-engine";
import { flowPoller } from "../../../../lib/engine/runtime/flow-poller";
import { templateStore } from "../../../../lib/engine/templates/template-store";
import { db } from "../../../../lib/db";

function flowScheduleFallback(delayMs: number): string {
  return new Date(Date.now() + delayMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GitLab webhook: Merge Request events (comments) + Pipeline events.
 * Configure in GitLab project → Settings → Webhooks:
 *   URL: https://<this-app>/api/webhooks/gitlab
 *   Secret token: GITLAB_WEBHOOK_SECRET
 *   Triggers: Merge request events, Comments, Pipeline events
 *
 * A thin route: the host adapter normalizes the delivery, the engine reacts
 * (comment ingest + quiet-period resolve, pipeline re-gate) off the event.
 */
export async function POST(req: Request) {
  const host = gitHostRegistry.maybe("gitlab");
  if (!host) return NextResponse.json({ error: "no gitlab host registered" }, { status: 500 });
  const payload = await req.json();
  if (!host.verifyWebhook(req.headers)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  // scheduled resolves fire from the poller tick — make sure it's running even
  // in webhook-only setups where nobody has opened the UI yet (idempotent)
  flowPoller.start();
  const event = host.parseWebhook(payload);
  if (!event) return NextResponse.json({ ok: true }); // event kind the engine ignores

  if (event.kind === "cr_comment") {
    const f = flowEngine.findFlowByMR(event.projectId, event.crNumber, event.projectUrl);
    if (f) {
      flowEngine.ingestComments(f.id, [event.comment]);
      const mins = Math.round(flowEngine.resolveDelayMs(f.id) / 60_000);
      // debounce: the comment restarts the debounced resolve's quiet period —
      // the wait-timer tick fires the resolve once quiet + the gate is clear
      flowEngine.bounceCommentWaits(f.id);
      db.emitEvent(f.id, null, "lifecycle",
        `new MR comment from ${event.comment.author || "a reviewer"} — resolve queued for ` +
        `${flowEngine.resolveScheduleClock(f.id) ?? flowScheduleFallback(flowEngine.resolveDelayMs(f.id))} ` +
        `(${mins} min quiet, then the pipeline gate)`,
        { nodeKey: templateStore.waitNodeKey(f.id, "comments") ?? undefined });
      // debounce: the poller tick fires the resolve once the quiet period
      // has elapsed and the pipeline step is done — not immediately
    }
  } else {
    const f = event.crNumber
      ? flowEngine.findFlowByMR(event.projectId, event.crNumber, event.projectUrl)
      : undefined;
    if (f) {
      // While the gate node is running it owns pipeline reporting; the
      // webhook only mirrors status when the gate is idle, then (re)triggers
      // the gate on a fresh failure (it guards against double-runs internally).
      // The gate is the node waiting on the pipeline event (role lookup).
      const gateKey = templateStore.waitNodeKey(f.id, "pipeline");
      const gateStatus = gateKey
        ? db.get<{ status: string }>(
            `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, f.id, gateKey
          )?.status
        : undefined;
      if (gateStatus !== "running") {
        db.emitEvent(f.id, null, "pipeline", `pipeline ${event.pipeline.status}`,
          { status: event.pipeline.status, id: event.pipeline.id, nodeKey: gateKey ?? undefined });
      }
      if (event.pipeline.status === "failed") flowEngine.triggerPipelineGate(f.id, event.pipeline.id);
    }
  }
  return NextResponse.json({ ok: true });
}
