import "server-only";

import crypto from "crypto";
import { Webhook } from "standardwebhooks";
import { db } from "../../db/app";
import { HookRow, rows } from "../../db/rows";
import { maskToken } from "../../maskToken";
import { processSingleton } from "../../singleton";

/**
 * Generic inbound webhook endpoints (Phase 4A, §6): the `hooks` table binds
 * an inbound delivery endpoint to either a flow template (`templateId` set ⇒
 * the delivery starts a new flow from it) or a waiting node instance
 * (`flowId` + `nodeKey` set ⇒ the delivery resumes the node).
 *
 * Verification is `standardwebhooks` when the sender follows the spec
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature` — OpenAI,
 * Anthropic, Supabase format); otherwise a shared-secret header fallback
 * (`x-devflow-secret`) with a constant-time compare plus required
 * `webhook-id` and `webhook-timestamp` (replay window). Provider-specific
 * schemes (GitLab token header, GitHub/Sentry HMAC) stay as tiny
 * per-provider verifiers next to their own routes.
 *
 * Hook secrets are masked in flow snapshots; the template editor and
 * `GET /api/hooks/:id/secret` reveal them on demand (CR-254). Deliveries are
 * deduped by the `webhook-id` header (TTL'd rows in `hook_deliveries`).
 */

const HEADER_NAMES = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;
const FALLBACK_HEADER = "x-devflow-secret";
const FALLBACK_TIMESTAMP_TOLERANCE_SEC = 5 * 60;
const DELIVERY_TTL_MS = 24 * 60 * 60_000; // webhook-ids are remembered for a day
const CLEANUP_INTERVAL_MS = 60 * 60_000;

/** A `whsec_`-prefixed random secret the standardwebhooks library accepts. */
function newSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64")}`;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

/** Unix seconds within the standardwebhooks tolerance window. */
function fallbackTimestampOk(raw: string): boolean {
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - ts) <= FALLBACK_TIMESTAMP_TOLERANCE_SEC;
}

const HOOK_SELECT = `SELECT id, template_id AS "templateId", flow_id AS "flowId",
       node_key AS "nodeKey", secret, filter, created_at AS "createdAt" FROM hooks`;

/** Masked hook secret for flow snapshots and other client polls (CR-254). */
export const maskHookSecret = (secret: string): string => maskToken(secret);

export class HookStore {
  // ── reads ────────────────────────────────────────────────────────────────

  hook(id: string): Promise<HookRow | undefined> {
    return rows.get(HookRow, `${HOOK_SELECT} WHERE id=$1`, id);
  }

  /** The hook that starts flows from a template (webhook flow trigger). */
  hookForTemplate(templateId: string): Promise<HookRow | undefined> {
    return rows.get(HookRow,
      `${HOOK_SELECT} WHERE template_id=$1 AND flow_id IS NULL`, templateId);
  }

