import "server-only";

import { db } from "../../../db/app";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata/eval";
import { buildFlowContext } from "../../context/flowVariables";
import { isNodeTerminalSuccess } from "../transitions/constants/statusSets";
import type { TemplateEdgeSpec, TemplateGraph } from "../../templates/templateStore";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { StageRunnerHost } from "../flowEngineHost";
import type { EdgeActivationSource, IncomingResolution } from "./types/staging";

/**
 * ConditionEvaluator — edge activation, join evaluation and skip propagation
 * for the template graph (the staging cluster's decision half). A decision
 * source gates on `label ∈ chosen`; every other edge evaluates its JSONata
 * condition over the flow context (absent ⇒ active; a loop edge activates
 * only on an explicit truthy condition — the engine never picks an
 * unconditional rerun, §4.3). An inactive edge resolves its target side: a
 * target whose incoming edges are all resolved with none active becomes
 * `skipped`, and the skip propagates downstream.
 *
 * Invariants: every status read goes through the host (the authority's
 * door-backed reads); a broken condition resolves the edge inactive and says
 * so loudly on the advance path — the engine never silently picks a branch.
 *
 * Must never: start a stage (the StageRunner owns that), write status outside
 * the declared `skipBranch` transition, or re-evaluate a condition against
 * mutating state (the flow context only carries node outputs — stable once
 * terminal — so re-evaluation is deterministic).
 */
export class ConditionEvaluator {
  constructor(
    private readonly host: StageRunnerHost,
    private readonly events: TransitionEvents,
  ) {}

  /** The node_templates kind behind a template node spec (decision/agent/…/builtin). */
  async nodeKind(g: TemplateGraph, spec: { nodeTemplateId: string; defKey: string; catalogKind?: string }): Promise<string | null> {
    if (spec.catalogKind) return spec.catalogKind;
    const row = await db.prisma.nodeTemplate.findUnique({
      where: { id: spec.nodeTemplateId },
      select: { kind: true },
    });
    return row?.kind ?? null;
  }

  /** A decision node's chosen labels from its validated output ({} when absent). */
  async decisionChosen(flowId: string, nodeKey: string): Promise<string[]> {
    const node = await db.prisma.node.findFirst({
      where: { flowId, nodeKey },
      select: { output: true },
    });
    const chosen = (node?.output as { chosen?: unknown } | null)?.chosen;
    return Array.isArray(chosen) ? chosen.map((c) => String(c)) : [];
  }

  /**
   * One edge's active resolution. Decision sources gate on label ∈ chosen;
   * other edges evaluate their JSONata condition (absent ⇒ active). `loud`
   * emits an error event on a broken condition (the advance path); quiet
   * re-evaluations (join/skip checks) just resolve inactive.
   */
  async edgeActive(
    flowId: string,
    e: TemplateEdgeSpec,
    src: EdgeActivationSource,
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
    const r = await evalJsonata(e.condition, src.ctx ?? await buildFlowContext(await this.host.ctx(flowId)));
    if (!r.ok) {
      // a broken condition resolves the edge inactive and says so loudly —
      // the engine never silently picks a branch (§4.3)
      if (src.loud !== false) {
        await this.events.error(flowId, e.from,
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
  async incomingResolution(flowId: string, g: TemplateGraph, key: string): Promise<IncomingResolution> {
    const incoming = g.edges.filter((e) => e.kind === "next" && e.to === key);
    let resolved = 0;
    let active = 0;
    let flowCtx: unknown = null;
    let ctxBuilt = false;
    for (const e of incoming) {
      const src = g.byKey.get(e.from);
      if (!src) continue;
      const st = await this.host.nodeStatus(flowId, e.from);
      const srcSkipped = st === "skipped";
      if (!isNodeTerminalSuccess(st ?? "") && !srcSkipped) continue;
      resolved++;
      if (srcSkipped) continue; // skipped sources propagate inactive
      const srcKind = await this.nodeKind(g, src);
      if (srcKind !== "decision" && e.condition?.trim() && !ctxBuilt) {
        flowCtx = await buildFlowContext(await this.host.ctx(flowId));
        ctxBuilt = true;
      }
      const activeEdge = await this.edgeActive(flowId, e, {
        decision: srcKind === "decision",
        chosen: srcKind === "decision" ? await this.decisionChosen(flowId, e.from) : null,
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
  async resolveInactiveTarget(flowId: string, g: TemplateGraph, key: string): Promise<void> {
    if ((await this.host.nodeStatus(flowId, key)) !== "pending") return;
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0 || r.resolved !== r.total || r.active > 0) return;
    await this.host.setNodeStatus(flowId, key, "skipBranch");
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
}
