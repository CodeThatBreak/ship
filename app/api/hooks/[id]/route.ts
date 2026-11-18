import { toErrorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import { hookStore } from "../../../../lib/engine/runtime/hookStore";
import { JobQueue } from "@/lib/engine/runtime/jobs/jobQueue";
import { WebhookDeliveryHandler } from "@/lib/engine/runtime/jobs/webhookDeliveryHandler";
import { JOB_KIND } from "@/lib/engine/runtime/jobs/constants/jobVocabulary";
import { hookDeliveryDedupKey } from "@/lib/engine/runtime/jobs/utils/jobDedupKeys";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata/eval";
import { readCappedUtf8Body, RequestBodyTooLargeError } from "@/lib/net/readCappedBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** §6: 1 MB payload cap. */
const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * Generic inbound webhook (§6): `POST /api/hooks/<hook_id>`.
 *
 *  - raw-body read (signature verification is body-sensitive), capped at 1 MB
 *    by byte count with an early Content-Length reject
 *  - verification: `standardwebhooks` spec headers when the sender follows it
 *    (webhook-id / webhook-timestamp / webhook-signature — OpenAI, Anthropic,
 *    Supabase format); otherwise the shared-secret `x-devflow-secret` header
 *    fallback (also requires webhook-id and webhook-timestamp for replay control)
 *  - optional JSONata filter over `{payload, headers}` — a failing or falsy
 *    filter drops the delivery
 *  - dispatch is journaled through the job queue (step 03, Invariant 7):
 *    write-ahead insert (dedup key `hook:<hookId>:<webhook-id>`), atomic
 *    claim, dispatch, mark done. A crash between dispatch and done leaves a
 *    claimed job whose lease expiry re-claims it — and the resume claim
 *    itself dedups the side effect. Retried deliveries with the same
 *    `webhook-id` answer `{ok, dedup: true}`.
 *  - dispatch: `template_id` bound ⇒ start a new flow from that template
 *    (payload becomes `{{trigger.payload}}`); `flow_id` + `node_key` bound ⇒
 *    resume that waiting node (payload becomes its trigger input)
 *
 * Provider-specific schemes (GitLab token header, GitHub/Sentry HMAC) stay in
 * their own routes — the existing `/api/webhooks/gitlab` is untouched.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hook = await hookStore.hook(id);
  if (!hook) return NextResponse.json({ error: "unknown hook" }, { status: 404 });

  let raw: string;
  try {
    raw = await readCappedUtf8Body(req, MAX_PAYLOAD_BYTES);
  } catch (e: unknown) {
    if (e instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "payload too large (1 MB cap)" }, { status: 413 });
    }
    throw e;
  }

  const v = hookStore.verify(hook, raw, req.headers);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 401 });

  let payload: unknown;
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { payload = raw; }
  // the JSONata filter sees the delivery body and the request headers — its
  // result is only ever the boolean drop decision, never persisted
  if (hook.filter) {
    const headers: Record<string, string> = {};
    req.headers.forEach((val, key) => { headers[key] = val; });
    const r = await evalJsonata(hook.filter, { payload, headers });
    if (!r.ok) return NextResponse.json({ error: `hook filter failed — ${r.error}` }, { status: 400 });
    if (!jsonataTruthy(r.value)) {
      return NextResponse.json({ ok: true, filtered: true });
    }
  }

  // write-ahead journal: enqueue, then claim — whoever wins the claim
  // dispatches exactly once (a retried delivery re-enqueues into the same row)
  const jobs = new JobQueue();
  const webhookId = req.headers.get("webhook-id") ?? "";
  const { id: jobId, deduplicated } = await jobs.enqueue({
    kind: JOB_KIND.WEBHOOK_DELIVERY,
    flowId: hook.flowId,
    dedupKey: webhookId ? hookDeliveryDedupKey(hook.id, webhookId) : null,
    payload: {
      source: "hook",
      hookId: hook.id,
      templateId: hook.templateId,
      flowId: hook.flowId,
      nodeKey: hook.nodeKey,
      body: payload,
    },
  });
  if (deduplicated) return NextResponse.json({ ok: true, dedup: true });
  const job = await jobs.claimById(jobId);
  if (!job) return NextResponse.json({ ok: true, dedup: true });

  try {
    const result = await new WebhookDeliveryHandler().handle(job);
    await jobs.complete(jobId);
    if (result.startedFlowId) {
      return NextResponse.json({ ok: true, flow_id: result.startedFlowId });
    }
    if (result.resumedNodeKey) {
      return NextResponse.json({ ok: true, resumed: result.resumedNodeKey });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    await jobs.fail(jobId, e instanceof Error ? e.message : String(e));
    return toErrorResponse(e);
  }
}
