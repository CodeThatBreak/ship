import "server-only";

import { db } from "../../db/app";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { NODE_KEYS } from "../constants/nodeKeys";
import { nodeRegistry } from "../nodes/registry";
import { appLayerConfig, configNumber, mergeConfigLayers } from "../templates/nodeConfig";
import { templateStore } from "../templates/templateStore";
import { hookStore } from "./hookStore";
import { nodeStore } from "./nodeStore";
import type { WaitSchedulerHost } from "./flowEngineHost";

const NODE_ROW_SELECT = {
  id: true, flowId: true, nodeKey: true, type: true, status: true,
  attemptId: true, agentId: true, agentRef: true, sessionId: true,
  promptOverride: true, label: true, config: true, joinMode: true,
  input: true, output: true, createdAt: true, updatedAt: true,
} as const;

/** In-memory wait deadlines and webhook resume for `wait_for` triggers. */
export class WaitScheduler {
  private readonly waitTimers = new Map<string, number>();

  constructor(private readonly host: WaitSchedulerHost) {}

  clearTimersForFlows(flowIds: readonly string[]): void {
    for (const key of [...this.waitTimers.keys()]) {
      if (flowIds.some((fid) => key.startsWith(`${fid}\n`))) this.waitTimers.delete(key);
    }
  }

  async resolveScheduleAt(flowId: string): Promise<number | null> {
    const key = await this.debounceKey(flowId);
    return key ? this.waitTimers.get(`${flowId}\n${key}`) ?? null : null;
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
    const base = resolveDef ? appLayerConfig(resolveDef.key) : {};
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

  async armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): Promise<void> {
    const nodeStatus = await this.host.nodeStatus(flowId, nodeKey);
    if (nodeStatus !== "pending") return;
    if (wait === "timer" || wait === "comments") {
      const mins = minutes ?? (wait === "comments" ? 10 : 1);
      this.waitTimers.set(`${flowId}\n${nodeKey}`, Date.now() + mins * 60_000);
    }
    const hook = wait === "webhook" ? await hookStore.ensureForNode(flowId, nodeKey) : undefined;
    await this.host.setNodeStatus(flowId, nodeKey, "waiting");
    await nodeStore.emitEvent(
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

  async bounceCommentWaits(flowId: string): Promise<void> {
    const g = await templateStore.graphForFlow(flowId);
    if (!g) return;
    for (const spec of g.nodes) {
      if (spec.trigger.type !== "debounced" || spec.trigger.waitFor !== "comments") continue;
      if ((await this.host.nodeStatus(flowId, spec.key)) !== "waiting") continue;
      this.waitTimers.set(`${flowId}\n${spec.key}`, Date.now() + (await this.debounceMinutesForNode(flowId, spec.key, spec)) * 60_000);
    }
  }

  async reArmWaitingTimers(): Promise<void> {
    const waiting = await db.prisma.node.findMany({
      where: { status: "waiting", flow: { status: "active" } },
      select: NODE_ROW_SELECT,
    });
    for (const node of waiting) {
      const spec = (await templateStore.graphForFlow(node.flowId))?.byKey.get(node.nodeKey);
      if (!spec) continue;
      const updatedMs = node.updatedAt instanceof Date ? node.updatedAt.getTime() : Date.parse(String(node.updatedAt));
      const baseMs = Number.isFinite(updatedMs) ? updatedMs : Date.now();
      const tt = spec.trigger.type;
      const waitFor = spec.trigger.waitFor;
      if (tt === "debounced" && waitFor === "comments") {
        const mins = await this.debounceMinutesForNode(node.flowId, node.nodeKey, spec);
        this.waitTimers.set(`${node.flowId}\n${node.nodeKey}`, baseMs + mins * 60_000);
        continue;
      }
      if ((tt === "auto" || tt === "approval") && waitFor === "timer") {
        const mins = spec.trigger.minutes ?? 1;
        this.waitTimers.set(`${node.flowId}\n${node.nodeKey}`, baseMs + mins * 60_000);
      }
    }
  }

  async processWaitTimers(): Promise<void> {
    const now = Date.now();
    for (const [k, due] of [...this.waitTimers]) {
      if (now < due) continue;
      const i = k.indexOf("\n");
      const flowId = k.slice(0, i);
      const nodeKey = k.slice(i + 1);
      const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
      if (spec?.trigger.type === "debounced" && spec.trigger.waitFor === "comments") {
        const open = await db.prisma.comment.count({
          where: { flowId, status: "open" },
        });
        if (open === 0 || (await this.host.chainBusy(flowId))) {
          this.waitTimers.set(k, now + (await this.debounceMinutesForNode(flowId, nodeKey, spec)) * 60_000);
          continue;
        }
      }
      this.waitTimers.delete(k);
      await this.fireWaitTimer(flowId, nodeKey, spec?.trigger.type === "debounced" ? "quiet period elapsed" : undefined);
    }
  }

  async resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): Promise<void> {
    const node = await db.prisma.node.findFirst({
      where: { flowId, nodeKey },
      select: NODE_ROW_SELECT,
    });
    if (!node) throw new NotFoundError("node", nodeKey);
    const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
    if (spec?.trigger.waitFor !== "webhook") {
      throw new ValidationError(`${nodeKey} is not waiting on a webhook`);
    }
    if (node.status !== "waiting") throw new ConflictError(`${nodeKey} is not waiting for an event`);
    await this.host.claimNode(flowId, nodeKey, ["waiting"]);
    await db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} resumed by a webhook delivery`);
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, {
        resumeWaiting: true,
        rawInput: { payload, prompt: null, model: null },
        rawPayload: payload,
      }).then(() => {})
    );
  }

  private async fireWaitTimer(flowId: string, nodeKey: string, note?: string): Promise<void> {
    if ((await this.host.nodeStatus(flowId, nodeKey)) !== "waiting") return;
    try {
      await this.host.claimNode(flowId, nodeKey, ["waiting"]);
    } catch (e: unknown) {
      if (e instanceof ConflictError) return;
      throw e;
    }
    await nodeStore.emitEvent(
      flowId,
      nodeKey,
      "lifecycle",
      note ? `${nodeKey} ${note} — resuming` : `${nodeKey} timer elapsed — resuming`,
    );
    this.host.bg(flowId, nodeKey, () =>
      this.host.startNodeStage(flowId, nodeKey, { resumeWaiting: true }).then(() => {})
    );
  }

  private async debounceKey(flowId: string): Promise<string | null> {
    return (await templateStore.graphForFlow(flowId))?.nodes.find(
      (n) => n.trigger.type === "debounced" && n.trigger.waitFor === "comments",
    )?.key ?? null;
  }

  clearTimerForNode(flowId: string, nodeKey: string): void {
    this.waitTimers.delete(`${flowId}\n${nodeKey}`);
  }

  async debounceMinutesForNode(flowId: string, nodeKey: string, spec?: { trigger: { minutes?: number } }): Promise<number> {
    if (typeof spec?.trigger.minutes === "number" && spec.trigger.minutes >= 0) return spec.trigger.minutes;
    return configNumber(await this.host.nodeConfigFor(flowId, nodeKey), "quiet_minutes", 10);
  }
}
