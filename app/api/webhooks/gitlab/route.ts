import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../lib/engine/ports/gitHost";
import { flowEngine } from "../../../../lib/engine/flowEngine";

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
export const POST = async (req: Request) => {
  const host = gitHostRegistry.maybe("gitlab");
  if (!host) return NextResponse.json({ error: "no gitlab host registered" }, { status: 500 });
  if (!host.verifyWebhook(req.headers)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  const payload: unknown = await req.json().catch(() => null);
  if (payload === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const event = host.parseWebhook(payload);
  if (!event) return NextResponse.json({ ok: true });

  flowEngine.handleHostEvent(event);
  return NextResponse.json({ ok: true });
};
