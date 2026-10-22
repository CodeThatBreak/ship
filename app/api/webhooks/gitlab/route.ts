import { NextResponse } from "next/server";
import { config } from "../../../../lib/config";
import { flowEngine } from "../../../../lib/engine/flow";
import { flowPoller } from "../../../../lib/engine/poller";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * GitLab webhook: Merge Request events (comments) + Pipeline events.
 * Configure in GitLab project → Settings → Webhooks:
 *   URL: https://<this-app>/api/webhooks/gitlab
 *   Secret token: GITLAB_WEBHOOK_SECRET
 *   Triggers: Merge request events, Comments, Pipeline events
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-gitlab-token");
  if (config.gitlab.webhookSecret() && secret !== config.gitlab.webhookSecret()) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  // scheduled resolves fire from the poller tick — make sure it's running even
  // in webhook-only setups where nobody has opened the UI yet (idempotent)
  flowPoller.start();
  const payload = await req.json();
  const kind = payload.object_kind;

  if (kind === "note") {
    // comment on an MR
    const mr = payload.merge_request;
    const projectId = payload.project?.id;
    if (mr && projectId) {
      const f = flowEngine.findFlowByMR(projectId, mr.iid, payload.project?.web_url ?? payload.project?.homepage);
      if (f) {
        const n = payload.object_attributes;
        flowEngine.ingestComments(f.id, [{
          id: n.discussion_id ?? `ind_${n.id}`,
          notes: [{
            id: n.id, body: n.note, author: payload.user,
            resolvable: n.type === "DiffNote", resolved: false, system: false,
            position: n.position ?? null, created_at: n.created_at,
          }],
        }]);
        const mins = Math.round(flowEngine.resolveDelayMs() / 60_000);
        db.emitEvent(f.id, null, "lifecycle",
          `new MR comment from ${payload.user?.username} — resolve queued (after the pipeline passes + ${mins} min quiet)`);
        // debounce: the poller tick fires the resolve once the quiet period
        // has elapsed and the pipeline step is done — not immediately
        flowEngine.scheduleResolve(f.id);
      }
    }
  } else if (kind === "pipeline") {
    const attrs = payload.object_attributes;
    const projectId = payload.project?.id;
    const mrIid = payload.merge_request?.iid;
    if (projectId && mrIid) {
      const f = flowEngine.findFlowByMR(projectId, mrIid, payload.project?.web_url ?? payload.project?.homepage);
      if (f) {
        // While the gate node is running it owns pipeline reporting; the
        // webhook only mirrors status when the gate is idle, then (re)triggers
        // the gate on a fresh failure (it guards against double-runs internally).
        const gateStatus = db.get<{ status: string }>(
          `SELECT status FROM nodes WHERE flow_id=? AND node_key='pipeline'`, f.id
        )?.status;
        if (gateStatus !== "running") {
          db.emitEvent(f.id, null, "pipeline", `pipeline ${attrs.status}`, { status: attrs.status, id: attrs.id });
        }
        if (attrs.status === "failed") flowEngine.triggerPipelineGate(f.id, attrs.id);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
