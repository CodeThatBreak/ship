import "server-only";

import crypto from "node:crypto";

import { Webhook } from "standardwebhooks";
import { db } from "../../../db/app";
import type { HookRow } from "../../../db/rows";
import type { Prisma } from "@prisma/client";
import {
  FALLBACK_HEADER,
  HEADER_NAMES,
} from "./constants/hookVerification";
import { fallbackTimestampOk } from "./utils/hookTimestampOk";
import { newSecret } from "./utils/newHookSecret";
import { parseJsonObject } from "./utils/parseJsonObject";

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
 * `GET /api/hooks/:id/secret` reveal them on demand (CR-254). Delivery
 * dedup is the job queue's write-ahead `dedup_key` (step 03, Invariant 7) —
 * a retried delivery re-enqueues into the same `webhook_delivery` job.
 */

export class HookStore {
  // ── reads ────────────────────────────────────────────────────────────────

  async hook(id: string): Promise<HookRow | undefined> {
    const row = await db.prisma.hook.findUnique({ where: { id } });
    return row ? this.toRow(row) : undefined;
  }

  /** The hook that starts flows from a template (webhook flow trigger). */
  async hookForTemplate(templateId: string, tx?: Prisma.TransactionClient): Promise<HookRow | undefined> {
    const row = await (tx ?? db.prisma).hook.findFirst({
      where: { templateId, flowId: null },
    });
    return row ? this.toRow(row) : undefined;
  }

  /** The hook that feeds a waiting node instance (wait_for webhook). */
  async hookForNode(flowId: string, nodeKey: string, tx?: Prisma.TransactionClient): Promise<HookRow | undefined> {
    const row = await (tx ?? db.prisma).hook.findFirst({
      where: { flowId, nodeKey },
    });
    return row ? this.toRow(row) : undefined;
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
  async syncTemplate(templateId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const tpl = await (tx ?? db.prisma).flowTemplate.findUnique({
      where: { id: templateId },
      select: { trigger: true, hidden: true },
    });
    if (!tpl) return;
    if (tpl.hidden) return;
    const trigger = parseJsonObject(tpl.trigger);
    const filter = typeof trigger.filter === "string" && trigger.filter.trim()
      ? trigger.filter.trim() : null;
    const existing = await this.hookForTemplate(templateId);
    if (!existing) {
      await (tx ?? db.prisma).hook.create({
        data: {
          id: db.uid("hk_"),
          templateId,
          secret: newSecret(),
          filter,
          createdAt: new Date(),
        },
      });
    } else if (existing.filter !== filter) {
      await (tx ?? db.prisma).hook.update({
        where: { id: existing.id },
        data: { filter },
      });
    }
  }

  /** Remove a template's flow-trigger hook (template deleted). */
  async removeTemplate(templateId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? db.prisma).hook.deleteMany({ where: { templateId, flowId: null } });
  }

  /** The hook that feeds a waiting node (wait_for webhook) — find-or-create. */
  async ensureForNode(flowId: string, nodeKey: string, tx?: Prisma.TransactionClient): Promise<HookRow> {
    const client = tx ?? db.prisma;
    const existing = await this.hookForNode(flowId, nodeKey);
    if (existing) return existing;
    await client.hook.create({
      data: {
        id: db.uid("hk_"),
        flowId,
        nodeKey,
        secret: newSecret(),
        createdAt: new Date(),
      },
    });
    const hook = await client.hook.findFirst({ where: { flowId, nodeKey } });
    if (!hook) throw new Error(`hook insert failed for flow ${flowId} node ${nodeKey}`);
    return this.toRow(hook);
  }

  /** The inbound hooks feeding this flow's waiting nodes. */
  async hooksForFlow(flowId: string): Promise<HookRow[]> {
    const rows = await db.prisma.hook.findMany({
      where: { flowId, nodeKey: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => this.toRow(row));
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

  // ── dedup (write-ahead jobs — step 03, Invariant 7) ─────────────────────

  /** Prisma row → shared `HookRow` shape (ISO timestamp; no JSONB payloads on hooks). */
  private toRow(row: {
    id: string;
    templateId: string | null;
    flowId: string | null;
    nodeKey: string | null;
    secret: string;
    filter: string | null;
    createdAt: Date;
  }): HookRow {
    return {
      id: row.id,
      templateId: row.templateId,
      flowId: row.flowId,
      nodeKey: row.nodeKey,
      secret: row.secret,
      filter: row.filter,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