  /** The hook that feeds a waiting node instance (wait_for webhook). */
  hookForNode(flowId: string, nodeKey: string): Promise<HookRow | undefined> {
    return rows.get(HookRow,
      `${HOOK_SELECT} WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
  }

  // ── provisioning (called from TemplateStore save paths + flow creation) ──

  /**
   * Sync a template's flow-trigger hook: every template gets one inbound
   * endpoint (webhook deliveries are always an available start lever — manual
   * task-picker starts and schedule fires are independent of it), copying the
   * trigger's JSONata filter on provision and updating whenever it changed.
   * The hook is removed only when the template is deleted (`removeTemplate`).
   * No-op for unknown templates.
   */
  async syncTemplate(templateId: string): Promise<void> {
    const tpl = await db.get<{ trigger: unknown; hidden: boolean }>(
      `SELECT trigger, hidden FROM flow_templates WHERE id=$1`, templateId);
    if (!tpl) return;
    if (tpl.hidden) return;
    const trigger = parseJson(tpl.trigger);
    const filter = typeof trigger.filter === "string" && trigger.filter.trim()
      ? trigger.filter.trim() : null;
    const existing = await this.hookForTemplate(templateId);
    if (!existing) {
      await db.run(
        `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
         VALUES ($1,$2,NULL,NULL,$3,$4,$5)`,
        db.uid("hk_"), templateId, newSecret(), filter, db.now()
      );
    } else if (existing.filter !== filter) {
      await db.run(`UPDATE hooks SET filter=$1 WHERE id=$2`, filter, existing.id);
    }
  }

  /** Remove a template's flow-trigger hook (template deleted). */
  async removeTemplate(templateId: string): Promise<void> {
    await db.run(`DELETE FROM hooks WHERE template_id=$1 AND flow_id IS NULL`, templateId);
  }

  /** The hook that feeds a waiting node (wait_for webhook) — find-or-create. */
  async ensureForNode(flowId: string, nodeKey: string): Promise<HookRow> {
    const existing = await this.hookForNode(flowId, nodeKey);
    if (existing) return existing;
    await db.run(
      `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
       VALUES ($1,NULL,$2,$3,$4,NULL,$5)`,
      db.uid("hk_"), flowId, nodeKey, newSecret(), db.now()
    );
    const hook = await this.hookForNode(flowId, nodeKey);
    if (!hook) throw new Error(`hook insert failed for flow ${flowId} node ${nodeKey}`);
    return hook;
  }

  /** The inbound hooks feeding this flow's waiting nodes. */
  hooksForFlow(flowId: string): Promise<HookRow[]> {
    return rows.all(HookRow,
      `${HOOK_SELECT} WHERE flow_id=$1 AND node_key IS NOT NULL ORDER BY created_at`, flowId);
  }

  // ── verification ─────────────────────────────────────────────────────────

  /**
   * Verify a delivery against a hook's secret. `payload` must be the exact
   * raw body the signature was computed over. Returns `{ok, reason?}`.
   */
  verify(
    hook: HookRow,
    payload: string,
    headers: Headers,
  ): { ok: boolean; reason?: string } {
    const h: Record<string, string> = {};
    for (const name of HEADER_NAMES) h[name] = headers.get(name) ?? "";
    if (h["webhook-id"] && h["webhook-timestamp"] && h["webhook-signature"]) {
      try {
        new Webhook(hook.secret).verify(payload, h);
        return { ok: true };
      } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e);
        return { ok: false, reason: `standardwebhooks verification failed — ${reason}` };
      }
    }
    // shared-secret header fallback (senders that don't follow the spec):
    // constant-time compare via sha256 digests (timingSafeEqual needs equal lengths),
    // plus webhook-id (dedup) and a fresh webhook-timestamp (replay window).
    const provided = headers.get(FALLBACK_HEADER) ?? "";
    const a = crypto.createHash("sha256").update(hook.secret).digest();
    const b = crypto.createHash("sha256").update(provided).digest();
    if (!provided || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "missing or bad signature headers" };
    }
    const webhookId = (headers.get("webhook-id") ?? "").trim();
    if (!webhookId) {
      return { ok: false, reason: "fallback verification requires webhook-id header" };
    }
    const webhookTimestamp = headers.get("webhook-timestamp") ?? "";
    if (!fallbackTimestampOk(webhookTimestamp)) {
      return { ok: false, reason: "fallback verification requires a current webhook-timestamp header" };
    }
    return { ok: true };
  }

  // ── dedup by webhook-id (TTL'd) ──────────────────────────────────────────

  private lastDeliveryCleanup = 0;

  private async maybeCleanupDeliveries(): Promise<void> {
    if (Date.now() - this.lastDeliveryCleanup <= CLEANUP_INTERVAL_MS) return;
    this.lastDeliveryCleanup = Date.now();
    await db.run(`DELETE FROM hook_deliveries WHERE created_at < $1`,
      new Date(Date.now() - DELIVERY_TTL_MS).toISOString());
  }

  /** Whether this `webhook-id` was already processed for the hook (replay dedup). */
  async isDeliverySeen(hookId: string, webhookId: string): Promise<boolean> {
    await this.maybeCleanupDeliveries();
    return Boolean(await db.get(
      `SELECT 1 FROM hook_deliveries WHERE hook_id=$1 AND webhook_id=$2`,
      hookId, webhookId));
  }

  /** Record a processed delivery id so retries with the same `webhook-id` dedup. */
  async markDeliverySeen(hookId: string, webhookId: string): Promise<void> {
    await this.maybeCleanupDeliveries();
    await db.run(
      `INSERT INTO hook_deliveries (hook_id,webhook_id,created_at) VALUES ($1,$2,$3)
       ON CONFLICT (hook_id, webhook_id) DO NOTHING`,
      hookId, webhookId, db.now()
    );
  }
}

/** Shared application hook store. */
export const hookStore = processSingleton("hookStore", () => new HookStore());
