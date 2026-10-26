import "server-only";

import crypto from "crypto";
import { Webhook } from "standardwebhooks";
import { db } from "../db";
import { HookRow, rows } from "../db/rows";
import { processSingleton } from "../singleton";

/**
 * Generic inbound webhook endpoints (Phase 4A, §6): the `hooks` table binds
 * an inbound delivery endpoint to either a flow template (`template_id` set ⇒
 * the delivery starts a new flow from it) or a waiting node instance
 * (`flow_id` + `node_key` set ⇒ the delivery resumes the node).
 *
 * Verification is `standardwebhooks` when the sender follows the spec
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature` — OpenAI,
 * Anthropic, Supabase format); otherwise a shared-secret header fallback
 * (`x-devflow-secret`) with a constant-time compare. Provider-specific
 * schemes (GitLab token header, GitHub/Sentry HMAC) stay as tiny
 * per-provider verifiers next to their own routes.
 *
 * Hook secrets are displayable (unlike settings secrets) — the sender needs
 * them to sign payloads. Deliveries are deduped by the `webhook-id` header
 * (TTL'd rows in `hook_deliveries`).
 */

const HEADER_NAMES = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;
const FALLBACK_HEADER = "x-devflow-secret";
const DELIVERY_TTL_MS = 24 * 60 * 60_000; // webhook-ids are remembered for a day
const CLEANUP_INTERVAL_MS = 60 * 60_000;

/** A `whsec_`-prefixed random secret the standardwebhooks library accepts. */
function newSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64")}`;
}

function parseJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export class HookStore {
  // ── reads ────────────────────────────────────────────────────────────────

  hook(id: string): HookRow | undefined {
    return rows.get(HookRow, `SELECT * FROM hooks WHERE id=?`, id);
  }

  /** The hook that starts flows from a template (webhook flow trigger). */
  hookForTemplate(templateId: string): HookRow | undefined {
    return rows.get(HookRow,
      `SELECT * FROM hooks WHERE template_id=? AND flow_id IS NULL`, templateId);
  }

  /** The hook that feeds a waiting node instance (wait_for webhook). */
  hookForNode(flowId: string, nodeKey: string): HookRow | undefined {
    return rows.get(HookRow,
      `SELECT * FROM hooks WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
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
  syncTemplate(templateId: string): void {
    const tpl = db.get<{ trigger: string | null }>(
      `SELECT trigger FROM flow_templates WHERE id=?`, templateId);
    if (!tpl) return;
    const trigger = parseJson(tpl.trigger);
    const filter = typeof trigger.filter === "string" && trigger.filter.trim()
      ? trigger.filter.trim() : null;
    const existing = this.hookForTemplate(templateId);
    if (!existing) {
      db.run(
        `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
         VALUES (?,?,NULL,NULL,?,?,?)`,
        db.uid("hk_"), templateId, newSecret(), filter, db.now()
      );
    } else if (existing.filter !== filter) {
      db.run(`UPDATE hooks SET filter=? WHERE id=?`, filter, existing.id);
    }
  }

  /** Remove a template's flow-trigger hook (template deleted). */
  removeTemplate(templateId: string): void {
    db.run(`DELETE FROM hooks WHERE template_id=? AND flow_id IS NULL`, templateId);
  }

  /** The hook that feeds a waiting node (wait_for webhook) — find-or-create. */
  ensureForNode(flowId: string, nodeKey: string): HookRow {
    const existing = this.hookForNode(flowId, nodeKey);
    if (existing) return existing;
    db.run(
      `INSERT INTO hooks (id,template_id,flow_id,node_key,secret,filter,created_at)
       VALUES (?,NULL,?,?,?,NULL,?)`,
      db.uid("hk_"), flowId, nodeKey, newSecret(), db.now()
    );
    return this.hookForNode(flowId, nodeKey)!;
  }

  /** The inbound hooks feeding this flow's waiting nodes (Phase 4B). */
  hooksForFlow(flowId: string): HookRow[] {
    return rows.all(HookRow,
      `SELECT * FROM hooks WHERE flow_id=? AND node_key IS NOT NULL ORDER BY created_at`, flowId);
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
    // constant-time compare via sha256 digests (timingSafeEqual needs equal lengths)
    const provided = headers.get(FALLBACK_HEADER) ?? "";
    const a = crypto.createHash("sha256").update(hook.secret).digest();
    const b = crypto.createHash("sha256").update(provided).digest();
    if (!provided || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "missing or bad signature headers" };
    }
    return { ok: true };
  }

  // ── dedup by webhook-id (TTL'd) ──────────────────────────────────────────

  private lastDeliveryCleanup = 0;

  /**
   * Whether a delivery with this `webhook-id` was already seen for the hook —
   * records the id on first sight (the delivery is processed, so a replay
   * with the same id must not dispatch again).
   */
  deliverySeen(hookId: string, webhookId: string): boolean {
    if (Date.now() - this.lastDeliveryCleanup > CLEANUP_INTERVAL_MS) {
      this.lastDeliveryCleanup = Date.now();
      db.run(`DELETE FROM hook_deliveries WHERE created_at < ?`,
        new Date(Date.now() - DELIVERY_TTL_MS).toISOString());
    }
    const seen = Boolean(db.get(
      `SELECT 1 FROM hook_deliveries WHERE hook_id=? AND webhook_id=?`,
      hookId, webhookId));
    if (!seen) {
      db.run(
        `INSERT OR IGNORE INTO hook_deliveries (hook_id,webhook_id,created_at) VALUES (?,?,?)`,
        hookId, webhookId, db.now()
      );
    }
    return seen;
  }
}

/** Shared application hook store. */
export const hookStore = processSingleton("hookStore", () => new HookStore());
