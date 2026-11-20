import "server-only";

import { TRIGGER_SOURCE } from "../triggers/constants/triggerSources";
import { db } from "../../../db/app";
import { NotFoundError, ValidationError } from "../../../errors";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { nodeRegistry } from "../../nodes/registry";
import { appLayerConfig, configNumber, mergeConfigLayers } from "../../templates/nodeConfig";
import { templateStore } from "../../templates/templateStore";
import { hookStore } from "../hookStore";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { WaitStoreHost } from "../flowEngineHost";

/**
 * WaitStore — durable `wait_for` waits (Invariant 2, step 03). Every wait
 * deadline lives on `nodes.wait_until`: armed by the `armWait` transition
 * (through the authority, in the same statement as the status write),
 * bounced by comment activity, and swept by comparing `wait_until <= now()`
 * on DB-server time. There is no in-memory timer map and therefore no
 * re-arm-on-restart heuristic — a fresh process (or the worker) resumes a
 * wait by sweeping the table.
 *
 * Claim-then-fire ordering (the original resume bug): firing a wait must NOT
 * claim the node here — the claim and the stage run live together in
 * `StageRunner.startNodeStage` (its `resumeWait` claim), so the pair can
 * never split across modules again. This class only guards (`waiting`?),
 * announces, and hands the stage over.
 *
 * Must never: write `nodes.status`/`attempt_id` (the authority owns both),
 * compare a deadline against app-server time, or leave a deadline armed when
 * the node leaves `waiting` (the authority's transitions clear `wait_until`).
 */
export class WaitStore {
  constructor(
    private readonly host: WaitStoreHost,
    private readonly events: TransitionEvents,
  ) {}

  /**
   * The armed wait deadline of the flow's debounced resolve node (epoch ms),
   * read from the durable row — the Resolve panel's scheduled start.
   */
  async resolveScheduleAt(flowId: string): Promise<number | null> {
    const key = await this.debounceKey(flowId);
    if (!key) return null;
    const row = await db.prisma.node.findFirst({
      where: { flowId, nodeKey: key },
      select: { waitUntil: true },
    });
    return row?.waitUntil instanceof Date ? row.waitUntil.getTime() : null;
  }

  async resolveScheduleClock(flowId: string): Promise<string | null> {
    const at = await this.resolveScheduleAt(flowId);
    if (at == null) return null;
    return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  async resolveScheduleLabel(flowId: string): Promise<string> {
    return (await this.resolveScheduleClock(flowId))
      ?? new Date(Date.now() + (await this.resolveDelayMs(flowId))).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
  }

  async resolveDelayMs(flowId?: string): Promise<number> {
    const resolveDef = nodeRegistry.all().find((d) => d.chainRole === NODE_KEYS.RESOLVE);
    const base = resolveDef ? await appLayerConfig(resolveDef.key) : {};
    if (!flowId || !resolveDef) {
      return configNumber(mergeConfigLayers(base), "quiet_minutes", 10) * 60_000;
    }
    const resolveKey = (await templateStore.graphForFlow(flowId))?.nodes
      .find((n) => n.defKey === resolveDef.key)?.key
      ?? (await db.prisma.node.findFirst({
        where: { flowId, type: resolveDef.key },
        select: { nodeKey: true },
      }))?.nodeKey
      ?? null;
    const cfg = mergeConfigLayers(
      base,
      resolveKey ? await this.host.nodeConfigFor(flowId, resolveKey) : {},
    );
    return configNumber(cfg, "quiet_minutes", 10) * 60_000;
  }

  /**
   * Arm a `wait_for` wait on a pending node: the `armWait` transition moves
   * it to `waiting` and stamps `wait_until` in the same conditional UPDATE.
   * Timer/comments waits carry a deadline (app clock at arm time — only the
   * sweep compares, and it compares on DB time); webhook waits are indefinite
   * (`wait_until` stays null) and bind an inbound hook instead.
   */
  async armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): Promise<void> {
    const nodeStatus = await this.host.nodeStatus(flowId, nodeKey);
    if (nodeStatus !== "pending") return;
    const hook = wait === "webhook" ? await hookStore.ensureForNode(flowId, nodeKey) : undefined;
    const patch: Record<string, unknown> = {};
    if (wait === "timer" || wait === "comments") {
      const mins = minutes ?? (wait === "comments" ? 10 : 1);
      patch.wait_until = new Date(Date.now() + mins * 60_000);
    }
    // the authority announces the arm with the wait-specific detail line
    await this.host.setNodeStatus(flowId, nodeKey, "armWait", {
      patch,
      detail:
        wait === "timer"
          ? `waits for a timer (${minutes ?? 1} min — the poller resumes it)`
          : wait === "comments"
          ? `waits for the comment quiet period (${minutes ?? 10} min — new comments restart it; the poller fires it when the gate is clear)`
          : `waits for a webhook delivery — POST to /api/hooks/${hook?.id ?? "(hook unbound)"}`,
    });
  }

