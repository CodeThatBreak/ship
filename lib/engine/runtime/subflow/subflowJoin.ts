import "server-only";

import { db } from "../../../db/app";
import { FLOW_STATUS } from "../../../../constants/flow";
import { NODE_STATUS } from "../../constants/nodeStatus";
import {
  isNodeTerminalSuccess,
  NODE_TERMINAL_STATUSES,
} from "../transitions/constants/statusSets";
import { engineParts } from "@/lib/composition/container";
import { evalJsonata } from "@/lib/jsonata/eval";
import { subflowDefOf } from "./utils/subflowDefOf";
import { isRecord } from "./utils/isRecord";
import type { SubflowEngineSurface } from "./types/subflowEngineSurface";

/**
 * SubflowJoin — the subflow runtime's terminal rollup (task 26): when the
 * ONE delegated child flow reaches its terminal, the child's terminal output
 * (or the declared `pass` mapping over it) publishes as the parent node's
 * aggregate. Reached only through the registered `onChildTerminal` effect
 * (Invariant 8: an effect owns the follow-on) — the publish continues into
 * the edge evaluation on a success terminal, exactly like the fan-out and
 * split aggregates.
 *
 * Invariants upheld:
 * - The linkage is derived, never guessed: a child links when its payload
 *   carries the runtime's `subflow` marker (contract-free children), or when
 *   the parent's RUNNING declarative-subflow node's `child` config names the
 *   child's template (contract-declared children — their payload is
 *   contract-clean and cannot carry envelope keys). Fan-out step children
 *   (the `{plan, step, siblings}` payload shape) never match.
 * - The publish is fenced: only a RUNNING parent publishes (a stale child
 *   terminal after the user retried loses silently — the same
 *   `publishAggregate` fence the fan-out/split aggregates ride), reinforced
 *   by the expand-time attempt token.
 * - A held child (`awaiting_approval`) publishes nothing — the parent waits
 *   for the child's real terminal, so the aggregate is always the child's
 *   terminal output.
 *
 * Must never:
 * - write `nodes.status` outside the authority (the aggregate publishes only
 *   through `engineParts.transitions.publishAggregate`);
 * - create, expand or start children (the `SubflowExpander` owns expansion);
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `SubflowEngineSurface`).
 */
export class SubflowJoin {
  constructor(private readonly engine: () => SubflowEngineSurface) {}

  private get e(): SubflowEngineSurface {
    return this.engine();
  }

  /** Expand-time attempt tokens, keyed by child flow id — the aggregate
   *  publish is attempt-fenced (a stale terminal loses to the user's
   *  re-claim; the same durability story as the fan-out/split tokens). */
  private readonly childAttempts = new Map<string, string>();

  /** The expander records the parent claim's attempt token per child. */
  captureAttempt(childFlowId: string, attemptId: string): void {
    this.childAttempts.set(childFlowId, attemptId);
  }

  /**
   * Notification hook — the `onChildTerminal` effect body. No-op unless the
   * flow is a terminal subflow child with a resolvable owner (two cheap
   * reads for every other child in the engine), then publishes the parent's
   * aggregate.
   */
  async onChildFinished(childFlowId: string): Promise<void> {
    const flow = await db.prisma.flow.findUnique({
      where: { id: childFlowId },
      select: { parentFlowId: true, kind: true, status: true, templateId: true, triggerPayload: true },
    });
    if (!flow?.parentFlowId || flow.kind !== "step") return;
    if (!(await this.isTerminalChild(flow.status, childFlowId))) return;
    const owner = await this.ownerOf(flow.parentFlowId, childFlowId, flow.templateId, flow.triggerPayload);
    if (!owner) return; // no linkage (or already published / ambiguous) — nothing this runtime owns
    await this.publish(flow.parentFlowId, owner, childFlowId, flow.status);
  }

  /** Fully terminal child: every node terminal, or the flow itself closed. */
  private async isTerminalChild(flowStatus: string, childFlowId: string): Promise<boolean> {
    if (flowStatus === FLOW_STATUS.DONE || flowStatus === FLOW_STATUS.SKIPPED) return true;
    const statuses = (await db.prisma.node.findMany({
      where: { flowId: childFlowId },
      select: { status: true },
    })).map((n) => n.status);
    return statuses.length > 0 && statuses.every((s) => NODE_TERMINAL_STATUSES.includes(s));
  }

