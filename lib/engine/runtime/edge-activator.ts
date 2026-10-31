import "server-only";

import { db } from "../../db";
import { NodeRow, rows, type NodeStatus } from "../../db/rows";
import { ConflictError } from "../../errors";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata";
import { buildFlowContext } from "../context/flow-variables";
import { isNodeTerminalSuccess, NODE_STATUS } from "../constants/node-status";
import { NodeDefinition, splitConsumeOf, type FlowCtx, type SplitConsumeMode } from "../nodes/shared";
import { nodeRegistry } from "../nodes/registry";
import { parseStartContract } from "../nodes/kinds/start/contract";
import { templateStore, type TemplateEdgeSpec, type TemplateGraph } from "../templates/template-store";
import { stepFlows } from "./fanout/step-flow-manager";
import { splitManager } from "./split/split-manager";
import { nodeStore } from "./node-store";
import type { EdgeActivatorHost } from "./flow-engine-host";
import type { WaitScheduler } from "./wait-scheduler";

/** Template edge activation, join/skip propagation, and auto-start stages. */
export class EdgeActivator {
  constructor(
    private readonly host: EdgeActivatorHost,
    private readonly waits: WaitScheduler,
  ) {}

  private graph(flowId: string): TemplateGraph | null {
    return templateStore.graphForFlow(flowId);
  }

  private inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Record<string, unknown> {
    const parents = (this.graph(flowId)?.edges ?? [])
      .filter((e) => e.kind === "next" && e.to === nodeKey)
      .map((e) => e.from);
    const nodesMap = buildFlowContext(ctx).nodes;
    const out: Record<string, unknown> = {};
    for (const p of parents) Object.assign(out, nodesMap[p]?.output ?? {});
    // split children (agent-node split plan §2.1): the own unit rides the run
    // input — `{{input.unit.*}}` — alongside any inherited parent outputs
    // (only split children carry a unit on their trigger payload)
    const payload = ctx.flow.trigger_payload as { unit?: unknown } | null;
    if (payload?.unit != null) out.unit = payload.unit;
    return out;
  }
  private splitGateSource(flowId: string, nodeKey: string): string | null {
    const mode = splitConsumeOf(this.host.nodeConfigFor(flowId, nodeKey));
    if (mode === "whole") return null;
    if (this.host.isStepChild(flowId)) return null; // nesting guard (§3)
    const g = this.graph(flowId);
    if (!g) return null;
    const sources = g.edges
      .filter((e) => e.kind === "next" && e.to === nodeKey)
      .map((e) => e.from)
      .filter((k) => {
        const def = this.host.defOf(flowId, k);
        return def.splitUnits !== NodeDefinition.prototype.splitUnits;
      });
    if (!sources.length) return null; // no upstream def publishes units — whole path
    if (sources.length > 1) {
      throw new Error(
        `${nodeKey} consumes split units but several upstream nodes publish them (${sources.join(", ")}) — route through one split source per consumer, or consume whole`);
    }
    const sourceKey = sources[0];
    const effective: SplitConsumeMode = mode === "per-unit"
      ? "per-unit" // explicit consumer choice wins over the recommendation (§2.4)
      : this.host.defOf(flowId, sourceKey).splitResolution(this.host.ctx(flowId)) ?? "whole"; // absent ⇒ whole
    return effective === "per-unit" ? sourceKey : null;
  }
  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    const g = this.graph(flowId);
    if (!g) return;
    const outgoing = g.edges.filter((e) => e.kind !== "loop" || e.condition?.trim())
      .filter((e) => e.from === fromKey);
    if (!outgoing.length) return;

    const fromSpec = g.byKey.get(fromKey);
    const fromNtKind = fromSpec ? this.nodeKind(g, fromSpec) : null;
    const chosen = fromNtKind === "decision" ? this.decisionChosen(flowId, fromKey) : null;
    const ctx = fromNtKind !== "decision" && outgoing.some((e) => e.condition?.trim())
      ? buildFlowContext(this.host.ctx(flowId)) : null;

