import "server-only";

import { db } from "../../db/app";
import { ConflictError, ValidationError } from "../../errors";
import { ARTIFACT_STATUS } from "../constants/vocabulary";
import { NODE_KEYS } from "../constants/nodeKeys";
import { stepFlows } from "../runtime/fanout/stepFlowManager";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import { NodeRow } from "../../db/rows";
import { jsonInput, parseRow } from "@/lib/db/ormRowHelpers";
import type { FlowCtx } from "../nodes/shared/nodeSharedExports";
import type { ApprovalHost } from "./types/approvalHost";
import type { TriggerResult } from "../runtime/triggers/types/triggerGateway";

/**
 * FlowApprovalService — the user-approval paths carved out of the FlowEngine
 * facade (step 02): plan approval (with the execution-override chip), the
 * SDLC build approval, the generic node approval, and the decision branch
 * choice. Every status write goes through the transition authority's
 * declared table via the host's keyed wrapper; releasing downstream nodes is
 * the shared attribution + advance block all four paths funnel through.
 *
 * Must never: write node status outside the declared transitions, or carry
 * chain sequencing beyond what the template edges express (the chain lives in
 * `nodes/chains/sdlcChain.ts`).
 */
export class FlowApprovalService {
  constructor(private readonly host: ApprovalHost) {}

  async approvePlan(flowId: string, executionOverride?: 'whole' | 'steps'): Promise<TriggerResult> {
    const planKey = await this.host.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error('this flow template has no plan node');
    // the plan artifact must exist before anything is written — a missing
    // plan is a loud error, not an approval
    const plan = await this.host.latestResourceArtifact<{ id: string; content: string; meta: string | null }>(
      flowId,
      NODE_KEYS.PLAN
    );
    if (!plan) throw new Error('no plan to approve');
    // the approve transition's from-set IS the fence (step 06): a node not
    // awaiting approval loses here with the typed skip event — the old
    // status pre-read + ConflictError pair is gone. The transition lands
    // before the artifact bookkeeping so a stale panel click never flips
    // artifact states.
    const approved = await this.host.transitionTrigger({
      flowId,
      nodeKey: planKey,
      source: TRIGGER_SOURCE.UI,
      key: 'approve',
    });
    if (!approved.started) return approved;
    // Phase 3B: the plan panel's override chip — the user forced whole/steps
    // at approve. Recorded in the plan version's plan-meta (execution +
    // executionSource: "override") so a downstream from-plan fan-out node
    // honors it; every plan-meta field rides the artifact, so the override is
    // auditable per version. When the forced value equals the published one,
    // the approve is a no-op for the meta.
    if (executionOverride === 'whole' || executionOverride === 'steps') {
      const plan = await this.host.latestResourceArtifact<{ id: string; meta: string | null }>(flowId, NODE_KEYS.PLAN);
      if (!plan) throw new Error('no plan to approve');
      let meta: Record<string, unknown> = {};
      try {
        // plan-meta rides the artifact's JSONB `meta` column — already parsed
        // by the driver (Prisma); legacy string-encoded rows still parse
        const m = typeof plan.meta === 'string' ? JSON.parse(plan.meta) : plan.meta;
        if (m && typeof m === 'object' && !Array.isArray(m)) meta = m as Record<string, unknown>;
      } catch {
        meta = {};
      }
      const was = meta.execution === 'steps' ? 'steps' : 'whole';
      const wasSource = typeof meta.executionSource === 'string' ? meta.executionSource : 'unknown';
      if (was !== executionOverride) {
        meta.execution = executionOverride;
        meta.executionSource = 'override';
        delete meta.execution_rationale; // the planner's rationale no longer applies
        // (artifacts carry no updated_at column — the meta rewrite is the whole
        // write; updateMany keeps the raw write's no-op-on-missing-row
        // semantics). `meta` is an already-parsed object, so the ORM write
        // stores the object the old text→jsonb cast produced (no stringify
        // round-trip).
        await db.prisma.artifact.updateMany({ where: { id: plan.id }, data: { meta: jsonInput(meta) } });
        await this.host.emitLifecycle(
          flowId,
          planKey,
          `plan execution overridden at approve: will execute ${executionOverride} (was ${was}, ${wasSource})`,
          { nodeKey: planKey },
        );
      }
    }
    await db.prisma.artifact.updateMany({
      where: { id: plan.id },
      data: { status: ARTIFACT_STATUS.APPROVED },
    });

    // approvePlan originally inlined the plan→build handoff (plan-meta branch
    // decomposition, sequential builds). It now lives in the build node's
    // triggerRuns (a built-in internal) and is activated by the template edge
    // evaluation here.
    await this.releaseDownstream(flowId, planKey);
    return approved;
  }