  /**
   * The parent node instance that owns a terminal child: the payload's
   * marker names it exactly when present; otherwise the parent's RUNNING
   * declarative-subflow nodes whose `child` config names the child's
   * template — exactly one must match (zero = no linkage or the aggregate
   * already published; several = an ambiguous graph, which fails loudly in
   * the trail instead of guessing).
   */
  private async ownerOf(
    parentFlowId: string,
    childFlowId: string,
    childTemplateId: string | null,
    triggerPayload: unknown,
  ): Promise<string | null> {
    const payload = isRecord(triggerPayload) ? triggerPayload : {};
    const marker = isRecord(payload.subflow) ? payload.subflow : null;
    if (marker && typeof payload.parentNodeKey === "string" && payload.parentNodeKey) {
      return payload.parentNodeKey;
    }
    if (childTemplateId == null) return null;
    const running = await db.prisma.node.findMany({
      where: { flowId: parentFlowId, status: NODE_STATUS.RUNNING },
      select: { nodeKey: true },
    });
    const owners: string[] = [];
    for (const node of running) {
      const def = await this.e.defOf(parentFlowId, node.nodeKey);
      if (!def.subflowDelegation) continue; // §T3 metadata routing — only the subflow def delegates
      const cfg = subflowDefOf(await this.e.nodeConfigFor(parentFlowId, node.nodeKey), node.nodeKey);
      if (cfg.child === childTemplateId) owners.push(node.nodeKey);
    }
    if (owners.length > 1) {
      await db.emitEvent(parentFlowId, null, "lifecycle",
        `subflow: child ${childFlowId} matches several running subflow nodes (${owners.join(", ")}) — publish skipped, disambiguate the child templates`,
        { childFlowId, owners });
      return null;
    }
    return owners[0] ?? null;
  }

  /** The child's merged node outputs (last write wins per key; null when none). */
  private async childOutput(childFlowId: string): Promise<Record<string, unknown> | null> {
    const outs = await db.prisma.node.findMany({
      where: { flowId: childFlowId },
      orderBy: { updatedAt: "asc" },
      select: { output: true },
    });
    const merged: Record<string, unknown> = {};
    let any = false;
    for (const row of outs) {
      if (row.output == null) continue;
      try {
        const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(merged, parsed);
          any = true;
        } else if (parsed != null) {
          merged.markdown = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          any = true;
        }
      } catch { /* unparseable output column — skipped */ }
    }
    return any ? merged : null;
  }

  /**
   * Publish the parent's aggregate: the child's terminal output as-is, or
   * the declared `pass` mapping (field → JSONata over the child output) when
   * one is declared. The child's failure publishes a failed terminal — the
   * delegated work failed, so the parent node fails with it.
   */
  private async publish(parentFlowId: string, nodeKey: string, childFlowId: string, flowStatus: string): Promise<void> {
    const cfg = subflowDefOf(await this.e.nodeConfigFor(parentFlowId, nodeKey), nodeKey);
    const childOut = await this.childOutput(childFlowId);
    let output: Record<string, unknown>;
    if (Object.keys(cfg.pass).length) {
      const mapped: Record<string, unknown> = {};
      for (const [field, expr] of Object.entries(cfg.pass)) {
        const r = await evalJsonata(expr, childOut ?? {});
        if (!r.ok) {
          throw new Error(`subflow: pass.${field} ("${expr}") failed — ${r.error}`);
        }
        if (r.value !== undefined) mapped[field] = r.value;
      }
      output = mapped;
    } else {
      output = childOut ?? {};
    }
    const failed = flowStatus === FLOW_STATUS.FAILED || await this.childNodesFailed(childFlowId);
    const tt = (await this.e.graph(parentFlowId))?.byKey.get(nodeKey)?.trigger.type ?? "auto";
    const status = failed
      ? NODE_STATUS.FAILED
      : tt === "approval" ? NODE_STATUS.AWAITING_APPROVAL : NODE_STATUS.DONE;
    const published = await engineParts.transitions.publishAggregate(parentFlowId, nodeKey, "subflowOutcome", {
      status,
      output,
      attemptId: this.childAttempts.get(childFlowId) ?? null,
      detail: `subflow resolved — the child's terminal output published as the aggregate${status === NODE_STATUS.FAILED ? " · the child failed" : ""}`,
    });
    if (!published) return;
    await this.e.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.e.advanceFrom(parentFlowId, nodeKey);
    }
  }

  /** The child failed: any failed node. */
  private async childNodesFailed(childFlowId: string): Promise<boolean> {
    const statuses = (await db.prisma.node.findMany({
      where: { flowId: childFlowId },
      select: { status: true },
    })).map((n) => n.status);
    return statuses.some((s) => s === NODE_STATUS.FAILED);
  }
}
