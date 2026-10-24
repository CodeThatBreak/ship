#!/usr/bin/env node
/**
 * Send a delivery to a DevFlow hook endpoint (§6) — the manual verification
 * path for webhook triggers and wait_for-webhook nodes.
 *
 * Usage:
 *   node scripts/send-hook.mjs <url> <secret> [json-body] [--raw]
 *
 *   <url>      e.g. http://localhost:3000/api/hooks/<hook_id>
 *   <secret>   the hook's whsec_... secret (shown in the template editor)
 *   json-body  the delivery body (becomes {{trigger.payload}}), default {"ping":true}
 *   --raw      use the shared-secret header fallback (x-devflow-secret)
 *              instead of signing per the standardwebhooks spec
 */
import { Webhook } from "standardwebhooks";

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const positional = args.filter((a) => a !== "--raw");
const [url, secret, body = '{"ping":true}'] = positional;

if (!url || !secret) {
  console.error("usage: node scripts/send-hook.mjs <url> <secret> [json-body] [--raw]");
  process.exit(1);
}

const headers = { "content-type": "application/json" };

if (raw) {
  headers["x-devflow-secret"] = secret;
} else {
  const wh = new Webhook(secret);
  const msgId = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = new Date();
  headers["webhook-id"] = msgId;
  headers["webhook-timestamp"] = String(Math.floor(timestamp.getTime() / 1000));
  headers["webhook-signature"] = wh.sign(msgId, timestamp, body);
}

try {
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  console.log(`${res.status} ${text || "(empty)"}`);
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.error(`send failed: ${e.message}`);
  process.exit(1);
}
