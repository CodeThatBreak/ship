import "server-only";

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import type { FlowRow } from "../../../db/rows";
import { templateStore, type TemplateGraph } from "../../templates/templateStore";
import { nodeRegistry } from "../../nodes/registry";
import { NODE_KEYS } from "../../constants/nodeKeys";
import {
  childFlowHasStarted,
  isNodeStarted,
  NODE_CANCELABLE_STATUSES,
  NODE_STATUS,
  NODE_TERMINAL_STATUSES,
} from "../../constants/nodeStatus";
import { nodeStore } from "../nodeStore";
import type { ChainRole, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import {
  DEFAULT_FANOUT_OUTPUT,
  type NodeCapabilities,
} from "../../nodes/shared/capabilities";
import { parseStartContract, validateAgainstContract } from "../../nodes/kinds/start/contract";
import { prompts } from "../../prompts/promptLibrary";
import { branchStore } from "../../nodes/kinds/build/branchStore";
import { flowCtxHelper, type FlowCtx } from "../../nodes/shared/runContext";
import { branchNamer } from "../../nodes/shared/branchNamer";
import { nodeSupport } from "../../nodes/shared/nodeSupport";
import { planSteps, type PlanStepRow } from "../planStepStore";
import { configNumber, configString, fanoutOf, parseConfigSnapshot, stripFanoutKeys, type FanoutKnob } from "../../templates/nodeConfig";
import { mergeArena } from "./mergeArena";
import { worktreeManager } from "../worktreeLifecycle";
import { processSingleton } from "../../../singleton";

// ── plan fan-out: the StepFlowManager (Phase 1) ──────────────────────────────
// State authority for the fan-out knob (`fanout.mode != whole` on any node
// downstream of a plan): one real child flow per pending plan step, each
// running that node's work with step-scoped input (the `{plan, step,
// siblings}` trigger payload, persisted on the child flow), monitorable and
// approvable on its own flow screen, aggregated back into the parent node's
// output contract on all-resolved.
//
// The engine stays template-generic: this module is a built-in internal
// consumed by the fan-out check in `FlowEngine.startNodeStage` (a small hook),
// the child-terminal hooks, and the approve/skip actions. Children are
// ordinary flows created through the narrower `flowEngine.createStepChild`
// (the snapshot machinery of create(), minus the standalone start-contract /
// task-type validation) — which is what lets the existing per-flow machinery
// (agent runners, chat, artifacts, retry/cancel, reconcile) work on children
// with no changes.
//
// Scheduling (Phase 3A): qualification + parallelism. `advance()` starts
// unstarted children up to `parallel_max` (default 1 = today's sequential
// behavior, byte-for-byte). A child occupies a slot while its node is
// `running` OR `awaiting_approval` (an approved-but-unmerged code child's
// work product is still outstanding — its successor would build against a
// branch that has not absorbed the merge; the per-branch arena lock + the
// stale-base machinery absorb the divergence when slots are genuinely
// parallel). Qualification: a candidate may join the in-flight set only when
// its `files` are disjoint from every overlapping earlier sibling that is in
// flight (empty `files` ⇒ overlap ⇒ sequential — no evidence of
// independence), including failed earlier CODE siblings (a failed code child
// stalls its overlapping neighbours — they'd build against a missing branch);
// failed NON-code children never block siblings. Merge attempts remain
// serialized by the merge arena's per-branch lock (FIFO — merges land in
// approval order; step order when the user approves in step order; an
// out-of-order landing is repaired by a merge commit via the stale-base
// path, never a rebase).
//
// Sibling context (Phase 3A): a child's persisted trigger payload is
// refreshed at start time — the `{plan, step, siblings}` payload's sibling
// list then reflects live sibling states (building / awaiting approval /
// merged / failed / skipped, output summaries for non-code children, merge
// state for code children) so parallel step children read "do not modify
// files owned by other pending steps" against the CURRENT picture, not the
// expand-time snapshot.
//
// `FlowEngine.bindStepFlows()` supplies the engine reference: this module
// cannot import the flowEngine value directly (flow-engine.ts imports
// step-flow-manager for the fan-out hook; the singleton cycle resolves at
// bind time).

/** The child trigger payload (spec §child shape). `parentNodeKey` is an extra
 *  field beside the spec'd shape — the rollup needs to know which parent node
 *  reschedules; auto-wrapped and step-build children read `step.*` only. */
export interface StepChildPayload {
  plan: { title: string; summary: string };
  step: { id: string; title: string; detail: string | null; files: string[]; branch?: string };
  /** Phase 3A: siblings refreshed at start time — `summary` carries a
   *  non-code sibling's output summary, `mergeStatus` a code sibling's
   *  merge-back state (conflict / fixing / …) so parallel children read the
   *  live picture, not the expand-time snapshot. */
  siblings: { id: string; title: string; files: string[]; status: string; summary?: string; mergeStatus?: string }[];
  parentNodeKey: string;
  /** The single work node instance key on the child flow (set at expand time). */
  workNodeKey?: string;
}

const FANOUT_AUTOWRAP_DESC_PREFIX = "fanout-autowrap:";

const fanoutAutoWrapDescription = (
  sourceTemplateId: string,
  nodeKey: string,
  configHash: string,
): string => `${FANOUT_AUTOWRAP_DESC_PREFIX}${sourceTemplateId}:${nodeKey}:${configHash}`;

const hashFanoutChildConfig = (config: Record<string, unknown>): string =>
  crypto.createHash("sha256").update(JSON.stringify(stripFanoutKeys(config))).digest("hex").slice(0, 16);

/** Live state of one step child, derived from plan_steps + the child flow. */
export interface StepState {
  step: PlanStepRow;
  childFlowId: string | null;
  childStatus: string | null; // flows.status of the child ('done' when closed)
  childNodeKey: string | null;
  childNodeType: string | null;
  /** rolled-up child node status: failed > awaiting_approval > running > done (> null = no run yet) */
  childNodeStatus: string | null;
  /** the child's own step branch (code children only; from flows.mrBranch) */
  branch: string | null;
  /** the parent-side integration branch the child merges into (code children only) */
  integrationBranch: string | null;
  isCodeChild: boolean;
  isRunning: boolean; // node running
  isAwaiting: boolean; // node awaiting_approval (counts as in flight)
  isResolved: boolean; // done/approved/skipped/failed — terminal for the rollup
  isFailed: boolean; // FAILED-visible: failed node or a non-merged step_merges row
  /** durable merge-back state (Phase 2): latest step_merges row status for the child (null = never merged) */
  mergeStatus: string | null;
  /** merge-fix attempts consumed so far on that row */
  mergeAttempts: number;
  /** last merge-back error text (conflict detail / hook rejection / infra) */
  mergeError: string | null;
  /**
   * True when this code child's step branch diverges from its integration
   * branch's head (an earlier sibling already merged onto it — the branch was
   * cut at expand time so it cannot contain the new head). The merge repairs
   * it with a merge commit (never a rebase); the parent card shows the
   * stale-base chip while it diverges.
   */
  staleBase: boolean;
}

/** The seeded child template id for build fan-out. */
export { STEP_BUILD_TEMPLATE_ID } from "../../constants/nodeKeys";

export class StepFlowManager {
  /** Engine surface the manager drives (bound once by flow.ts at module load). */
  private engine: {
    ctx(flowId: string): Promise<FlowCtx>;
    nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
    defOf(flowId: string, nodeKey: string): Promise<{ key: string; label: string; capabilities: NodeCapabilities }>;
    createStepChild(
      parentFlowId: string,
      templateId: string,
      name: string,
      payload: StepChildPayload,
      opts: { branch: string | null },
      tx?: Prisma.TransactionClient
    ): Promise<string>;
    startStepChild(childFlowId: string): Promise<void>;
    finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): Promise<void>;
    cancelNode(flowId: string, nodeKey: string): Promise<void>;
    setNodeStatus(flowId: string, nodeKey: string, status: string): Promise<void>;
    bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
    /** run a node with a validated rawInput (the Phase-2 merge-fix agent drives
     *  the step child's runNode-with-feedback path, exactly like the SDLC
     *  chain's commit-fix reuses runNode for push rejections) */
    runNode(flowId: string, nodeKey: string, rawInput: unknown): Promise<string>;
    /** the latest artifact version a chain role's def published as a
     *  first-class resource (§T3/F3) — the plan version the mode resolution
     *  reads, scoped through the plan def's metadata instead of a literal kind */
    latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): Promise<T | undefined>;
  } | null = null;

  /** Called once from flow.ts (module-load tail) — resolves the engine cycle. */
  bind(engine: NonNullable<StepFlowManager["engine"]>): void {
    this.engine = engine;
  }

  private get e(): NonNullable<StepFlowManager["engine"]> {
    if (!this.engine) throw new Error("StepFlowManager is not bound to the engine yet");
    return this.engine;
  }

  // ── the fan-out gate (engine internal; called from startNodeStage) ─────────

  /**
   * Mode resolution: `whole`/`steps` are explicit (an explicit value overrides
   * the plan's published execution, recorded in the events by the gate);
   * `from-plan` honors the plan-meta `execution` the plan node published on
   * its latest plan version (absent ⇒ `whole`).
   */
  resolveMode(
    config: Record<string, unknown>,
    published: "whole" | "steps" | null
  ): { mode: FanoutKnob["mode"]; published: "whole" | "steps" | null; override: boolean } {
    const knob = fanoutOf(config);
    if (knob.mode === "from-plan") return { mode: published ?? "whole", published, override: false };
    return { mode: knob.mode, published, override: published != null && published !== knob.mode };
  }

  /** The plan node's published execution on the latest plan artifact (plan-meta `execution`). */
  async publishedExecution(flowId: string): Promise<"whole" | "steps" | null> {
    const meta = (await this.e.latestResourceArtifact<{ meta: string | null }>(flowId, NODE_KEYS.PLAN, "a.meta"))
      ?.meta ?? null;
    if (!meta) return null;
    try {
      const exec = JSON.parse(meta)?.execution;
      return exec === "steps" || exec === "whole" ? exec : null;
    } catch {
      return null;
    }
  }

  /**
   * The fan-out decision of the engine's trigger path (`null` = today's whole
   * path, unchanged). "whole-wrap" is the `from-plan` + whole-resolution case:
   * the node runs its normal path and its native output is then wrapped as a
   * single-entry aggregate — a `from-plan` node ALWAYS publishes the aggregate
   * shape so downstream `{{nodes.X.output.steps.*}}` mappings survive plan
   * revisions that change the checklist size (rev 3 decision).
   */
  async gate(flowId: string, nodeKey: string): Promise<"fanout" | "whole-wrap" | null> {
    const config = await this.e.nodeConfigFor(flowId, nodeKey);
    const knob = fanoutOf(config);
    if (knob.mode === "whole") return null; // the frozen default — nothing to do
    const ctx = await this.e.ctx(flowId);
    if (ctx.flow.parentFlowId != null) return null; // no nesting (lint rule 3's runtime mirror)
    const resolved = this.resolveMode(config, await this.publishedExecution(flowId));
    if (resolved.override) {
      await db.emitEvent(flowId, null, "lifecycle",
        `${nodeKey} fan-out mode "${resolved.mode}" overrides the plan's published execution "${resolved.published}"`,
        { nodeKey });
    }
    if (resolved.mode === "whole") return "whole-wrap";
    const pending = (await planSteps.list(flowId)).filter((s) => s.status === "pending" && s.subFlowId == null);
    if (!pending.length) return null; // nothing to expand — the whole path runs
    return "fanout";
  }

  // ── expansion ───────────────────────────────────────────────────────────────

  /**
   * Child flows for every pending step without `sub_flow_id` + first
   * scheduling. A later plan refinement adds children for new steps only
   * (they expand at the flow's next gate hit — e.g. a re-entered node).
   * Returns true when at least one child was spawned.
   */
  async expand(parentFlowId: string, nodeKey: string): Promise<boolean> {
    const ctx = await this.e.ctx(parentFlowId);
    const summary = await this.planSummary(parentFlowId);
    const pending = (await planSteps.list(parentFlowId)).filter((s) => s.status === "pending" && s.subFlowId == null);
    if (!pending.length) return false;
    const spec = (await templateStore.graphForFlow(parentFlowId))?.byKey.get(nodeKey);
    // the parent def owns its fan-out fallback child (§T3/F5) — resolved like
    // every def in the engine (built-in by key, declarative by row + instance)
    const parentDef = spec ? await nodeRegistry.resolve(spec.defKey ?? nodeKey, nodeKey) : undefined;
    // the child template resolves ONCE per expansion — a missing/unresolvable
    // child fails the node loudly before any child row exists
    const templateId = await this.childTemplateId(
      parentFlowId, nodeKey, parentDef,
      fanoutOf(await this.e.nodeConfigFor(parentFlowId, nodeKey)));
    const childGraph = await templateStore.graph(templateId);
    if (!childGraph?.nodes.length) {
      throw new Error(`fan-out: child template "${templateId}" has no nodes`);
    }
    const codeChild = Boolean((nodeRegistry.maybe(childGraph.nodes[0].defKey)?.capabilities as NodeCapabilities | undefined)?.mergeBack);
    const integrationBranchOf = async (planBranch: string | null) => this.integrationBranchFor(parentFlowId, nodeKey, planBranch);

    // §2 data model: when the EXPLICIT child template declares a start
    // contract, the `{plan, step, siblings}` payload is validated against it
    // exactly like a webhook delivery — before any child row exists (Phase
    // 3C: explicit picks run the §2 check; auto-wrapped/step-build templates
    // declare no start node, so the payload flows straight into input
    // mapping and prompt variables as before)
    await this.validateChildStartContract(childGraph, templateId, {
      plan: summary,
      step: {
        id: pending[0].metaId ?? pending[0].id,
        title: pending[0].title,
        detail: pending[0].detail,
        files: StepFlowManager.filesOf(pending[0]),
      },
      // the siblings/parentNodeKey shape is fixed by the payload builder
      siblings: [],
      parentNodeKey: nodeKey,
    } as unknown as StepChildPayload);

    let made = 0;
    await db.transaction(async (tx) => {
      for (const stepRow of pending) {
        const integrationBranch = await integrationBranchOf(stepRow.branch);
        const groupIndex = await this.branchGroupIndex(parentFlowId, integrationBranch, stepRow, integrationBranchOf, tx);
        const branch = codeChild ? `${integrationBranch}-s${groupIndex + 1}` : null;

        const payload: StepChildPayload = {
          plan: summary,
          step: {
            id: stepRow.metaId ?? stepRow.id,
            title: stepRow.title,
            detail: stepRow.detail,
            files: StepFlowManager.filesOf(stepRow),
            ...(branch ? { branch } : {}),
          },
          siblings: (await planSteps.list(parentFlowId, tx))
            .filter((s) => s.id !== stepRow.id)
            .map((s) => ({ id: s.metaId ?? s.id, title: s.title, files: StepFlowManager.filesOf(s), status: s.status })),
          parentNodeKey: nodeKey,
          workNodeKey: childGraph.nodes[0]?.key ?? nodeKey,
        };
        const childId = await this.e.createStepChild(
          parentFlowId,
          templateId,
          `${ctx.flow.name} · step: ${stepRow.title}`,
          payload,
          { branch },
          tx
        );
        await tx.$executeRawUnsafe(`UPDATE plan_steps SET sub_flow_id=$1, updated_at=$2 WHERE id=$3 AND flow_id=$4`,
          childId, db.now(), stepRow.id, parentFlowId);
        if (codeChild) {
          // integration branch rows mirror the whole-mode branch decomposition so
          // the final aggregate approval's MR targets resolve through the chain
          if (!(await branchStore.list(parentFlowId, tx)).some((b) => b.name === integrationBranch)) {
            await branchStore.upsert(parentFlowId, integrationBranch, {
              title: `steps${stepRow.branch ? ` · ${stepRow.branch}` : ""}`,
              order: (await branchStore.list(parentFlowId, tx)).length,
              status: "pending",
            }, tx);
          }
        }
        await db.emitEvent(parentFlowId, null, "lifecycle",
          `fan-out: step "${stepRow.title}" → child flow${branch ? ` · branch ${branch}` : ""}`,
          { nodeKey, childFlowId: childId }, tx);
        made++;
      }
    });

    if (!made) return false;
    await this.e.setNodeStatus(parentFlowId, nodeKey, "running");
    const parallelMax = Math.max(1, fanoutOf(await this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `${nodeKey} fans out into ${made} step sub-flow${made > 1 ? "s" : ""} — one child per pending plan step${parallelMax > 1 ? `, up to ${parallelMax} concurrent (file-disjoint)` : ", sequential"}`,
      { nodeKey });
    await this.advance(parentFlowId, nodeKey);
    return true;
  }

  /**
   * Deliver a child's sibling list at start time (Phase 3A): the persisted
   * trigger payload is refreshed with each sibling's LIVE state (building /
   * awaiting approval / merged / failed / skipped), a non-code sibling's
   * output summary (bounded) and a code sibling's merge-back state — the
   * context pack then advises against touching files owned by concurrently
   * working siblings against the current picture, not the expand-time one.
   */
  private async refreshSiblings(
    parentFlowId: string,
    nodeKey: string,
    childFlowId: string,
    states: StepState[],
  ): Promise<void> {
    const payload = await this.childPayload(childFlowId);
    if (!payload) return;
    payload.siblings = await Promise.all(
      states
        .filter((s) => s.childFlowId != null && s.childFlowId !== childFlowId)
        .map(async (s) => {
          const isCode = s.isCodeChild;
          const done = s.step.status === "done";
          let status: string;
          if (s.step.completedBy === "skipped") status = "skipped";
          else if (s.isFailed) status = "failed";
          else if (done) status = isCode ? "merged" : "done";
          else if (s.isAwaiting) status = "awaiting approval";
          else if (s.isRunning) status = "building";
          else status = "pending";
          let summary: string | undefined;
          let mergeStatus: string | undefined;
          const out = s.childFlowId ? await this.childOutput(s.childFlowId) : null;
          const outObj = out && typeof out === "object" ? (out as Record<string, unknown>) : null;
          if (isCode) {
            // done ⇒ its merge landed; a merge row in repair surfaces the state
            mergeStatus = !done && s.mergeStatus && s.mergeStatus !== "merged"
              ? s.mergeStatus
              : undefined;
          } else if (done || (!s.isFailed && outObj)) {
            const raw = outObj?.summary ?? outObj?.output_summary ?? outObj?.markdown;
            if (typeof raw === "string" && raw.trim()) summary = raw.trim().slice(0, 200);
          }
          return {
            id: s.step.metaId ?? s.step.id,
            title: s.step.title,
            files: StepFlowManager.filesOf(s.step),
            status,
            ...(summary ? { summary } : {}),
            ...(mergeStatus ? { mergeStatus } : {}),
          };
        }),
    );
    await db.run(`UPDATE flows SET trigger_payload=$1::jsonb, updated_at=$2 WHERE id=$3`,
      JSON.stringify(payload), db.now(), childFlowId);
  }

  /** The child template's declared start contract, validated against the step payload
   *  (§2: "exactly like a webhook delivery") — a no-op when none declares fields. */
  async validateChildStartContract(childGraph: TemplateGraph, templateId: string, payload: unknown): Promise<void> {
    const startSpec = childGraph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (!contractFields.length) return;
    const v = validateAgainstContract(contractFields, payload);
    if (!v.ok) {
      throw new Error(
        `fan-out: the step payload doesn't match the child template "${(await templateStore.flowTemplate(templateId))?.name ?? templateId}" start contract — ${v.error}`);
    }
  }

  /**
   * The integration branch a step lands on (Phase 3C: the PARENT build node's
   * `branch_pattern` knob now formats it; empty pattern = the built-in
   * bugfix/feature helper). Phase 1 always used the built-in helper — with a
   * pattern knob configured, expand/approve/reconcile derivations disagreed;
   * every caller uses this one method now. Step branches are
   * `<integration>-sN` built off this prefix, same as before.
   */
  async integrationBranchFor(parentFlowId: string, nodeOwnerKey: string, planBranch: string | null): Promise<string> {
    const ctx = await this.e.ctx(parentFlowId);
    const pattern = configString(await this.e.nodeConfigFor(parentFlowId, nodeOwnerKey), "branch_pattern");
    return branchNamer.branchName(ctx, pattern, planBranch ?? undefined);
  }

  /** Child template id: explicit `knob.child` | the parent def's fallback child
   *  (the build's seeded step build, §T3/F5) | auto-wrap. */
  private async childTemplateId(parentFlowId: string, nodeKey: string, parentDef: NodeDefinition | undefined, knob: FanoutKnob): Promise<string> {
    if (knob.child) {
      if (!(await templateStore.flowTemplate(knob.child))) {
        throw new Error(`fan-out child template "${knob.child}" does not exist (the ${nodeKey} node's fan-out config)`);
      }
      return knob.child;
    }
    // the def's fallback default (spec §1: "a fallback default, not a hard
    // binding — every other node auto-wraps itself")
    const fallback = parentDef?.childTemplateId() ?? null;
    if (fallback) return fallback;
    return this.autoWrap(parentFlowId, nodeKey);
  }

  /** Find-or-create the hidden auto-wrap child template (keyed by source template, node key, config). */
  private async autoWrap(parentFlowId: string, nodeKey: string): Promise<string> {
    const spec = (await templateStore.graphForFlow(parentFlowId))?.byKey.get(nodeKey);
    if (!spec) throw new Error(`fan-out: node "${nodeKey}" is not a template node`);
    const parentTemplateId = (await this.e.ctx(parentFlowId)).flow.templateId;
    if (!parentTemplateId) throw new Error(`fan-out: flow ${parentFlowId} has no template id for auto-wrap`);
    const effective = await this.e.nodeConfigFor(parentFlowId, nodeKey);
    const configHash = hashFanoutChildConfig(effective);
    const autoWrapKey = fanoutAutoWrapDescription(parentTemplateId, nodeKey, configHash);
    const existing = (await templateStore.list({ includeHidden: true })).find((t) => t.description === autoWrapKey);
    if (existing) return existing.id;
    const name = `${spec.label} · step`;
    // trigger type: approval if the parent's is approval else auto — an
    // approval parent's gate BECOMES the per-step gates; the parent itself
    // never gates in fan-out mode (spec §auto-wrap)
    const parentTrigger = spec.trigger.type;
    const tplId = await templateStore.create({
      name,
      description: autoWrapKey,
      trigger: { type: "manual" },
      nodes: [
        {
          key: spec.key,
          nodeTemplateId: spec.nodeTemplateId,
          trigger: { type: parentTrigger === "approval" ? "approval" : "auto" },
          config: stripFanoutKeys(effective),
          input_map: spec.inputMap,
        },
      ],
      edges: [],
    }, { skipLint: true });
    await db.run(`UPDATE flow_templates SET hidden=true, updated_at=$1 WHERE id=$2`, db.now(), tplId);
    return tplId;
  }

  /** 0-based index of the step within its integration-branch group (ordered by position). */
  private async branchGroupIndex(
    parentFlowId: string,
    integrationBranch: string,
    self: PlanStepRow,
    integrationBranchOf: (planBranch: string | null) => Promise<string>,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const rows = await planSteps.list(parentFlowId, tx);
    const group: PlanStepRow[] = [];
    for (const s of rows) {
      if ((await integrationBranchOf(s.branch)) === integrationBranch) group.push(s);
    }
    group.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    return Math.max(0, group.findIndex((s) => s.id === self.id));
  }

  // ── scheduling (Phase 3A: qualified parallelism) ────────────────────────────

  /**
   * The scheduler: start unstarted children up to `parallel_max` (default 1 =
   * today's sequential behavior). A child occupies a slot while its node is
   * `running` OR `awaiting_approval` (an approved-but-unmerged code child's
   * work is still outstanding). Qualification: an earlier overlapping sibling
   * (files intersect, or either side has no file list) that is in flight
   * serializes the candidate — empty `files` ⇒ overlap ⇒ sequential. A failed
   * earlier CODE sibling keeps stalling its overlapping neighbours (they'd
   * build against a missing branch — the plan §3 rule, kept), while a failed
   * NON-code sibling releases the rest. Overlapping-code-sibling merges stay
   * serialized by the merge arena's per-branch lock; merges land in approval
   * order (step order when approvals arrive in step order; an out-of-order
   * landing is repaired by a merge commit — never a rebase).
   */
  async advance(parentFlowId: string, nodeKey: string): Promise<void> {
    const states = await this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    // claims prevent double-starts when two hooks hit advance concurrently
    // (parallel scheduling widens the expand/terminal/merge hook overlap)
    const now = Date.now();
    for (const [id, at] of this.claimedStarts) {
      if (now - at > 60_000) this.claimedStarts.delete(id);
    }
    for (const s of states) if (s.childFlowId && s.childNodeStatus !== null) this.claimedStarts.delete(s.childFlowId);
    const maxParallel = Math.max(1, fanoutOf(await this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    const inFlight = states.filter((s) => s.isRunning || s.isAwaiting);
    let slots = maxParallel - inFlight.length;
    if (slots > 0) {
      const unresolved = new Set(
        states.flatMap((o) => (o.childFlowId != null && !o.isResolved ? [o.childFlowId] : [])),
      );
      const queue = states
        .filter((s): s is typeof s & { childFlowId: string } =>
          s.childFlowId != null &&
          s.childNodeStatus === null &&
          s.step.status === "pending" &&
          !this.claimedStarts.has(s.childFlowId))
        .sort((a, b) => a.step.position - b.step.position);
      for (const s of queue) {
        if (slots <= 0) break;
        const childFlowId = s.childFlowId;
        // an earlier overlapping sibling still in flight ⇒ sequential
        const blocked =
          states.some((o) =>
            o.childFlowId !== childFlowId &&
            o.childFlowId != null &&
            unresolved.has(o.childFlowId) &&
            o.step.position < s.step.position &&
            this.overlaps(o, s)) ||
          // a failed CODE child stalls its overlapping later neighbours;
          // failed non-code siblings (docs-agent style) never block
          states.some((o) =>
            o.childFlowId !== s.childFlowId &&
            o.isFailed &&
            o.isCodeChild &&
            o.step.position < s.step.position &&
            this.overlaps(o, s));
        if (blocked) continue;
        this.claimedStarts.set(childFlowId, now);
        await this.refreshSiblings(parentFlowId, nodeKey, childFlowId, states);
        void this.e.startStepChild(childFlowId); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    await this.scheduleRollup(parentFlowId, nodeKey);
  }

  /** In-process rollup guard: one publish pass per parent fan-out node at a time. */
  private rollupInflight = new Set<string>();

  /** Fire-and-forget async fan-out work through the engine's guarded bg wrapper. */
  private fanoutAsync(parentFlowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    this.e.bg(parentFlowId, nodeKey, fn);
  }

  private scheduleRollup(parentFlowId: string, nodeKey: string): void {
    const key = `${parentFlowId}:${nodeKey}`;
    if (this.rollupInflight.has(key)) return;
    this.rollupInflight.add(key);
    this.fanoutAsync(parentFlowId, nodeKey, async () => {
      try {
        await this.checkRollup(parentFlowId, nodeKey);
      } finally {
        this.rollupInflight.delete(key);
      }
    });
  }

  /** In-process start claims: advance() runs synchronously, so this is enough
   *  to keep the parallel scheduler from starting one child twice while the
   *  previous claim's bg start is still pending. Claims expire after 60 s (a
   *  start that never took — engine bg failure — re-arms the slot) and are
   *  dropped as soon as the child's node status leaves `pending`. */
  private claimedStarts = new Map<string, number>();

  // ── child terminal rollup ───────────────────────────────────────────────────

  /**
   * Notification hook — called from the engine's node-stage tail / cancel /
   * generic approve when a step child's node reached a terminal state.
   * Early-returns unless the whole child is terminal, then reschedules.
   */
  async onChildFinished(childFlowId: string): Promise<void> {
    const link = await db.get<{ flowId: string }>(`SELECT flow_id AS "flowId" FROM plan_steps WHERE sub_flow_id=$1`, childFlowId);
    if (!link) return;
    const payload = await this.childPayload(childFlowId);
    const parentNodeKey = payload?.parentNodeKey;
    if (!parentNodeKey) return; // no fan-out linkage — nothing this manager scheduled
    const nodes = await nodeStore.statusesOfFlow(childFlowId);
    const flowStatus = await this.childFlowStatus(childFlowId);
    const allTerminal = nodes.length > 0 && nodes.every((n) => NODE_TERMINAL_STATUSES.includes(n));
    if (!allTerminal && flowStatus !== "done") return;
    await db.emitEvent(link.flowId, null, "lifecycle",
      `step child resolved ("${payload.step.title}")`,
      { nodeKey: parentNodeKey, childFlowId });
    this.scheduleRollup(link.flowId, parentNodeKey);
  }

  /** Rollup: when every linked child is resolved, publish the aggregate (all resolved). */
  private async checkRollup(parentFlowId: string, nodeKey: string): Promise<void> {
    const states = await this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    if (states.some((s) => s.childFlowId != null && !s.isResolved && !s.isFailed)) return;
    if (states.some((s) => s.childFlowId == null && s.step.status === "pending")) return;
    // successful children flip their plan steps done (`plan_steps.status`
    // semantics unchanged — done on child success/merge, never on agent claim)
    for (const s of states) {
      if (s.step.status === "pending" && s.isResolved && !s.isFailed) {
        await planSteps.setStatus(parentFlowId, s.step.id, "done", "child");
      }
    }
    await this.onAllResolved(parentFlowId, nodeKey);
  }

  // ── all resolved: aggregate output contract + parent terminal ──────────────

  /**
   * Publish the aggregate output contract (the def's `fanoutOutput`, default
   * `{steps: [{id, title, status, branch?, artifact_id?, output?}]}`), move the
   * node to its trigger-type terminal (approval ⇒ `awaiting_approval` — the
   * SDLC build's final aggregate approval then flows through the untouched
   * approveBuild chain → MR creation), then the engine's normal edge
   * evaluation continues downstream.
   */
  async onAllResolved(parentFlowId: string, nodeKey: string): Promise<void> {
    const parentRunning = await nodeStore.statusOf(parentFlowId, nodeKey);
    if (parentRunning !== NODE_STATUS.RUNNING) return;

    const ctx = await this.e.ctx(parentFlowId);
    const states = await this.statesOf(parentFlowId, nodeKey);
    const def = await this.e.defOf(parentFlowId, nodeKey);
    const isCode = typeof def.capabilities.mergeBack === "function";

    const stepsOut = await Promise.all(states.map(async (s) => {
      const out = s.childFlowId ? await this.childOutput(s.childFlowId) : null;
      const outObj = out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
      const artifactId = outObj?.latestArtifact ?? outObj?.artifactId ?? outObj?.output_id ?? null;
      return {
        id: s.step.metaId ?? s.step.id,
        title: s.step.title,
        status: this.aggregateStatus(s),
        branch: s.branch ?? undefined,
        artifact_id: typeof artifactId === "string" ? artifactId : undefined,
        output: outObj ?? {},
      };
    }));
    const aggregate = { steps: DEFAULT_FANOUT_OUTPUT.parse({ steps: stepsOut }).steps };

    // code children merged onto integration branches: publish the parent-side
    // diff artifacts (the whole-mode finalizeBuild contract: branch +
    // latestArtifact) underneath the aggregate — the BuildView panel reads them
    const integrationBranches = [...new Set(states.map((s) => s.integrationBranch).filter((b): b is string => Boolean(b)))];
    const perBranch: Record<string, string> = {};
    let latestArtifact: string | null = null;
    if (isCode) {
      const nodeId = await nodeStore.idOf(parentFlowId, nodeKey);
      for (const branch of integrationBranches) {
        const group = states.filter((s) => s.integrationBranch === branch);
        if (!group.some((s) => s.step.status === "done" && s.step.completedBy === "merge")) continue;
        await branchStore.upsert(parentFlowId, branch, { status: "awaiting_approval" });
        await db.run(`UPDATE flows SET mr_branch=$1 WHERE id=$2 AND (mr_branch IS NULL OR mr_branch='')`, branch, parentFlowId);
        if (!nodeId) continue;
        try {
          const diff = await flowCtxHelper.makeDiff(ctx, branch);
          const art = await nodeSupport.saveArtifact(
            nodeId, parentFlowId, "diff",
            diff ? diff.raw : "(diff unavailable)",
            { branch, stat: diff?.stat ?? "", fanout: true });
          perBranch[branch] = art.id;
          latestArtifact = latestArtifact ?? art.id;
        } catch {
          // per-branch diff failure is non-fatal here — the aggregate still publishes
        }
      }
    }

    await this.e.finishFanout(parentFlowId, nodeKey, {
      steps: aggregate.steps,
      ...(integrationBranches[0] ? { branch: integrationBranches[0] } : {}),
      ...(latestArtifact ? { latestArtifact } : {}),
      ...(integrationBranches.length > 1 ? { branchArtifacts: perBranch } : {}),
    });
  }

  private aggregateStatus(s: StepState): "done" | "failed" | "skipped" {
    if (s.step.completedBy === "skipped") return "skipped";
    if (s.isFailed) return "failed";
    // stalled pending steps (an earlier overlapping sibling failed) stay honest
    if (s.step.status === "pending" && s.childFlowId == null) return "failed";
    return s.step.status === "done" ? "done" : s.childNodeStatus === "failed" ? "failed" : "done";
  }

  // ── approvals, skips, guards ────────────────────────────────────────────────

  /**
   * The user approved a step child (Approve & create MR routes here when the
   * flow has no plain build node — the step_build panel's approve button).
   * Code children run the `mergeBack` hook (approve ≠ MR: the MR machinery
   * runs only when the PARENT's aggregate is finally approved).
   */
  async approveChildStep(childFlowId: string): Promise<void> {
    const childFlow = await this.childFlowOf(childFlowId);
    const payload = await this.childPayload(childFlowId);
    if (!childFlow?.parentFlowId || !payload?.parentNodeKey) {
      throw new Error("this flow is not a fan-out step child");
    }
    const parentFlowId = childFlow.parentFlowId;
    const workNodeKey = await this.childWorkNodeKey(childFlowId);
    const node = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    if (!node) throw new Error("the step child has no work node");
    if (node.status !== "awaiting_approval") throw new Error(`the step is ${node.status}, not awaiting approval`);
    const stepRow = await this.stepRowOf(childFlowId);
    if (!stepRow) throw new Error("the step child has no linked plan step");
    if (stepRow.completedBy === "merge") {
      throw new Error("the step merge is already in progress");
    }
    if (mergeArena.isMerging(childFlowId)) {
      throw new Error("the step merge is already in progress");
    }
    const activeMerge = await db.get<{ id: string }>(
      `SELECT id FROM step_merges WHERE flow_id=$1 AND status IN ('running','conflict','rejected') LIMIT 1`,
      childFlowId);
    if (activeMerge) {
      throw new Error("the step merge is already in progress");
    }
    const ctx = await this.e.ctx(childFlowId);
    const branch = ctx.flow.mrBranch;
    if (!branch) throw new Error("the step child has no step branch to merge");
    const integrationBranch = await this.integrationBranchFor(parentFlowId, payload.parentNodeKey, stepRow.branch ?? null);

    await db.emitEvent(childFlowId, null, "lifecycle",
      `step approved${typeof (await this.engineCapabilitiesOfMergeBack(childFlowId)) === "function" ? ` — merging ${branch} into ${integrationBranch}` : ""}`);
    if (typeof (await this.engineCapabilitiesOfMergeBack(childFlowId)) !== "function") {
      // non-code child: nothing to merge — approval closes the child
      await db.run(`UPDATE plan_steps SET status='done', completed_by='approved', updated_at=$1 WHERE sub_flow_id=$2`,
        db.now(), childFlowId);
      await this.closeChild(childFlowId);
      await this.onChildFinished(childFlowId);
      return;
    }
    const claimed = await db.run(
      `UPDATE plan_steps SET completed_by='merge', updated_at=$1 WHERE sub_flow_id=$2 AND (completed_by IS NULL OR completed_by='')`,
      db.now(), childFlowId);
    if (claimed === 0) {
      throw new Error("the step merge is already in progress");
    }
    this.fanoutAsync(childFlowId, workNodeKey, () =>
      this.runMergeBack(parentFlowId, childFlowId, payload, stepRow, workNodeKey, branch, integrationBranch));
  }

  // ── merge-back with the bounded merge-fix agent (Phase 2A) ─────────────────

  /**
   * The merge-back loop: arena attempt → on `merged` the success path → on
   * infra `failed` the failed-visible path → on `conflict` / `rejected`
   * (repairable CODE states) the bounded merge-fix agent on the step child —
   * the exact commit-fix reuse (runNode-with-feedback on the node that built
   * the step; the agent merges the integration branch into its own step
   * branch, resolves respecting both intents, commits, pushes; it works in
   * the child's worktree/branch in local mode and on the step branch in cloud
   * mode — either way the arena re-attempts the merge after it), then a
   * re-attempt. Bounded by the parent's `max_merge_fix_attempts` knob
   * (default 2, the max_commit_fix_attempts style): exhaustion ⇒ the step
   * fails visible with `step_merges: failed` and the parent card shows the
   * failure (user Retry re-runs the loop). Infra failures never consume the
   * budget — the commit-fix classification: network/auth is not something an
   * agent can code away.
   */
  private async runMergeBack(
    parentFlowId: string,
    childFlowId: string,
    payload: StepChildPayload,
    stepRow: PlanStepRow,
    childNodeKey: string,
    branch: string,
    integrationBranch: string,
    resumeRowId?: string,
    resumeNote?: string,
  ): Promise<void> {
    const nodeOwnerKey = payload.parentNodeKey;
    const nodeRefId = await nodeStore.idOf(childFlowId, childNodeKey);
    const nodeRef = nodeRefId ? { id: nodeRefId } : undefined;
    const maxAttempts = Math.max(1, configNumber(
      await this.e.nodeConfigFor(parentFlowId, nodeOwnerKey), "max_merge_fix_attempts", 2));
    if (resumeNote) {
      await db.emitEvent(parentFlowId, null, "lifecycle", resumeNote,
        { nodeKey: nodeOwnerKey, childFlowId });
    }
    // NOTE: per-branch merge locks are FIFO — dropping them would let a
    // concurrently queued sibling merge run beside the in-flight one (Phase 3A
    // parallel approvals queue instead). Resume-after-restart starts with an
    // empty lock map — reconcile never needs to drop either.
    let mergeRowId = resumeRowId ?? undefined;
    try {
      for (;;) {
        // abandoned approvals hand-back: the step may have been skipped (or
        // closed by a checklist edit) while this loop awaited — never land it
        const live = await this.stepRowOf(childFlowId);
        const nodeStatus = await nodeStore.statusOf(childFlowId, childNodeKey);
        if (!live || live.completedBy === "skipped" || !nodeStatus ||
            (nodeStatus !== NODE_STATUS.AWAITING_APPROVAL && nodeStatus !== NODE_STATUS.RUNNING)) {
          await db.emitEvent(parentFlowId, null, "lifecycle",
            `step "${stepRow.title}" merge-back abandoned (the step is no longer approved/pending)`,
            { nodeKey: nodeOwnerKey, childFlowId });
          return;
        }

        const result = await mergeArena.mergeStepBranch({
          parentFlowId,
          childFlowId,
          parentNodeKey: nodeOwnerKey,
          integrationBranch,
          branch,
          message: `[${stepRow.metaId ?? "s?"}] ${stepRow.title}`,
          baseBranch: (await this.e.ctx(parentFlowId)).repo?.defaultBranch ?? "main",
          ...(mergeRowId ? { mergeRowId } : {}),
        });
        // the arena ROW id is bookkeeping truth — adopt it for re-attempts
        mergeRowId = (await db.get<{ id: string }>(
          `SELECT id FROM step_merges WHERE flow_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, childFlowId
        ))?.id ?? mergeRowId;

        if (result.status === "merged") {
          await planSteps.setStatus(parentFlowId, stepRow.id, "done", "merge");
          await this.closeChild(childFlowId);
          await db.emitEvent(parentFlowId, null, "lifecycle",
            `step "${stepRow.title}" merged into ${integrationBranch}${result.stale ? " (stale base resolved by merge — no rebase)" : ""}`,
            { nodeKey: nodeOwnerKey, childFlowId });
          await this.onChildFinished(childFlowId);
          return;
        }

        // infra failure: the commit-fix classification — an agent cannot code
        // away network/auth. Fail visible; the user Retry re-runs the loop.
        if (result.status === "failed") {
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, result.error);
          return;
        }

        // conflict / rejected — repairable code state → the bounded fix agent
        const attempts = mergeRowId
          ? ((await db.get<{ attempts: number }>(`SELECT attempts FROM step_merges WHERE id=$1`, mergeRowId))?.attempts ?? 0)
          : 1;
        if (attempts > maxAttempts) {
          const err = `${result.status} after ${attempts - 1} merge-fix agent runs (max ${maxAttempts}): ${result.error}`;
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, err);
          return;
        }
        await db.emitEvent(parentFlowId, null, "lifecycle",
          `merge-fix agent starting (attempt ${attempts}/${maxAttempts}) — ${result.status === "conflict" ? "resolving the merge conflict on the step branch" : "fixing the hook-rejected code on the step branch"}`,
          { nodeKey: nodeOwnerKey, childFlowId });
        const fixPrompt = prompts.resolve("merge_fix",
          { branch, integration: integrationBranch },
          {
            situation: result.status === "conflict"
              ? `conflicting with the code already landed on ${integrationBranch}`
              : `pushed to ${integrationBranch} but the push was rejected by a pre-receive/pre-push hook`,
            error: result.error,
          });
        try {
          await this.e.runNode(childFlowId, childNodeKey, {
            plan: null, prompt: null, branchInfo: null, step: null, feedback: fixPrompt, model: null,
          });
        } catch (e: unknown) {
          // the fix agent's own run failed (agent error / runtime) — not a
          // code-repairable outcome, hand back failed-visible
          await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
            `merge-fix agent failed: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (nodeRef) {
          // the fix run ended `awaiting_approval` (a new diff is up) — keep the
          // loop's merge-underway semantics visible on the parent card
          await db.emitEvent(parentFlowId, nodeRef.id, "lifecycle",
            `merge-fix agent finished — re-attempting the arena merge`,
            { nodeKey: nodeOwnerKey, childFlowId });
        }
        await db.run(`UPDATE nodes SET status='awaiting_approval', updated_at=$1 WHERE flow_id=$2 AND node_key=$3`,
          db.now(), childFlowId, childNodeKey);
      }
    } catch (e: unknown) {
      await this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
        e instanceof Error ? e.message : String(e));
    }
  }

  /** Mark a merge-back failed loud: step_merges → failed, child node → failed, failure on the parent. */
  private async failMergeBack(
    parentFlowId: string,
    childFlowId: string,
    childNodeKey: string,
    stepRow: PlanStepRow,
    parentNodeKey: string,
    error: string,
  ): Promise<void> {
    await db.run(`UPDATE step_merges SET status='failed', error=$1, updated_at=$2 WHERE flow_id=$3 AND status IN ('running','conflict','rejected')`,
      error.slice(0, 2000), db.now(), childFlowId);
    await db.run(`UPDATE nodes SET status='failed', updated_at=$1 WHERE flow_id=$2 AND node_key=$3`,
      db.now(), childFlowId, childNodeKey);
    await db.emitEvent(childFlowId, null, "error", `merge-back failed: ${error}`, { nodeKey: childNodeKey });
    await db.emitEvent(parentFlowId, null, "error",
      `step "${stepRow.title}" merge-back failed: ${error} — Retry the step to re-run the merge (+ fix agent)`,
      { nodeKey: parentNodeKey, childFlowId });
    await this.onChildFinished(childFlowId);
  }

  // ── reconcile resume (Phase 2B: restart mid-merge) ─────────────────────────

  /**
   * A `running`/`conflict` step_merges row whose owning run is dead (server
   * restart): re-enter the merge-back loop on the same durable row. The child
   * node must still be approved/underway for this to be safe (caller checks —
   * reconcile only resumes awaiting-approval children). The loop re-verifies
   * step ownership before every attempt.
   */
  async resumePendingMerge(childFlowId: string): Promise<void> {
    const payload = await this.childPayload(childFlowId);
    const stepRow = await this.stepRowOf(childFlowId);
    const workNodeKey = await this.childWorkNodeKey(childFlowId);
    const childNode = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    const childFlow = await this.childFlowOf(childFlowId);
    const row = await db.get<{ id: string; status: string }>(
      `SELECT id, status FROM step_merges WHERE flow_id=$1 AND status IN ('running','conflict') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    if (!payload?.parentNodeKey || !stepRow || !childNode || !childFlow?.parentFlowId || !row) {
      await db.emitEvent(childFlowId, null, "error", "a pending step merge could not be resumed (the fan-out linkage is gone)");
      return;
    }
    const parentFlowId = childFlow.parentFlowId;
    const integrationBranch = await this.integrationBranchFor(
      parentFlowId, payload.parentNodeKey, stepRow.branch ?? null);
    const branch = childFlow.mrBranch;
    if (!branch) {
      await db.run(`UPDATE step_merges SET status='failed', error='restart interrupted the merge and the step branch is lost', updated_at=$1 WHERE id=$2`,
        db.now(), row.id);
      return;
    }
    this.fanoutAsync(parentFlowId, payload.parentNodeKey, () =>
      this.runMergeBack(
        parentFlowId, childFlowId, payload, stepRow, workNodeKey, branch,
        integrationBranch, row.id,
        `merge-back for step "${stepRow.title}" was interrupted by a restart — resuming (bounded by the merge-fix budget)`));
  }

  /**
   * User Retry on a merge-failed step: re-enter the merge-back loop from the
   * failed row instead of re-running the step build (the Retry button's
   * merge-failure path — a plain build failure with no merge row keeps
   * routing to the standard node retry).
   */
  async resumeMergeRetry(parentFlowId: string, childFlowId: string): Promise<boolean> {
    const row = await db.get<{ id: string }>(
      `SELECT id FROM step_merges WHERE flow_id=$1 AND status IN ('conflict','rejected','failed') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    const workNodeKey = await this.childWorkNodeKey(childFlowId);
    const childNode = await db.get<{ nodeKey: string; status: string }>(
      `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    if (!row || !childNode || childNode.status !== "failed") return false;
    await db.run(`UPDATE nodes SET status='awaiting_approval', updated_at=$1 WHERE flow_id=$2 AND node_key=$3`,
      db.now(), childFlowId, workNodeKey);
    await this.resumePendingMerge(childFlowId);
    return true;
  }

  /** The child's def mergeBack hook presence — internal. */
  private async engineCapabilitiesOfMergeBack(childFlowId: string): Promise<unknown> {
    const type = await this.childTypeOf(childFlowId);
    if (!type) return null;
    const def = nodeRegistry.maybe(type) ?? undefined;
    return (def?.capabilities as NodeCapabilities | undefined)?.mergeBack ?? null;
  }

  private async childTypeOf(childFlowId: string): Promise<string> {
    const workNodeKey = await this.childWorkNodeKey(childFlowId);
    const row = await db.get<{ type: string }>(
      `SELECT type FROM nodes WHERE flow_id=$1 AND node_key=$2`, childFlowId, workNodeKey);
    return row?.type ?? "";
  }

  /** The work node instance key for a step child (from expand-time payload, with legacy fallback). */
  async childWorkNodeKey(childFlowId: string): Promise<string> {
    const payload = await this.childPayload(childFlowId);
    if (payload?.workNodeKey) return payload.workNodeKey;
    const row = await db.get<{ nodeKey: string }>(
      `SELECT node_key AS "nodeKey" FROM nodes WHERE flow_id=$1 ORDER BY created_at LIMIT 1`, childFlowId);
    if (!row) throw new Error("the step child has no nodes");
    return row.nodeKey;
  }

  /** Skip a step: mark done with `completed_by: 'skipped'`, cancel the child,
   *  drop its merge rows (a restart must never resume a skipped step's merge),
   *  delete the step branch (code children) and sweep the child worktree, emit,
   *  advance. Skipped steps stay visible on the checklist + parent card. */
  async skipStepFlow(parentFlowId: string, stepId: string): Promise<void> {
    const step = (await planSteps.list(parentFlowId)).find((s) => s.id === stepId);
    if (!step) throw new Error("plan step not found");
    if (step.status !== "pending") throw new Error(`the step is already ${step.status}`);
    // owning fan-out node: the child payload knows; unlinked steps resolve via
    // the parent's first configured fan-out node
    const nodeKey =
      (step.subFlowId ? (await this.childPayload(step.subFlowId))?.parentNodeKey : null) ??
      await this.firstFanoutNodeKey(parentFlowId);
    if (!nodeKey) throw new Error("no fan-out node on this flow");
    await planSteps.setStatus(parentFlowId, stepId, "done", "skipped");
    if (step.subFlowId) {
      const childId = step.subFlowId;
      const childFlow = await this.childFlowOf(childId);
      // a stuck merge-back must never resume for a step the user skipped
      await db.run(`UPDATE step_merges SET status='failed', error='step skipped — the merge-back was abandoned', updated_at=$1 WHERE flow_id=$2 AND status IN ('running','conflict','rejected')`,
        db.now(), childId);
      const codeChild = typeof (await this.engineCapabilitiesOfMergeBack(childId)) === "function";
      for (const n of await db.all<{ nodeKey: string; status: string }>(`SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1`, childId)) {
        if (NODE_CANCELABLE_STATUSES.includes(n.status)) {
          await this.e.cancelNode(childId, n.nodeKey); // marks failed + stops in-flight local runs (standard stop)
        }
      }
      // step-branch deletion on skip (Phase 2C) — the branch was created for
      // this step, and a skipped hand-back does not keep its work product
      if (codeChild && childFlow?.mrBranch) {
        try {
          await mergeArena.deleteStepBranch(parentFlowId, childFlow.mrBranch, nodeKey);
        } catch (e: unknown) {
          await db.emitEvent(parentFlowId, null, "lifecycle",
            `step-branch deletion skipped/failed (${e instanceof Error ? e.message : String(e)})`,
            { nodeKey, branch: childFlow.mrBranch });
        }
      }
      await this.closeChild(childId);
    }
    await db.emitEvent(parentFlowId, null, "lifecycle", `plan step skipped: ${step.title}`, { nodeKey });
    await this.advance(parentFlowId, nodeKey);
  }

  /** The first node instance of the flow whose effective fan-out knob isn't whole. */
  private async firstFanoutNodeKey(parentFlowId: string): Promise<string | null> {
    for (const n of await db.all<{ nodeKey: string; config: string | null }>(`SELECT node_key AS "nodeKey", config FROM nodes WHERE flow_id=$1`, parentFlowId)) {
      if (fanoutOf(parseConfigSnapshot(n.config)).mode !== "whole") return n.nodeKey;
    }
    return null;
  }

  /** Internal helper for the checklist-edit guard: close a child that never started. */
  async cancelUnstartedChild(childFlowId: string): Promise<void> {
    const statuses = await nodeStore.statusesOfFlow(childFlowId);
    if (statuses.some((s) => isNodeStarted(s))) return; // started — never closed silently
    await this.closeChild(childFlowId);
  }

  /**
   * Checklist-edit guards (mirror of assertPlanEditable): a step whose child
   * has started/merged cannot be deleted; a pending child with no run may be
   * removed — its child flow closes. Consumed by the plan-step editing paths.
   */
  async deletableStepIds(flowId: string): Promise<{ deletable: Set<string>; toCancel: Map<string, string> }> {
    const deletable = new Set<string>();
    const toCancel = new Map<string, string>();
    for (const s of await planSteps.list(flowId)) {
      if (!s.subFlowId) {
        deletable.add(s.id);
        continue;
      }
      const started = childFlowHasStarted(await nodeStore.statusesOfFlow(s.subFlowId));
      if (started) continue; // building/done child — not deletable
      deletable.add(s.id);
      toCancel.set(s.id, s.subFlowId); // pending child with no run → removed + cancelled
    }
    return { deletable, toCancel };
  }

  /**
   * Durable merge-back state per linked child (read-side, Phase 2): what the
   * parent panel's step cards key on — `mergeStatus` (running/conflict/
   * rejected/failed/merged), the fix-attempt count, the last error text, and
   * the stale-base derivation. `flowEngine.get()` folds this into each
   * plan step's `sub_flow` so the FanoutStepList renders the new states with
   * no extra side calls.
   */
  async mergeStates(parentFlowId: string): Promise<Record<string, {
    mergeStatus: string | null;
    mergeAttempts: number;
    mergeError: string | null;
    staleBase: boolean;
  }>> {
    const out: Record<string, { mergeStatus: string | null; mergeAttempts: number; mergeError: string | null; staleBase: boolean }> = {};
    // index by owner node key: one statesOf pass per owning node (usually one)
    // instead of one per step — Phase 3A de-O(k²)
    const perNode = new Map<string, string[]>();
    for (const s of await planSteps.list(parentFlowId)) {
      if (!s.subFlowId) continue;
      const nodeKey = (await this.childPayload(s.subFlowId))?.parentNodeKey;
      if (!nodeKey) continue;
      const ids = perNode.get(nodeKey) ?? [];
      ids.push(s.subFlowId);
      perNode.set(nodeKey, ids);
    }
    for (const [nodeKey, ids] of perNode) {
      const states = await this.statesOf(parentFlowId, nodeKey);
      const byChild = new Map(states.map((x) => [x.childFlowId, x]));
      for (const childId of ids) {
        const st = byChild.get(childId);
        if (!st) continue;
        out[childId] = {
          mergeStatus: st.mergeStatus,
          mergeAttempts: st.mergeAttempts,
          mergeError: st.mergeError,
          staleBase: st.staleBase,
        };
      }
    }
    return out;
  }

  // ── whole-path wrap (from-plan + whole plan resolution) ─────────────────────
  /**
   * Wrap a fan-out node's whole-mode native output as a single-entry aggregate
   * (`step.id: "whole"` distinguishes it — spec §contract consequence).
   */
  async wrapWholeOutput(flowId: string, nodeKey: string): Promise<void> {
    const node = await db.get<{ id: string; output: unknown }>(
      `SELECT id, output FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) return;
    let native: unknown = null;
    try { native = typeof node.output === "string" ? JSON.parse(node.output) : node.output ?? null; } catch { native = null; }
    const task = (await this.e.ctx(flowId)).task;
    const wrapped = {
      steps: [{ id: "whole", title: task?.summary ?? nodeKey, status: "done", output: native ?? {} }],
    };
    DEFAULT_FANOUT_OUTPUT.parse(wrapped);
    await db.run(`UPDATE nodes SET output=$1::jsonb, updated_at=$2 WHERE id=$3`, JSON.stringify(wrapped), db.now(), node.id);
  }

  // ── state derivation ────────────────────────────────────────────────────────

  /**
   * All step children a parent node owns. `null` engine key at bind time is
   * handled by callers via checkedRollup, so only linked rows are read here.
   */
  private async statesOf(parentFlowId: string, nodeKey: string): Promise<StepState[]> {
    const all = (await planSteps.list(parentFlowId)).filter((s) => s.subFlowId != null);
    const states: StepState[] = [];
    for (const step of all) {
      const childFlowId = step.subFlowId;
      if (!childFlowId) continue;
      const payload = await this.childPayload(childFlowId);
      if (!payload || payload.parentNodeKey !== nodeKey) continue;
      states.push(await this.stateOf(parentFlowId, step, payload));
    }    // cross-sibling pass: a code child awaiting its merge whose integration
    // branch already absorbed an earlier sibling's merge has a STALE BASE —
    // its step branch was cut at expand time, before that merge existed. The
    // chip shows while it diverges; the arena merge is the repair (no rebase).
    for (const s of states) {
      if (!s.isCodeChild || s.step.status === "done") continue;
      s.staleBase = states.some((o) =>
        o !== s &&
        o.integrationBranch === s.integrationBranch &&
        o.step.position < s.step.position &&
        o.step.status === "done" &&
        o.step.completedBy === "merge");
    }
    return states;
  }

  private async stateOf(parentFlowId: string, step: PlanStepRow, payload: StepChildPayload): Promise<StepState> {
    const childFlowId = step.subFlowId;
    if (!childFlowId) throw new Error("stateOf requires a linked sub-flow");
    const childFlow = (await this.childFlowOf(childFlowId)) ?? null;
    const workNodeKey = payload.workNodeKey ?? await this.childWorkNodeKey(childFlowId);
    const nodes = await db.all<{ nodeKey: string; type: string; status: string }>(
      `SELECT node_key AS "nodeKey", type, status FROM nodes WHERE flow_id=$1 ORDER BY created_at`, childFlowId);
    const workNode = nodes.find((n) => n.nodeKey === workNodeKey) ?? nodes[0];
    const statuses = workNode ? [workNode.status] : nodes.map((n) => n.status);
    const childDef = workNode ? nodeRegistry.maybe(workNode.type) : undefined;
    const isCodeChild = typeof (childDef?.capabilities as NodeCapabilities | undefined)?.mergeBack === "function";
    const rollup = StepFlowManager.childRollup(statuses, childFlow?.status ?? null);
    const merge = await this.latestMergeRow(childFlowId);
    const isFailed =
      rollup === "failed" ||
      (merge != null && merge.status !== "merged" && step.status !== "done");
    return {
      step,
      childFlowId,
      childStatus: childFlow?.status ?? null,
      childNodeKey: workNode?.nodeKey ?? null,
      childNodeType: workNode?.type ?? null,
      childNodeStatus: rollup,
      branch: childFlow?.mrBranch ?? null,
      integrationBranch: isCodeChild ? await this.integrationBranchFor(parentFlowId, payload.parentNodeKey, step.branch ?? null) : null,
      isCodeChild,
      isRunning: rollup === "running",
      isAwaiting: rollup === "awaiting_approval",
      isResolved: rollup === "done" || rollup === "failed" || step.status === "done",
      isFailed,
      mergeStatus: merge?.status ?? null,
      mergeAttempts: merge?.attempts ?? 0,
      mergeError: merge?.error ?? null,
      staleBase: false, // filled by statesOf's cross-sibling pass below
    };
  }

  /** Roll a child's node set to one status: failed > awaiting_approval > running > done. */
  public static childRollup(statuses: string[], flowStatus: string | null): string | null {
    if (statuses.some((s) => s === "failed")) return "failed";
    if (statuses.some((s) => s === "awaiting_approval")) return "awaiting_approval";
    if (statuses.some((s) => s === "running")) return "running";
    if (statuses.length && statuses.every((s) => s === "done" || s === "approved" || s === "skipped")) return "done";
    if (flowStatus === "done") return "done";
    return null;
  }

  /** The latest step_merges row for a child (null = never merged/attempts). */
  private async latestMergeRow(childFlowId: string): Promise<{ status: string; attempts: number; error: string | null } | null> {
    return (await db.get<{ status: string; attempts: number; error: string | null }>(
      `SELECT status, attempts, error FROM step_merges WHERE flow_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      childFlowId
    )) ?? null;
  }

  /** Two steps overlap when their `files` lists share a path (empty lists ⇒ independent UNKNOWN ⇒ overlap). */
  private overlaps(a: StepState, b: StepState): boolean {
    const fa = StepFlowManager.filesOf(a.step);
    const fb = StepFlowManager.filesOf(b.step);
    if (!fa.length || !fb.length) return true;
    return fa.some((f) => fb.includes(f));
  }

  private async childFlowOf(childFlowId: string): Promise<FlowRow | undefined> {
    return db.get<FlowRow>(`SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, childFlowId);
  }

  /** Close a child flow (standard terminal state; keeps rows for the audit trail). */
  private async closeChild(childFlowId: string): Promise<void> {
    await db.run(`UPDATE flows SET status='done', updated_at=$1 WHERE id=$2 AND status<>'done'`, db.now(), childFlowId);
    // child worktree sweep on terminal (Phase 2C): the local-mode child's
    // per-step worktree is transient — removed now, not on the next startup
    // sweep. `deleteBranch:false`: the branch ref lives in the hub, so a later
    // node retry still rebuilds the worktree from its own branch; the
    // startup sweep covers any removal a crash interrupted (crash-safe
    // worktree_removals rows are keyed by flow id — child ids work as-is).
    void worktreeManager.removeFlowWorktree(childFlowId, { reason: "step child resolved" })
      .catch(() => { /* the startup sweep resumes */ });
  }

  /** A step row's parsed `files` JSON (defensive; [] when absent/invalid). */
  private static filesOf(step: { files: string | null }): string[] {
    if (!step.files) return [];
    try {
      const parsed = JSON.parse(step.files);
      return Array.isArray(parsed) ? parsed.filter((f: unknown) => typeof f === "string") : [];
    } catch {
      return [];
    }
  }

  private async childFlowStatus(childFlowId: string): Promise<string> {
    const row = await db.get<{ status: string }>(`SELECT status FROM flows WHERE id=$1`, childFlowId);
    return row?.status ?? "";
  }

  private async stepRowOf(childFlowId: string): Promise<PlanStepRow | undefined> {
    const row = await db.get<{ id: string; flowId: string; artifactId: string | null; metaId: string | null; position: number; title: string; detail: string | null; files: unknown; branch: string | null; status: string; origin: string; completedBy: string | null; subFlowId: string | null; createdAt: unknown; updatedAt: unknown }>(
      `SELECT id, flow_id AS "flowId", artifact_id AS "artifactId", meta_id AS "metaId", position, title, detail, files, branch, status, origin, completed_by AS "completedBy", sub_flow_id AS "subFlowId", created_at AS "createdAt", updated_at AS "updatedAt" FROM plan_steps WHERE sub_flow_id=$1`, childFlowId);
    if (!row) return undefined;
    return {
      ...row,
      files: typeof row.files === "string" ? row.files : JSON.stringify(row.files ?? []),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };
  }

  /** The child flow's persisted trigger payload (parsed; null when absent/unparseable). */
  async childPayload(childFlowId: string): Promise<StepChildPayload | null> {
    const row = await db.get<{ triggerPayload: unknown }>(
      `SELECT trigger_payload AS "triggerPayload" FROM flows WHERE id=$1`, childFlowId);
    const raw = row?.triggerPayload;
    if (raw == null) return null;
    try {
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as StepChildPayload;
      return parsed && typeof parsed === "object" && parsed.parentNodeKey ? parsed : null;
    } catch {
      return null;
    }
  }

  /** The child's merged node outputs (last write wins per key). */
  private async childOutput(childFlowId: string): Promise<Record<string, unknown> | null> {
    const outs = await db.all<{ output: unknown }>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND output IS NOT NULL ORDER BY updated_at`, childFlowId);
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

  /** The parent plan's title/summary for the child payload (`plan` part). */
  private async planSummary(parentFlowId: string): Promise<{ title: string; summary: string }> {
    const task = (await this.e.ctx(parentFlowId)).task;
    return { title: `${task.key}: ${task.summary}`, summary: task.summary };
  }
}

/** Shared application manager — bound to the flow engine by flow.ts at load. */
export const stepFlows = processSingleton("stepFlows", () => new StepFlowManager());