    for (const e of outgoing) {
      const target = g.byKey.get(e.to);
      if (!target) continue;
      if (!(await this.edgeActive(flowId, e, { decision: fromNtKind === "decision", chosen, ctx }))) {
        await this.resolveInactiveTarget(flowId, g, e.to);
        continue;
      }
      if (!(await this.joinSatisfied(flowId, g, e.to))) continue;
      // loop-edge re-entry: the target (and its downstream success-terminal
      // path) resets to pending so the cycle runs again — see edgeActive's
      // loop rules
      if (e.kind === "loop") await this.resetLoopEntry(flowId, g, e.to);
      await this.startNodeStage(flowId, target.key);
    }
  }

  /**
   * Loop-edge entry: reset the target to `pending`, then every downstream
   * node along `next` edges that already holds a success terminal (done /
   * approved) — the re-entry rerun path (e.g. resolve → gate → review →
   * resolve). Nodes held elsewhere (pending/waiting/running/failed/
   * awaiting_approval) are never touched. Skipped branches from a prior
   * decision iteration reset too (CR-007).
   */
  private async resetLoopEntry(flowId: string, g: TemplateGraph, key: string): Promise<void> {
    const queue = [key];
    const seen = new Set(queue);
    while (queue.length) {
      const k = queue.shift();
      if (k === undefined) break;
      const st = this.host.nodeStatus(flowId, k);
      if (this.statusLoopResettable(st)) {
        this.host.setNodeStatus(flowId, k, "pending");
        nodeStore.emitEvent(flowId, k, "lifecycle", `${k} re-enters via the loop edge — reset to pending`);
        for (const e of g.edges.filter((e) => e.kind === "next" && e.from === k)) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            queue.push(e.to);
          }
        }
      }
    }
  }

  /** Loop re-entry clears success terminals and previously skipped branches. */
  private statusLoopResettable(s: string): boolean {
    return isNodeTerminalSuccess(s) || s === NODE_STATUS.SKIPPED;
  }

  /** The node_templates kind behind a template node spec (decision/agent/…/builtin). */
  private nodeKind(g: TemplateGraph, spec: { nodeTemplateId: string; defKey: string; catalogKind?: string }): string | null {
    if (spec.catalogKind) return spec.catalogKind;
    return db.get<{ kind: string }>(`SELECT kind FROM node_templates WHERE id=?`, spec.nodeTemplateId)?.kind ?? null;
  }

  /** A decision node's chosen labels from its validated output ({} when absent). */
  private decisionChosen(flowId: string, nodeKey: string): string[] {
    const out = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.output;
    const chosen = (out as { chosen?: unknown } | null)?.chosen;
    return Array.isArray(chosen) ? chosen.map((c) => String(c)) : [];
  }

  /**
   * One edge's active resolution. Decision sources gate on label ∈ chosen;
   * other edges evaluate their JSONata condition (absent ⇒ active). `loud`
   * emits an error event on a broken condition (the advance path); quiet
   * re-evaluations (join/skip checks) just resolve inactive.
   */
  private async edgeActive(
    flowId: string,
    e: TemplateEdgeSpec,
    src: { decision: boolean; chosen: string[] | null; ctx: unknown; loud?: boolean },
  ): Promise<boolean> {
    if (src.decision) {
      // a decision's out-edges carry labels; unlabeled edges never activate
      return e.label != null && (src.chosen ?? []).includes(e.label);
    }
    if (e.label != null) return false; // labels are only meaningful out of a decision
    if (e.kind === "loop") {
      // a loop edge is a re-entry edge: it activates only on an explicit truthy
      // condition — condition-less loop edges stay display metadata, and the
      // engine never picks an unconditional rerun (§4.3: no silent branches)
      if (!e.condition?.trim()) return false;
    }
    if (!e.condition?.trim()) return true;
    const r = await evalJsonata(e.condition, src.ctx ?? buildFlowContext(this.host.ctx(flowId)));
    if (!r.ok) {
      // a broken condition resolves the edge inactive and says so loudly —
      // the engine never silently picks a branch (§4.3)
      if (src.loud !== false) {
        db.emitEvent(flowId, null, "error",
          `edge ${e.from} → ${e.to}: the condition failed (${r.error}) — the branch resolves inactive`,
          { nodeKey: e.from });
      }
      return false;
    }
    return jsonataTruthy(r.value);
  }

  /**
   * The resolution state of a target's incoming `next` edges. An edge is
   * resolved when its source reached a terminal state (success or skipped);
   * it is active when the source succeeded AND the edge activates (decision ⇒
   * label ∈ chosen; condition ⇒ truthy; unlabeled plain edges ⇒ active).
   * Conditions re-evaluate quietly here — the flow context only carries node
   * outputs (stable once terminal), so re-evaluation is deterministic.
   */
  private async incomingResolution(flowId: string, g: TemplateGraph, key: string): Promise<{ total: number; resolved: number; active: number }> {
    const incoming = g.edges.filter((e) => e.kind === "next" && e.to === key);
    let resolved = 0;
    let active = 0;
    let flowCtx: unknown = null;
    let ctxBuilt = false;
    for (const e of incoming) {
      const src = g.byKey.get(e.from);
      if (!src) continue;
      const st = this.host.nodeStatus(flowId, e.from);
      const srcSkipped = st === "skipped";
      if (!isNodeTerminalSuccess(st) && !srcSkipped) continue;
      resolved++;
      if (srcSkipped) continue; // skipped sources propagate inactive
      const srcKind = this.nodeKind(g, src);
      if (srcKind !== "decision" && e.condition?.trim() && !ctxBuilt) {
        flowCtx = buildFlowContext(this.host.ctx(flowId));
        ctxBuilt = true;
      }
      const activeEdge = await this.edgeActive(flowId, e, {
        decision: srcKind === "decision",
        chosen: srcKind === "decision" ? this.decisionChosen(flowId, e.from) : null,
        ctx: flowCtx,
        loud: false,
      });
      if (activeEdge) active++;
    }
    return { total: incoming.length, resolved, active };
  }

  /**
   * An inactive edge resolved: when the target's incoming edges are now all
   * resolved with none active, the target becomes `skipped` and the skip
   * propagates to its own outgoing edges (§3: skipped propagation).
   */
  private async resolveInactiveTarget(flowId: string, g: TemplateGraph, key: string): Promise<void> {
    if (this.host.nodeStatus(flowId, key) !== "pending") return;
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0 || r.resolved !== r.total || r.active > 0) return;
    this.host.setNodeStatus(flowId, key, "skipped");
    nodeStore.emitEvent(flowId, key, "lifecycle", `${key} skipped — no active branch leads to it`);
    // skipped sources propagate inactive downstream
    for (const e of g.edges.filter((e) => e.kind === "next" && e.from === key)) {
      await this.resolveInactiveTarget(flowId, g, e.to);
    }
  }

  /**
   * Join evaluation for a target's incoming `next` edges: all-resolved with at
   * least one active (skipped sources propagate inactive), or first-active
   * for `any` targets.
   */
  async joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0) return true;
    const spec = g.byKey.get(key);
    if (spec?.joinMode === "any") return r.active > 0;
    return r.resolved === r.total && r.active > 0;
  }

  /**
   * Run one trigger's node stage inline (sequential `triggerRuns` bundle —
   * e.g. the multi-branch build), then advance past it when it reached a
   * success terminal. Manual triggers are never started here; debounced
   * targets arm their event-source wait.
   *
   * Phase 4B: an auto/approval node whose `wait_for` is `webhook` or `timer`
   * does not run when it becomes eligible — it holds at `waiting` until the
   * event source delivers (a hook bound to this (flow, node) at flow creation
   * / a poller-driven timer), then `resumeNodeFromWebhook` /
   * `processWaitTimers` re-enter this stage with `resumeWaiting`. A debounced
   * node with `wait_for: comments` holds the same way — the comment debounce
   * (reset-on-event while armed) fires it. The pipeline gate keeps its inline
   * role (it runs its own wait loop when it runs).
   *
   * `rawInput` overrides the def's `triggerRuns` — the webhook-resume path
   * passes the delivery body as the trigger input.
   *
   * A stage's own failure is contained: the failing node is marked failed and
   * the advance stops there — the error never propagates to the upstream node
   * whose edge activation started this stage (upstream stays done/approved;
   * the downstream failure carries its own failed status + Retry).
   */
  async startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean } = {},
  ): Promise<void> {
    const status = this.host.nodeStatus(flowId, nodeKey);
    if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;
    const spec = this.graph(flowId)?.byKey.get(nodeKey);
    const tt = spec?.trigger.type ?? "auto";
    const wait = spec?.trigger.wait_for;
    if (tt === "manual") return;
    if (tt === "debounced") {
      // a debounced node holds at `waiting` until its event source's quiet
      // period elapses (the generic wait-timer machinery fires it); without a
      // source it never auto-starts (the SDLC scheduler drives it)
      if (!opts.resumeWaiting) {
        if (wait === "comments") {
          this.waits.armNodeWait(flowId, nodeKey, wait, this.waits.debounceMinutesForNode(flowId, nodeKey, spec));
        }
        return;
      }
    }
    // an approval-triggered entry node holds for the user, not for an output
    // review: it publishes nothing until triggered, so the contract values are
    // provided when the user starts it (same entry as a manual entry node)
    if (tt === "approval" && spec?.defKey === nodeRegistry.entryKey() && parseStartContract(spec.config).length) return;
    if (!opts.resumeWaiting && (tt === "auto" || tt === "approval")) {
      // wait_for event sources gate eligibility (§6) — the pipeline source is
      // the built-in gate (it runs its own wait loop when it runs)
      if (wait === "webhook" || wait === "timer") {
        this.waits.armNodeWait(flowId, nodeKey, wait, spec?.trigger.minutes ?? null);
        return;
      }
    }
    const claimFrom: readonly NodeStatus[] = opts.resumeWaiting ? ["waiting"] : ["pending"];
    try {
      this.host.claimNode(flowId, nodeKey, claimFrom);
    } catch (e: unknown) {
      if (e instanceof ConflictError) return;
      throw e;
    }
    this.host.setCurrentNode(flowId, nodeKey);
    try {
      const def = this.host.defOf(flowId, nodeKey);
      // ── fan-out check (plan fan-out, Phase 1): the only engine hook into the
      // run path. When the node's effective config carries a fan-out knob that
      // resolves to "steps" AND pending checklist steps exist, the
      // StepFlowManager expands into child flows and owns this node (the
      // aggregate + terminal transition happen on all-resolved, via
      // finishFanout). `whole-wrap` runs the def's normal whole path and wraps
      // the native output as a single-entry aggregate afterwards. Anything
      // else (unchanged default, whole) falls through byte-for-byte. Built-ins
      // and declarative nodes hit the same check — orchestration lives here,
      // node internals stay in their classes.
      const fanout = stepFlows.gate(flowId, nodeKey);
      if (fanout === "fanout") {
        await stepFlows.expand(flowId, nodeKey);
        return;
      }
      // ── split gate (agent-node split plan §2.4, Phase 4): the consumer's
      // `split_consume` knob decides how it takes an upstream split source's
      // units. `whole` (or absent — every def's default) never reaches the
      // split runtime: the whole path below is byte-identical. The check sits
      // after the fan-out gate on purpose — a node whose fan-out knob engaged
      // keeps the existing fan-out behavior (documented conflict rule: the
      // plan-step fan-out predates the split runtime and is not migrated).
      // When expand() engages it parks the node `running`, advances the
      // scheduler, and the join publishes through finishSplit; a `false`
      // return (no units published / nested) falls through to the whole path.
      if (fanout != null) {
        // documented conflict rule (split plan §2.4, Phase 4): a node whose
        // fan-out knob engaged keeps the fan-out behavior — record a split
        // knob it shadows so the trail explains the run's shape
        const shadowed = splitConsumeOf(this.host.nodeConfigFor(flowId, nodeKey));
        if (shadowed !== "whole") {
          db.emitEvent(flowId, null, "lifecycle",
            `${nodeKey} ignores split_consume "${shadowed}" — the fan-out knob owns this run`,
            { nodeKey });
        }
      } else {
        const sourceKey = this.splitGateSource(flowId, nodeKey);
        if (sourceKey != null
          && splitManager.expand(flowId, nodeKey, sourceKey, { consume: "per-unit" })) {
          return;
        }
      }
      const runs =
        opts.rawInput !== undefined
          ? [{ input: opts.rawInput }]
          : // declarative nodes declare no input contract — the input IS the
            // previous node's output (merged when several edges feed in)
            def.inheritsParentInput
            ? [{ input: this.inheritedInput(flowId, nodeKey, this.host.ctx(flowId)) }]
            : def.triggerRuns(this.host.ctx(flowId));
      for (const run of runs) {
        run.before?.();
        await this.host.runNode(flowId, nodeKey, run.input, opts.rawPayload);
        run.after?.();
      }
      if (fanout === "whole-wrap") stepFlows.wrapWholeOutput(flowId, nodeKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(flowId, null, "error", msg, { nodeKey });
      db.run(
        `UPDATE nodes SET status='failed', attempt_id=NULL, updated_at=? WHERE flow_id=? AND node_key=? AND status='running'`,
        db.now(),
        flowId,
        nodeKey,
      );
      if (this.host.isStepChild(flowId)) {
        // notify hook: this failed stage runs on a step child — its parent's
        // rollup/scheduling reacts (standard failed → retry/skip)
        stepFlows.onChildFinished(flowId);
        splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
      }
      return;
    } finally {
      this.host.clearCurrentIf(flowId, nodeKey);
    }
    const finalStatus = this.host.nodeStatus(flowId, nodeKey);
    if (this.host.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): the parent manager
      // reschedules the next sibling / publishes the aggregate
      stepFlows.onChildFinished(flowId);
      splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
    }
    if (isNodeTerminalSuccess(finalStatus)) {
      await this.advanceFrom(flowId, nodeKey);
    }
  }
}
