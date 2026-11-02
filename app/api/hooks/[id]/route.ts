import { toErrorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import { hookStore } from "../../../../lib/engine/runtime/hookStore";
import { flowEngine } from "../../../../lib/engine/flowEngine";
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
 *  - dedup by the `webhook-id` header when present (replays return ok/dedup)
 *  - optional JSONata filter over `{payload, headers}` — a failing or falsy
 *    filter drops the delivery
 *  - dispatch: `template_id` bound ⇒ start a new flow from that template
 *    (payload becomes `{{trigger.payload}}`); `flow_id` + `node_key` bound ⇒
 *    resume that waiting node (payload becomes its trigger input)
 *
 * Provider-specific schemes (GitLab token header, GitHub/Sentry HMAC) stay in
 * their own routes — the existing `/api/webhooks/gitlab` is untouched.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hook = hookStore.hook(id);
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

  const webhookId = req.headers.get("webhook-id") ?? "";
  if (webhookId && hookStore.isDeliverySeen(hook.id, webhookId)) {
    return NextResponse.json({ ok: true, dedup: true });
  }

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
      if (webhookId) hookStore.markDeliverySeen(hook.id, webhookId);
      return NextResponse.json({ ok: true, filtered: true });
    }
  }

  try {
    if (hook.template_id) {
      const flowId = flowEngine.startFromTemplate(hook.template_id, payload);
      if (webhookId) hookStore.markDeliverySeen(hook.id, webhookId);
      return NextResponse.json({ ok: true, flow_id: flowId });
    }
    if (hook.flow_id && hook.node_key) {
      flowEngine.resumeNodeFromWebhook(hook.flow_id, hook.node_key, payload);
      if (webhookId) hookStore.markDeliverySeen(hook.id, webhookId);
      return NextResponse.json({ ok: true, resumed: hook.node_key });
    }
    return NextResponse.json(
      { error: "hook is bound to nothing — rebind it to a template or a waiting node" },
      { status: 400 });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
}
