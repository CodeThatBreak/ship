import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { gitHostRegistry } from "../../../../lib/engine/ports/gitHost";
import { JobQueue } from "@/lib/engine/runtime/jobs/jobQueue";
import { WebhookDeliveryHandler } from "@/lib/engine/runtime/jobs/webhookDeliveryHandler";
import { JOB_KIND } from "@/lib/engine/runtime/jobs/constants/jobVocabulary";
import { gitlabDeliveryDedupKey } from "@/lib/engine/runtime/jobs/utils/jobDedupKeys";

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
 * GitLab retries deliveries that 5xx — dedup is journaled through the job
 * queue (step 03): a delivery carrying `X-Gitlab-Event-UUID` is enqueued
 * write-ahead (dedup key `gitlab:<uuid>`), claimed, dispatched, and marked
 * done; a retry with the same UUID answers `{ok, dedup: true}` instead of
 * re-ingesting.
 */
export const POST = async (req: Request) => {
  // first-use startup warning (the old instrumentation bootstrap's duty)
  config.gitlab.logStartupWarnings();
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

  const eventUuid = req.headers.get("x-gitlab-event-uuid")?.trim();
  if (!eventUuid) {
    // no UUID header (older GitLab / custom proxies) — dispatch directly
    await dispatchDirect(payload);
    return NextResponse.json({ ok: true });
  }

  const jobs = new JobQueue();
  const { id: jobId, deduplicated } = await jobs.enqueue({
    kind: JOB_KIND.WEBHOOK_DELIVERY,
    dedupKey: gitlabDeliveryDedupKey(eventUuid),
    payload: { source: "gitlab", body: payload },
  });
  if (deduplicated) return NextResponse.json({ ok: true, dedup: true });
  const job = await jobs.claimById(jobId);
  if (!job) return NextResponse.json({ ok: true, dedup: true });

  try {
    await new WebhookDeliveryHandler().handle(job);
    await jobs.complete(jobId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const delivery = await jobs.fail(jobId, msg);
    // Poison delivery → ALWAYS answer 200 with the queue's ownership verdict.
    // GitLab retries 5xx deliveries forever, which would double-drive our own
    // requeue (attempts/backoff live in the job queue). The trade BY DESIGN:
    // the failure is hidden from the sender's retry UI but loud in OUR event
    // feed — `jobs.fail` terminal-fails at JOB_LIMITS.MAX_ATTEMPTS and emits a
    // typed `error` event on the flow (kind + error in the message).
    return NextResponse.json({ ok: true, delivery });
  }
};

/** Direct (un-journaled) dispatch for deliveries without an event UUID. */
const dispatchDirect = async (payload: unknown): Promise<void> => {
  const host = gitHostRegistry.maybe("gitlab");
  if (!host) throw new Error("no gitlab host registered");
  const event = host.parseWebhook(payload);
  if (event) {
    const { flowEngine } = await import("@/lib/engine/flowEngine");
    await flowEngine.handleHostEvent(event);
  }
};
