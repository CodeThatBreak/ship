import "server-only";

import { db } from "../../db";
import { NodeRow, rows } from "../../db/rows";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { NODE_KEYS } from "../constants/node-keys";
import { nodeRegistry } from "../nodes/registry";
import { appLayerConfig, configNumber, mergeConfigLayers } from "../templates/node-config";
import { templateStore } from "../templates/template-store";
import { hookStore } from "./hook-store";
import { nodeStore } from "./node-store";
import type { WaitSchedulerHost } from "./flow-engine-host";

/** In-memory wait deadlines and webhook resume for `wait_for` triggers. */
export class WaitScheduler {
  private readonly waitTimers = new Map<string, number>();

  constructor(private readonly host: WaitSchedulerHost) {}

  clearTimersForFlows(flowIds: readonly string[]): void {
    for (const key of [...this.waitTimers.keys()]) {
      if (flowIds.some((fid) => key.startsWith(`${fid}\n`))) this.waitTimers.delete(key);
    }
  }

  resolveScheduleAt(flowId: string): number | null {
    const key = this.debounceKey(flowId);
    return key ? this.waitTimers.get(`${flowId}\n${key}`) ?? null : null;
  }

  resolveScheduleClock(flowId: string): string | null {
    const at = this.resolveScheduleAt(flowId);
    if (at == null) return null;
    return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  resolveScheduleLabel(flowId: string): string {
    return this.resolveScheduleClock(flowId)
      ?? new Date(Date.now() + this.resolveDelayMs(flowId)).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
  }

  resolveDelayMs(flowId?: string): number {
    const resolveDef = nodeRegistry.all().find((d) => d.chainRole === NODE_KEYS.RESOLVE);
    const base = resolveDef ? appLayerConfig(resolveDef.key) : {};
    if (!flowId || !resolveDef) {
      return configNumber(mergeConfigLayers(base), "quiet_minutes", 10) * 60_000;
    }
    const resolveKey = templateStore.graphForFlow(flowId)?.nodes
      .find((n) => n.defKey === resolveDef.key)?.key
      ?? rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, flowId)
        .find((n) => n.type === resolveDef.key)?.node_key
      ?? null;
    const cfg = mergeConfigLayers(
      base,
      resolveKey ? this.host.nodeConfigFor(flowId, resolveKey) : {},
    );
    return configNumber(cfg, "quiet_minutes", 10) * 60_000;
  }

  armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): void {
    if (this.host.nodeStatus(flowId, nodeKey) !== "pending") return;
    if (wait === "timer" || wait === "comments") {
      const mins = minutes ?? (wait === "comments" ? 10 : 1);
      this.waitTimers.set(`${flowId}\n${nodeKey}`, Date.now() + mins * 60_000);
    }
    const hook = wait === "webhook" ? hookStore.ensureForNode(flowId, nodeKey) : undefined;
    this.host.setNodeStatus(flowId, nodeKey, "waiting");
    nodeStore.emitEvent(
      flowId,
      nodeKey,
      "lifecycle",
      wait === "timer"
        ? `${nodeKey} waits for a timer (${minutes ?? 1} min — the poller resumes it)`
        : wait === "comments"
        ? `${nodeKey} waits for the comment quiet period (${minutes ?? 10} min — new comments restart it; the poller fires it when the gate is clear)`
        : `${nodeKey} waits for a webhook delivery — POST to /api/hooks/${hook?.id ?? "(hook unbound)"}`,
    );
  }

  bounceCommentWaits(flowId: string): void {
    const g = templateStore.graphForFlow(flowId);
    if (!g) return;
    for (const spec of g.nodes) {
      if (spec.trigger.type !== "debounced" || spec.trigger.wait_for !== "comments") continue;
      if (this.host.nodeStatus(flowId, spec.key) !== "waiting") continue;
      this.waitTimers.set(`${flowId}\n${spec.key}`, Date.now() + this.debounceMinutesForNode(flowId, spec.key, spec) * 60_000);
    }
  }

  reArmWaitingTimers(): void {
    const waiting = rows.all(
      NodeRow,
      `SELECT n.* FROM nodes n
       INNER JOIN flows f ON f.id = n.flow_id
       WHERE n.status='waiting' AND f.status='active'`,
    );
    for (const node of waiting) {
      const spec = templateStore.graphForFlow(node.flow_id)?.byKey.get(node.node_key);
      if (!spec) continue;
      const updatedMs = Date.parse(node.updated_at ?? "");
      const baseMs = Number.isFinite(updatedMs) ? updatedMs : Date.now();
      const tt = spec.trigger.type;
      const waitFor = spec.trigger.wait_for;
      if (tt === "debounced" && waitFor === "comments") {
        const mins = this.debounceMinutesForNode(node.flow_id, node.node_key, spec);
        this.waitTimers.set(`${node.flow_id}\n${node.node_key}`, baseMs + mins * 60_000);
        continue;
      }
      if ((tt === "auto" || tt === "approval") && waitFor === "timer") {
        const mins = spec.trigger.minutes ?? 1;
        this.waitTimers.set(`${node.flow_id}\n${node.node_key}`, baseMs + mins * 60_000);
      }
    }
  }

  processWaitTimers(): void {
    const now = Date.now();
    for (const [k, due] of [...this.waitTimers]) {
      if (now < due) continue;
      const i = k.indexOf("\n");
      const flowId = k.slice(0, i);
      const nodeKey = k.slice(i + 1);
      const spec = templateStore.graphForFlow(flowId)?.byKey.get(nodeKey);
      if (spec?.trigger.type === "debounced" && spec.trigger.wait_for === "comments") {
        const open = db.get<{ c: number }>(
          `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
        if (open === 0 || this.host.chainBusy(flowId)) {
          this.waitTimers.set(k, now + this.debounceMinutesForNode(flowId, nodeKey, spec) * 60_000);
          continue;
        }
      }
      this.waitTimers.delete(k);
      this.fireWaitTimer(flowId, nodeKey, spec?.trigger.type === "debounced" ? "quiet period elapsed" : undefined);
    }
  }

  resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    const spec = templateStore.graphForFlow(flowId)?.byKey.get(nodeKey);
    if (spec?.trigger.wait_for !== "webhook") {
      throw new ValidationError(`${nodeKey} is not waiting on a webhook`);
    }
    if (node.status !== "waiting") throw new ConflictError(`${nodeKey} is not waiting for an event`);
    this.host.claimNode(flowId, nodeKey, ["waiting"]);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} resumed by a webhook delivery`);
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, {
        resumeWaiting: true,
        rawInput: { payload, prompt: null, model: null },
        rawPayload: payload,
      }).then(() => {})
    );
  }

  private fireWaitTimer(flowId: string, nodeKey: string, note?: string): void {
    if (this.host.nodeStatus(flowId, nodeKey) !== "waiting") return;
    try {
      this.host.claimNode(flowId, nodeKey, ["waiting"]);
    } catch (e: unknown) {
      if (e instanceof ConflictError) return;
      throw e;
    }
    nodeStore.emitEvent(
      flowId,
      nodeKey,
      "lifecycle",
      note ? `${nodeKey} ${note} — resuming` : `${nodeKey} timer elapsed — resuming`,
    );
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, { resumeWaiting: true }).then(() => {})
    );
  }

  private debounceKey(flowId: string): string | null {
    return templateStore.graphForFlow(flowId)?.nodes.find(
      (n) => n.trigger.type === "debounced" && n.trigger.wait_for === "comments",
    )?.key ?? null;
  }

  clearTimerForNode(flowId: string, nodeKey: string): void {
    this.waitTimers.delete(`${flowId}\n${nodeKey}`);
  }

  debounceMinutesForNode(flowId: string, nodeKey: string, spec?: { trigger: { minutes?: number } }): number {
    if (typeof spec?.trigger.minutes === "number" && spec.trigger.minutes >= 0) return spec.trigger.minutes;
    return configNumber(this.host.nodeConfigFor(flowId, nodeKey), "quiet_minutes", 10);
  }
}