  /**
   * Restart the comment quiet period: every waiting debounced node's
   * `wait_until` moves to `now() + debounce minutes` (DB-server time). Each
   * new open comment calls this — the resolve only fires once the flow has
   * been quiet for the configured delay.
   */
  async bounceCommentWaits(flowId: string): Promise<void> {
    const g = await templateStore.graphForFlow(flowId);
    if (!g) return;
    for (const spec of g.nodes) {
      if (spec.trigger.type !== "debounced" || spec.trigger.waitFor !== "comments") continue;
      if ((await this.host.nodeStatus(flowId, spec.key)) !== "waiting") continue;
      await db.run(
        `UPDATE nodes SET wait_until = now() + make_interval(mins => $1), updated_at = now()
         WHERE flow_id=$2 AND node_key=$3`,
        await this.debounceMinutesForNode(flowId, spec.key, spec),
        flowId,
        spec.key,
      );
    }
  }

  /**
   * Sweep every due durable wait (of active flows — optionally one flow) and
   * fire it. This is the poller tick's wait driver, the reconciler's
   * expired-wait action, AND the "restart resume": the deadline is in the
   * table, so a fresh process picks up exactly where the dead one left off.
   * The comments-debounce gate re-defers while comments are still open or
   * the chain is busy (the resolve only fires on a quiet flow).
   */
  async sweepDueWaits(flowId?: string): Promise<void> {
    const due = await db.all<{ flowId: string; nodeKey: string }>(
      `SELECT n.flow_id AS "flowId", n.node_key AS "nodeKey" FROM nodes n
       JOIN flows f ON f.id = n.flow_id
       WHERE n.wait_until <= now() AND f.status='active' AND n.status='waiting'
         AND ($1::text IS NULL OR n.flow_id=$1)`,
      flowId ?? null,
    );
    for (const { flowId, nodeKey } of due) {
      const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
      if (spec?.trigger.type === "debounced" && spec.trigger.waitFor === "comments") {
        const open = await db.prisma.comment.count({
          where: { flowId, status: "open" },
        });
        if (open === 0 || (await this.host.chainBusy(flowId))) {
          await db.run(
            `UPDATE nodes SET wait_until = now() + make_interval(mins => $1), updated_at = now()
             WHERE flow_id=$2 AND node_key=$3`,
            await this.debounceMinutesForNode(flowId, nodeKey, spec),
            flowId,
            nodeKey,
          );
          continue;
        }
      }
      await this.fire(flowId, nodeKey, spec?.trigger.type === "debounced" ? "quiet period elapsed" : undefined);
    }
  }

  /**
   * Resume a webhook-waiting node from an inbound delivery. Validates the
   * binding, announces, and hands the stage to `startNodeStage` — the claim
   * (and the run it fences) happen there, in one owner.
   */
  async resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): Promise<void> {
    const node = await db.prisma.node.findFirst({
      where: { flowId, nodeKey },
      select: { status: true },
    });
    if (!node) throw new NotFoundError("node", nodeKey);
    const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
    if (spec?.trigger.waitFor !== "webhook") {
      throw new ValidationError(`${nodeKey} is not waiting on a webhook`);
    }
    if (node.status !== "waiting") {
      // a concurrent delivery already resumed it — the delivery is done
      return;
    }
    await this.events.lifecycle(flowId, nodeKey, `${nodeKey} resumed by a webhook delivery`);
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, {
        resumeWaiting: true,
        rawInput: { payload, prompt: null, model: null },
        rawPayload: payload,
        source: TRIGGER_SOURCE.WEBHOOK,
      }).then(() => {})
    );
  }

  /**
   * Fire a due wait: guard on `waiting`, announce, and hand the stage to
   * `startNodeStage` (its `resumeWait` claim + run are one owner — the
   * original stranding bug was a pre-claim here that made the stage's own
   * claim conflict and silently return).
   */
  private async fire(flowId: string, nodeKey: string, note?: string): Promise<void> {
    if ((await this.host.nodeStatus(flowId, nodeKey)) !== "waiting") return;
    await this.events.lifecycle(
      flowId,
      nodeKey,
      note ? `${nodeKey} ${note} — resuming` : `${nodeKey} timer elapsed — resuming`,
    );
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, { resumeWaiting: true, source: TRIGGER_SOURCE.POLLER }).then(() => {})
    );
  }

  private async debounceKey(flowId: string): Promise<string | null> {
    return (await templateStore.graphForFlow(flowId))?.nodes.find(
      (n) => n.trigger.type === "debounced" && n.trigger.waitFor === "comments",
    )?.key ?? null;
  }

  async debounceMinutesForNode(flowId: string, nodeKey: string, spec?: { trigger: { minutes?: number } }): Promise<number> {
    if (typeof spec?.trigger.minutes === "number" && spec?.trigger.minutes >= 0) return spec.trigger.minutes;
    return configNumber(await this.host.nodeConfigFor(flowId, nodeKey), "quiet_minutes", 10);
  }
}