  async approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    // step children route to the fan-out approve (merge-back, approve ≠ MR);
    // the parent's aggregate approval flows through the untouched chain below
    if (await this.host.isStepChild(flowId)) {
      await stepFlows.approveChildStep(flowId);
      return { started: true };
    }
    return this.host.chain.approveBuild(flowId, branchName);
  }

  /**
   * Approve an `awaiting_approval` node generically (approval-triggered
   * declarative nodes; e.g. an agent output held for review). Outgoing
   * template edges activate on approval — the same contract as plan/build.
   */
  async approveNode(flowId: string, nodeKey: string): Promise<TriggerResult> {
    const node = await this.nodeOf(flowId, nodeKey);
    // step children route to the fan-out approve (merge-back vs plain approval)
    if ((await this.host.isStepChild(flowId)) && node.status === 'awaiting_approval') {
      await stepFlows.approveChildStep(flowId);
      return { started: true };
    }
    const def = await this.host.defOf(flowId, nodeKey);
    if (def.builtinApproval) throw new ValidationError(`${nodeKey} approval belongs to its built-in flow actions`);
    // the approve transition's from-set IS the fence (step 06): a node not
    // awaiting approval loses here with the typed skip event
    const approved = await this.host.transitionTrigger({
      flowId,
      nodeKey,
      source: TRIGGER_SOURCE.UI,
      key: 'approve',
    });
    if (!approved.started) return approved;
    await this.releaseDownstream(flowId, nodeKey);
    return approved;
  }

  /**
   * Record a branch pick on a decision node awaiting its choice (§4.3 manual
   * source / approval-override): validates the labels against the node's
   * choices, marks the node approved with `{chosen, rationale}` output, and
   * activates the chosen outgoing edges (everything else resolves inactive).
   */
  async chooseNode(flowId: string, nodeKey: string, chosen: string[], rationale?: string): Promise<void> {
    const node = await this.nodeOf(flowId, nodeKey);
    if (node.status !== 'awaiting_approval') {
      throw new ConflictError(`${nodeKey} is not waiting for a branch choice`);
    }
    const def = await this.host.defOf(flowId, nodeKey);
    if (!('applyChoice' in def) || typeof (def as { applyChoice?: unknown }).applyChoice !== 'function') {
      throw new Error(`${nodeKey} is not a decision node`);
    }
    if (!Array.isArray(chosen) || !chosen.length) throw new Error('pick at least one branch');
    await (
      def as { applyChoice: (n: NodeRow, f: string, c: string[], r?: string, ctx?: FlowCtx) => Promise<void> }
    ).applyChoice(
      node,
      flowId,
      chosen.map(c => String(c)),
      rationale?.trim() || undefined,
      await this.host.ctx(flowId)
    );

    // release downstream exactly like a generic approval does
    await this.releaseDownstream(flowId, nodeKey);
  }

  private async nodeOf(flowId: string, nodeKey: string): Promise<NodeRow> {
    const row = await db.prisma.node.findFirst({ where: { flowId, nodeKey } });
    const node = row ? parseRow(NodeRow, row, `node ${nodeKey} for flow ${flowId}`) : null;
    if (!node) throw new ConflictError(`${nodeKey} not found in flow ${flowId}`);
    return node;
  }

  /**
   * Release the approved node's outgoing template edges. The run attribution
   * picks the first downstream node the engine will actually start (auto /
   * approval trigger) — errors in the release fail that node, not the
   * approval that already landed.
   */
  private async releaseDownstream(flowId: string, nodeKey: string): Promise<void> {
    const g = await this.host.graph(flowId);
    const targets = g?.edges.filter(e => e.kind === 'next' && e.from === nodeKey) ?? [];
    const attribution =
      targets
        .map(e => e.to)
        .find(k => {
          const tt = g?.byKey.get(k)?.trigger.type ?? 'auto';
          return tt === 'auto' || tt === 'approval';
        }) ?? nodeKey;
    this.host.bg(flowId, attribution, async () => {
      await this.host.advanceFrom(flowId, nodeKey);
    });
  }
}
