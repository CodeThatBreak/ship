import "server-only";

import { db } from "../../../db";
import type { FlowRow } from "../../../db/rows";
import { templateStore, type TemplateGraph } from "../../templates/template-store";
import { nodeRegistry } from "../../nodes/registry";
import { NODE_KEYS } from "../../constants/node-keys";
import type { ChainRole, NodeDefinition } from "../../nodes/shared";
import {
  DEFAULT_FANOUT_OUTPUT,
  type NodeCapabilities,
} from "../../nodes/shared/capabilities";
import { parseStartContract, validateAgainstContract } from "../../nodes/kinds/start/contract";
import { prompts } from "../../prompts/prompt-library";
import { branchStore } from "../../nodes/kinds/build/branch-store";
import { flowCtxHelper, type FlowCtx } from "../../nodes/shared/run-context";
import { nodeSupport } from "../../nodes/shared/node-support";
import { planSteps, type PlanStepRow } from "../plan-step-store";
import { configNumber, configString, fanoutOf, parseConfigSnapshot, stripFanoutKeys, type FanoutKnob } from "../../templates/node-config";
import { mergeArena } from "./merge-arena";
import { worktreeManager } from "../worktree-lifecycle";
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
}

/** Per-node fan-out progress for the parent panel / graph subtitle. */
export interface FanoutProgress {
  total: number;
  done: number;
  building: number;
  awaiting: number;
  failed: number;
  skipped: number;
}

/** Live state of one step child, derived from plan_steps + the child flow. */
export interface StepState {
  step: PlanStepRow;
  childFlowId: string | null;
  childStatus: string | null; // flows.status of the child ('done' when closed)
  childNodeKey: string | null;
  childNodeType: string | null;
  /** rolled-up child node status: failed > awaiting_approval > running > done (> null = no run yet) */
  childNodeStatus: string | null;
  /** the child's own step branch (code children only; from flows.mr_branch) */
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
export { STEP_BUILD_TEMPLATE_ID } from "../../constants/node-keys";

export class StepFlowManager {
  /** Engine surface the manager drives (bound once by flow.ts at module load). */
  private engine: {
    ctx(flowId: string): FlowCtx;
    nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown>;
    defOf(flowId: string, nodeKey: string): { key: string; label: string; capabilities: NodeCapabilities };
    createStepChild(
      parentFlowId: string,
      templateId: string,
      name: string,
      payload: StepChildPayload,
      opts: { branch: string | null }
    ): string;
    startStepChild(childFlowId: string): void;
    finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): void;
    cancelNode(flowId: string, nodeKey: string): Promise<void>;
    setNodeStatus(flowId: string, nodeKey: string, status: string): void;
    bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
    /** run a node with a validated rawInput (the Phase-2 merge-fix agent drives
     *  the step child's runNode-with-feedback path, exactly like the SDLC
     *  chain's commit-fix reuses runNode for push rejections) */
    runNode(flowId: string, nodeKey: string, rawInput: unknown): Promise<string>;
    /** the latest artifact version a chain role's def published as a
     *  first-class resource (§T3/F3) — the plan version the mode resolution
     *  reads, scoped through the plan def's metadata instead of a literal kind */
    latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): T | undefined;
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
  publishedExecution(flowId: string): "whole" | "steps" | null {
    const meta = this.e.latestResourceArtifact<{ meta: string | null }>(flowId, NODE_KEYS.PLAN, "a.meta")
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
  gate(flowId: string, nodeKey: string): "fanout" | "whole-wrap" | null {
    const config = this.e.nodeConfigFor(flowId, nodeKey);
    const knob = fanoutOf(config);
    if (knob.mode === "whole") return null; // the frozen default — nothing to do
    const ctx = this.e.ctx(flowId);
    if (ctx.flow.parent_flow_id != null) return null; // no nesting (lint rule 3's runtime mirror)
    const resolved = this.resolveMode(config, this.publishedExecution(flowId));
    if (resolved.override) {
      db.emitEvent(flowId, null, "lifecycle",
        `${nodeKey} fan-out mode "${resolved.mode}" overrides the plan's published execution "${resolved.published}"`,
        { nodeKey });
    }
    if (resolved.mode === "whole") return "whole-wrap";
    const pending = planSteps.list(flowId).filter((s) => s.status === "pending" && s.sub_flow_id == null);
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
  expand(parentFlowId: string, nodeKey: string): boolean {
    const ctx = this.e.ctx(parentFlowId);
    const summary = this.planSummary(parentFlowId);
    const pending = planSteps.list(parentFlowId).filter((s) => s.status === "pending" && s.sub_flow_id == null);
    if (!pending.length) return false;
    const spec = templateStore.graphForFlow(parentFlowId)?.byKey.get(nodeKey);
    // the parent def owns its fan-out fallback child (§T3/F5) — resolved like
    // every def in the engine (built-in by key, declarative by row + instance)
    const parentDef = spec ? nodeRegistry.resolve(spec.defKey ?? nodeKey, nodeKey) : undefined;
    // the child template resolves ONCE per expansion — a missing/unresolvable
    // child fails the node loudly before any child row exists
    const templateId = this.childTemplateId(
      parentFlowId, nodeKey, parentDef,
      fanoutOf(this.e.nodeConfigFor(parentFlowId, nodeKey)));
    const childGraph = templateStore.graph(templateId);
    if (!childGraph?.nodes.length) {
      throw new Error(`fan-out: child template "${templateId}" has no nodes`);
    }
    const codeChild = Boolean((nodeRegistry.maybe(childGraph.nodes[0].defKey)?.capabilities as NodeCapabilities | undefined)?.mergeBack);
    const integrationBranchOf = (planBranch: string | null) => this.integrationBranchFor(parentFlowId, nodeKey, planBranch);

    // §2 data model: when the EXPLICIT child template declares a start
    // contract, the `{plan, step, siblings}` payload is validated against it
    // exactly like a webhook delivery — before any child row exists (Phase
    // 3C: explicit picks run the §2 check; auto-wrapped/step-build templates
    // declare no start node, so the payload flows straight into input
    // mapping and prompt variables as before)
    this.validateChildStartContract(childGraph, templateId, {
      plan: summary,
      step: {
        id: pending[0].meta_id ?? pending[0].id,
        title: pending[0].title,
        detail: pending[0].detail,
        files: StepFlowManager.filesOf(pending[0]),
      },
      // the siblings/parentNodeKey shape is fixed by the payload builder
      siblings: [],
      parentNodeKey: nodeKey,
    } as unknown as StepChildPayload);

    let made = 0;
    for (const stepRow of pending) {
      const integrationBranch = integrationBranchOf(stepRow.branch);
      const groupIndex = this.branchGroupIndex(parentFlowId, integrationBranch, stepRow, integrationBranchOf);
      const branch = codeChild ? `${integrationBranch}-s${groupIndex + 1}` : null;

      const payload: StepChildPayload = {
        plan: summary,
        step: {
          id: stepRow.meta_id ?? stepRow.id,
          title: stepRow.title,
          detail: stepRow.detail,
          files: StepFlowManager.filesOf(stepRow),
          ...(branch ? { branch } : {}),
        },
        siblings: planSteps.list(parentFlowId)
          .filter((s) => s.id !== stepRow.id)
          .map((s) => ({ id: s.meta_id ?? s.id, title: s.title, files: StepFlowManager.filesOf(s), status: s.status })),
        parentNodeKey: nodeKey,
      };
      const childId = this.e.createStepChild(
        parentFlowId,
        templateId,
        `${ctx.flow.name} · step: ${stepRow.title}`,
        payload,
        { branch }
      );
      db.run(`UPDATE plan_steps SET sub_flow_id=?, updated_at=? WHERE id=? AND flow_id=?`,
        childId, db.now(), stepRow.id, parentFlowId);
      if (codeChild) {
        // integration branch rows mirror the whole-mode branch decomposition so
        // the final aggregate approval's MR targets resolve through the chain
        if (!branchStore.list(parentFlowId).some((b) => b.name === integrationBranch)) {
          branchStore.upsert(parentFlowId, integrationBranch, {
            title: `steps${stepRow.branch ? ` · ${stepRow.branch}` : ""}`,
            order: branchStore.list(parentFlowId).length,
            status: "pending",
          });
        }
      }
      db.emitEvent(parentFlowId, null, "lifecycle",
        `fan-out: step "${stepRow.title}" → child flow${branch ? ` · branch ${branch}` : ""}`,
        { nodeKey, childFlowId: childId });
      made++;
    }

    if (!made) return false;
    this.e.setNodeStatus(parentFlowId, nodeKey, "running");
    const parallelMax = Math.max(1, fanoutOf(this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    db.emitEvent(parentFlowId, null, "lifecycle",
      `${nodeKey} fans out into ${made} step sub-flow${made > 1 ? "s" : ""} — one child per pending plan step${parallelMax > 1 ? `, up to ${parallelMax} concurrent (file-disjoint)` : ", sequential"}`,
      { nodeKey });
    void this.advance(parentFlowId, nodeKey);
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
  private refreshSiblings(
    parentFlowId: string,
    nodeKey: string,
    childFlowId: string,
    states: StepState[],
  ): void {
    const payload = this.childPayload(childFlowId);
    if (!payload) return;
    payload.siblings = states
      .filter((s) => s.childFlowId != null && s.childFlowId !== childFlowId)
      .map((s) => {
        const isCode = s.isCodeChild;
        const done = s.step.status === "done";
        let status: string;
        if (s.step.completed_by === "skipped") status = "skipped";
        else if (s.isFailed) status = "failed";
        else if (done) status = isCode ? "merged" : "done";
        else if (s.isAwaiting) status = "awaiting approval";
        else if (s.isRunning) status = "building";
        else status = "pending";
        let summary: string | undefined;
        let mergeStatus: string | undefined;
        const out = s.childFlowId ? this.childOutput(s.childFlowId) : null;
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
          id: s.step.meta_id ?? s.step.id,
          title: s.step.title,
          files: StepFlowManager.filesOf(s.step),
          status,
          ...(summary ? { summary } : {}),
          ...(mergeStatus ? { mergeStatus } : {}),
        };
      });
    db.run(`UPDATE flows SET trigger_payload=?, updated_at=? WHERE id=?`,
      JSON.stringify(payload), db.now(), childFlowId);
  }

  /** The child template's declared start contract, validated against the step payload
   *  (§2: "exactly like a webhook delivery") — a no-op when none declares fields. */
  validateChildStartContract(childGraph: TemplateGraph, templateId: string, payload: unknown): void {
    const startSpec = childGraph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (!contractFields.length) return;
    const v = validateAgainstContract(contractFields, payload);
    if (!v.ok) {
      throw new Error(
        `fan-out: the step payload doesn't match the child template "${templateStore.flowTemplate(templateId)?.name ?? templateId}" start contract — ${v.error}`);
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
  integrationBranchFor(parentFlowId: string, nodeOwnerKey: string, planBranch: string | null): string {
    const ctx = this.e.ctx(parentFlowId);
    const pattern = configString(this.e.nodeConfigFor(parentFlowId, nodeOwnerKey), "branch_pattern");
    if (!pattern?.trim()) return flowCtxHelper.buildBranch(ctx, planBranch ?? undefined);
    const slug = String(ctx.task.key ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const type = String(ctx.task.issueType ?? "").toLowerCase();
    const prefix = /story|feature|task|epic/.test(type) ? "feature" : "bugfix";
    return pattern.trim()
      .replace(/\{prefix\}/g, prefix)
      .replace(/\{slug\}/g, slug)
      .replace(/\{ticket\}/g, String(ctx.task.key ?? "task"))
      .replace(/\{id\}/g, ctx.flow.id.slice(-6))
      .replace(/\{suffix\}/g, planBranch ?? "");
  }

  /** Child template id: explicit `knob.child` | the parent def's fallback child
   *  (the build's seeded step build, §T3/F5) | auto-wrap. */
  private childTemplateId(parentFlowId: string, nodeKey: string, parentDef: NodeDefinition | undefined, knob: FanoutKnob): string {
    if (knob.child) {
      if (!templateStore.flowTemplate(knob.child)) {
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

  /** Find-or-create the hidden `"{label} · step"` child template (auto-wrap). */
  private autoWrap(parentFlowId: string, nodeKey: string): string {
    const spec = templateStore.graphForFlow(parentFlowId)?.byKey.get(nodeKey);
    if (!spec) throw new Error(`fan-out: node "${nodeKey}" is not a template node`);
    const name = `${spec.label} · step`;
    const existing = templateStore.list().find((t) => t.hidden === 1 && t.name === name);
    if (existing) return existing.id;
    // trigger type: approval if the parent's is approval else auto — an
    // approval parent's gate BECOMES the per-step gates; the parent itself
    // never gates in fan-out mode (spec §auto-wrap)
    const parentTrigger = spec.trigger.type;
    // config copied exactly from the parent's effective snapshot minus the
    // fan-out knobs themselves (a child never fans out — lint rule 3)
    const effective = this.e.nodeConfigFor(parentFlowId, nodeKey);
    const tplId = templateStore.create({
      name,
      description: `Auto-wrapped step-child of "${spec.label}" (plan fan-out) — one node instance; step context arrives as the trigger payload.`,
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
    db.run(`UPDATE flow_templates SET hidden=1, updated_at=? WHERE id=?`, db.now(), tplId);
    return tplId;
  }

  /** 0-based index of the step within its integration-branch group (ordered by position). */
  private branchGroupIndex(
    parentFlowId: string,
    integrationBranch: string,
    self: PlanStepRow,
    integrationBranchOf: (planBranch: string | null) => string
  ): number {
    const group = planSteps
      .list(parentFlowId)
      .filter((s) => integrationBranchOf(s.branch) === integrationBranch)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
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
  advance(parentFlowId: string, nodeKey: string): void {
    const states = this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    // claims prevent double-starts when two hooks hit advance concurrently
    // (parallel scheduling widens the expand/terminal/merge hook overlap)
    const now = Date.now();
    for (const [id, at] of this.claimedStarts) {
      if (now - at > 60_000) this.claimedStarts.delete(id);
    }
    for (const s of states) if (s.childFlowId && s.childNodeStatus !== null) this.claimedStarts.delete(s.childFlowId);
    const maxParallel = Math.max(1, fanoutOf(this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    const inFlight = states.filter((s) => s.isRunning || s.isAwaiting);
    let slots = maxParallel - inFlight.length;
    if (slots > 0) {
      const unresolved = new Set(states.filter((o) => !o.isResolved).map((o) => o.childFlowId));
      const queue = states
        .filter((s) =>
          s.childFlowId != null && // spawned…
          s.childNodeStatus === null && // …but never run yet
          s.step.status === "pending" &&
          !this.claimedStarts.has(s.childFlowId!))
        .sort((a, b) => a.step.position - b.step.position);
      for (const s of queue) {
        if (slots <= 0) break;
        // an earlier overlapping sibling still in flight ⇒ sequential
        const blocked =
          states.some((o) =>
            o.childFlowId !== s.childFlowId &&
            unresolved.has(o.childFlowId!) &&
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
        this.claimedStarts.set(s.childFlowId!, now);
        this.refreshSiblings(parentFlowId, nodeKey, s.childFlowId!, states);
        this.e.startStepChild(s.childFlowId!); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    void this.checkRollup(parentFlowId, nodeKey);
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
  onChildFinished(childFlowId: string): void {
    const link = db.get<{ flow_id: string }>(`SELECT flow_id FROM plan_steps WHERE sub_flow_id=?`, childFlowId);
    if (!link) return;
    const payload = this.childPayload(childFlowId);
    const parentNodeKey = payload?.parentNodeKey;
    if (!parentNodeKey) return; // no fan-out linkage — nothing this manager scheduled
    const nodes = db.all<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, childFlowId);
    const flowStatus = this.childFlowStatus(childFlowId);
    const allTerminal = nodes.length > 0 && nodes.every((n) => ["done", "approved", "failed", "skipped"].includes(n.status));
    if (!allTerminal && flowStatus !== "done") return;
    db.emitEvent(link.flow_id, null, "lifecycle",
      `step child resolved ("${payload.step.title}")`,
      { nodeKey: parentNodeKey, childFlowId });
    void this.checkRollup(link.flow_id, parentNodeKey);
  }

  /** Rollup: when every linked child is resolved, publish the aggregate (all resolved). */
  private async checkRollup(parentFlowId: string, nodeKey: string): Promise<void> {
    const states = this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return;
    if (states.some((s) => s.childFlowId != null && !s.isResolved && !s.isFailed)) return;
    if (states.some((s) => s.childFlowId == null && s.step.status === "pending")) return;
    // successful children flip their plan steps done (`plan_steps.status`
    // semantics unchanged — done on child success/merge, never on agent claim)
    for (const s of states) {
      if (s.step.status === "pending" && s.isResolved && !s.isFailed) {
        planSteps.setStatus(parentFlowId, s.step.id, "done", "child");
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
    const ctx = this.e.ctx(parentFlowId);
    const states = this.statesOf(parentFlowId, nodeKey);
    const def = this.e.defOf(parentFlowId, nodeKey);
    const isCode = typeof def.capabilities.mergeBack === "function";

    const stepsOut = states.map((s) => {
      const out = s.childFlowId ? this.childOutput(s.childFlowId) : null;
      const outObj = out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
      const artifactId = outObj?.latestArtifact ?? outObj?.artifact_id ?? outObj?.output_id ?? null;
      return {
        id: s.step.meta_id ?? s.step.id,
        title: s.step.title,
        status: this.aggregateStatus(s),
        branch: s.branch ?? undefined,
        artifact_id: typeof artifactId === "string" ? artifactId : undefined,
        output: outObj ?? {},
      };
    });
    const aggregate = { steps: DEFAULT_FANOUT_OUTPUT.parse({ steps: stepsOut }).steps };

    // code children merged onto integration branches: publish the parent-side
    // diff artifacts (the whole-mode finalizeBuild contract: branch +
    // latestArtifact) underneath the aggregate — the BuildView panel reads them
    const integrationBranches = [...new Set(states.map((s) => s.integrationBranch).filter((b): b is string => Boolean(b)))];
    const perBranch: Record<string, string> = {};
    let latestArtifact: string | null = null;
    if (isCode) {
      const nodeId = db.get<{ id: string }>(
        `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, parentFlowId, nodeKey)?.id ?? null;
      for (const branch of integrationBranches) {
        const group = states.filter((s) => s.integrationBranch === branch);
        if (!group.some((s) => s.step.status === "done" && s.step.completed_by === "merge")) continue;
        branchStore.upsert(parentFlowId, branch, { status: "awaiting_approval" });
        db.run(`UPDATE flows SET mr_branch=? WHERE id=? AND (mr_branch IS NULL OR mr_branch='')`, branch, parentFlowId);
        if (!nodeId) continue;
        try {
          const diff = await flowCtxHelper.makeDiff(ctx, branch);
          const art = nodeSupport.saveArtifact(
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

    this.e.finishFanout(parentFlowId, nodeKey, {
      steps: aggregate.steps,
      ...(integrationBranches[0] ? { branch: integrationBranches[0] } : {}),
      ...(latestArtifact ? { latestArtifact } : {}),
      ...(integrationBranches.length > 1 ? { branchArtifacts: perBranch } : {}),
    });
  }

  private aggregateStatus(s: StepState): "done" | "failed" | "skipped" {
    if (s.step.completed_by === "skipped") return "skipped";
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
  approveChildStep(childFlowId: string): void {
    const childFlow = this.childFlowOf(childFlowId);
    const payload = this.childPayload(childFlowId);
    if (!childFlow?.parent_flow_id || !payload?.parentNodeKey) {
      throw new Error("this flow is not a fan-out step child");
    }
    const parentFlowId = childFlow.parent_flow_id;
    const node = db.get<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, childFlowId);
    if (!node) throw new Error("the step child has no nodes");
    if (node.status !== "awaiting_approval") throw new Error(`the step is ${node.status}, not awaiting approval`);
    const stepRow = this.stepRowOf(childFlowId);
    if (!stepRow) throw new Error("the step child has no linked plan step");
    const ctx = this.e.ctx(childFlowId);
    const branch = ctx.flow.mr_branch;
    if (!branch) throw new Error("the step child has no step branch to merge");
    const integrationBranch = this.integrationBranchFor(parentFlowId, payload.parentNodeKey, stepRow.branch ?? null);

    db.emitEvent(childFlowId, null, "lifecycle",
      `step approved${typeof this.engineCapabilitiesOfMergeBack(childFlowId) === "function" ? ` — merging ${branch} into ${integrationBranch}` : ""}`);
    if (typeof this.engineCapabilitiesOfMergeBack(childFlowId) !== "function") {
      // non-code child: nothing to merge — approval closes the child
      db.run(`UPDATE plan_steps SET status='done', completed_by='approved', updated_at=? WHERE sub_flow_id=?`,
        db.now(), childFlowId);
      this.closeChild(childFlowId);
      this.onChildFinished(childFlowId);
      return;
    }
    db.run(`UPDATE plan_steps SET completed_by='merge', updated_at=? WHERE sub_flow_id=?`, db.now(), childFlowId);
    void this.runMergeBack(parentFlowId, childFlowId, payload, stepRow, node.node_key, branch, integrationBranch);
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
    const nodeRef = db.get<{ id: string }>(`SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, childFlowId, childNodeKey);
    const maxAttempts = Math.max(1, configNumber(
      this.e.nodeConfigFor(parentFlowId, nodeOwnerKey), "max_merge_fix_attempts", 2));
    if (resumeNote) {
      db.emitEvent(parentFlowId, null, "lifecycle", resumeNote,
        { nodeKey: nodeOwnerKey, childFlowId });
    }
    // NOTE: no mergeArena.dropLocks here — the per-branch lock is FIFO and its
    // chained promises always settle, so dropping it would let a concurrently
    // queued sibling merge run beside the in-flight one (Phase 3A parallel
    // approvals queue instead). Resume-after-restart starts with an empty
    // lock map — reconcile never needs to drop either.
    let mergeRowId = resumeRowId ?? undefined;
    try {
      for (;;) {
        // abandoned approvals hand-back: the step may have been skipped (or
        // closed by a checklist edit) while this loop awaited — never land it
        const live = this.stepRowOf(childFlowId);
        const nodeStatus = db.get<{ status: string }>(
          `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, childFlowId, childNodeKey)?.status;
        if (!live || live.completed_by === "skipped" || !nodeStatus ||
            (nodeStatus !== "awaiting_approval" && nodeStatus !== "running")) {
          db.emitEvent(parentFlowId, null, "lifecycle",
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
          message: `[${stepRow.meta_id ?? "s?"}] ${stepRow.title}`,
          baseBranch: this.e.ctx(parentFlowId).repo?.default_branch ?? "main",
          ...(mergeRowId ? { mergeRowId } : {}),
        });
        // the arena ROW id is bookkeeping truth — adopt it for re-attempts
        mergeRowId = db.get<{ id: string }>(
          `SELECT id FROM step_merges WHERE flow_id=? ORDER BY created_at DESC, id DESC LIMIT 1`, childFlowId
        )?.id ?? mergeRowId;

        if (result.status === "merged") {
          planSteps.setStatus(parentFlowId, stepRow.id, "done", "merge");
          this.closeChild(childFlowId);
          db.emitEvent(parentFlowId, null, "lifecycle",
            `step "${stepRow.title}" merged into ${integrationBranch}${result.stale ? " (stale base resolved by merge — no rebase)" : ""}`,
            { nodeKey: nodeOwnerKey, childFlowId });
          this.onChildFinished(childFlowId);
          return;
        }

        // infra failure: the commit-fix classification — an agent cannot code
        // away network/auth. Fail visible; the user Retry re-runs the loop.
        if (result.status === "failed") {
          this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, result.error);
          return;
        }

        // conflict / rejected — repairable code state → the bounded fix agent
        const attempts = mergeRowId
          ? (db.get<{ attempts: number }>(`SELECT attempts FROM step_merges WHERE id=?`, mergeRowId)?.attempts ?? 0)
          : 1;
        if (attempts > maxAttempts) {
          const err = `${result.status} after ${attempts - 1} merge-fix agent runs (max ${maxAttempts}): ${result.error}`;
          this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey, err);
          return;
        }
        db.emitEvent(parentFlowId, null, "lifecycle",
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
          this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
            `merge-fix agent failed: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (nodeRef) {
          // the fix run ended `awaiting_approval` (a new diff is up) — keep the
          // loop's merge-underway semantics visible on the parent card
          db.emitEvent(parentFlowId, nodeRef.id, "lifecycle",
            `merge-fix agent finished — re-attempting the arena merge`,
            { nodeKey: nodeOwnerKey, childFlowId });
        }
        db.run(`UPDATE nodes SET status='awaiting_approval', updated_at=? WHERE flow_id=? AND node_key=?`,
          db.now(), childFlowId, childNodeKey);
      }
    } catch (e: unknown) {
      this.failMergeBack(parentFlowId, childFlowId, childNodeKey, stepRow, nodeOwnerKey,
        e instanceof Error ? e.message : String(e));
    }
  }

  /** Mark a merge-back failed loud: step_merges → failed, child node → failed, failure on the parent. */
  private failMergeBack(
    parentFlowId: string,
    childFlowId: string,
    childNodeKey: string,
    stepRow: PlanStepRow,
    parentNodeKey: string,
    error: string,
  ): void {
    db.run(`UPDATE step_merges SET status='failed', error=?, updated_at=? WHERE flow_id=? AND status IN ('running','conflict','rejected')`,
      error.slice(0, 2000), db.now(), childFlowId);
    db.run(`UPDATE nodes SET status='failed', updated_at=? WHERE flow_id=? AND node_key=?`,
      db.now(), childFlowId, childNodeKey);
    db.emitEvent(childFlowId, null, "error", `merge-back failed: ${error}`, { nodeKey: childNodeKey });
    db.emitEvent(parentFlowId, null, "error",
      `step "${stepRow.title}" merge-back failed: ${error} — Retry the step to re-run the merge (+ fix agent)`,
      { nodeKey: parentNodeKey, childFlowId });
    this.onChildFinished(childFlowId);
  }

  // ── reconcile resume (Phase 2B: restart mid-merge) ─────────────────────────

  /**
   * A `running`/`conflict` step_merges row whose owning run is dead (server
   * restart): re-enter the merge-back loop on the same durable row. The child
   * node must still be approved/underway for this to be safe (caller checks —
   * reconcile only resumes awaiting-approval children). The loop re-verifies
   * step ownership before every attempt.
   */
  resumePendingMerge(childFlowId: string): void {
    const payload = this.childPayload(childFlowId);
    const stepRow = this.stepRowOf(childFlowId);
    const childNode = db.get<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, childFlowId);
    const childFlow = this.childFlowOf(childFlowId);
    const row = db.get<{ id: string; status: string }>(
      `SELECT id, status FROM step_merges WHERE flow_id=? AND status IN ('running','conflict') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    if (!payload?.parentNodeKey || !stepRow || !childNode || !childFlow?.parent_flow_id || !row) {
      db.emitEvent(childFlowId, null, "error", "a pending step merge could not be resumed (the fan-out linkage is gone)");
      return;
    }
    const integrationBranch = this.integrationBranchFor(
      childFlow.parent_flow_id, payload.parentNodeKey, stepRow.branch ?? null);
    const branch = childFlow.mr_branch;
    if (!branch) {
      db.run(`UPDATE step_merges SET status='failed', error='restart interrupted the merge and the step branch is lost', updated_at=? WHERE id=?`,
        db.now(), row.id);
      return;
    }
    void this.runMergeBack(
      childFlow.parent_flow_id, childFlowId, payload, stepRow, childNode.node_key, branch,
      integrationBranch, row.id,
      `merge-back for step "${stepRow.title}" was interrupted by a restart — resuming (bounded by the merge-fix budget)`);
  }

  /**
   * User Retry on a merge-failed step: re-enter the merge-back loop from the
   * failed row instead of re-running the step build (the Retry button's
   * merge-failure path — a plain build failure with no merge row keeps
   * routing to the standard node retry).
   */
  resumeMergeRetry(parentFlowId: string, childFlowId: string): boolean {
    const row = db.get<{ id: string }>(
      `SELECT id FROM step_merges WHERE flow_id=? AND status IN ('conflict','rejected','failed') ORDER BY created_at DESC LIMIT 1`,
      childFlowId);
    const childNode = db.get<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, childFlowId);
    if (!row || !childNode || childNode.status !== "failed") return false;
    db.run(`UPDATE nodes SET status='awaiting_approval', updated_at=? WHERE flow_id=? AND node_key=?`,
      db.now(), childFlowId, childNode.node_key);
    this.resumePendingMerge(childFlowId);
    return true;
  }

  /** The child's def mergeBack hook presence — internal. */
  private engineCapabilitiesOfMergeBack(childFlowId: string): unknown {
    const node = db.get<{ node_key: string }>(`SELECT node_key FROM nodes WHERE flow_id=?`, childFlowId);
    if (!node) return null;
    const def = nodeRegistry.maybe(this.childTypeOf(childFlowId)) ?? undefined;
    return (def?.capabilities as NodeCapabilities | undefined)?.mergeBack ?? null;
  }

  private childTypeOf(childFlowId: string): string {
    return db.get<{ type: string }>(
      `SELECT type FROM nodes WHERE flow_id=?`, childFlowId)?.type ?? "";
  }

  /** Skip a step: mark done with `completed_by: 'skipped'`, cancel the child,
   *  drop its merge rows (a restart must never resume a skipped step's merge),
   *  delete the step branch (code children) and sweep the child worktree, emit,
   *  advance. Skipped steps stay visible on the checklist + parent card. */
  async skipStepFlow(parentFlowId: string, stepId: string): Promise<void> {
    const step = planSteps.list(parentFlowId).find((s) => s.id === stepId);
    if (!step) throw new Error("plan step not found");
    if (step.status !== "pending") throw new Error(`the step is already ${step.status}`);
    // owning fan-out node: the child payload knows; unlinked steps resolve via
    // the parent's first configured fan-out node
    const nodeKey =
      (step.sub_flow_id ? this.childPayload(step.sub_flow_id)?.parentNodeKey : null) ??
      this.firstFanoutNodeKey(parentFlowId);
    if (!nodeKey) throw new Error("no fan-out node on this flow");
    planSteps.setStatus(parentFlowId, stepId, "done", "skipped");
    if (step.sub_flow_id) {
      const childId = step.sub_flow_id;
      const childFlow = this.childFlowOf(childId);
      // a stuck merge-back must never resume for a step the user skipped
      db.run(`UPDATE step_merges SET status='failed', error='step skipped — the merge-back was abandoned', updated_at=? WHERE flow_id=? AND status IN ('running','conflict','rejected')`,
        db.now(), childId);
      const codeChild = typeof this.engineCapabilitiesOfMergeBack(childId) === "function";
      for (const n of db.all<{ node_key: string; status: string }>(`SELECT node_key, status FROM nodes WHERE flow_id=?`, childId)) {
        if (["running", "awaiting_approval", "waiting", "pending"].includes(n.status)) {
          await this.e.cancelNode(childId, n.node_key); // marks failed + stops in-flight local runs (standard stop)
        }
      }
      // step-branch deletion on skip (Phase 2C) — the branch was created for
      // this step, and a skipped hand-back does not keep its work product
      if (codeChild && childFlow?.mr_branch) {
        try {
          await mergeArena.deleteStepBranch(parentFlowId, childFlow.mr_branch, nodeKey);
        } catch (e: unknown) {
          db.emitEvent(parentFlowId, null, "lifecycle",
            `step-branch deletion skipped/failed (${e instanceof Error ? e.message : String(e)})`,
            { nodeKey, branch: childFlow.mr_branch });
        }
      }
      this.closeChild(childId);
    }
    db.emitEvent(parentFlowId, null, "lifecycle", `plan step skipped: ${step.title}`, { nodeKey });
    this.advance(parentFlowId, nodeKey);
  }

  /** The first node instance of the flow whose effective fan-out knob isn't whole. */
  private firstFanoutNodeKey(parentFlowId: string): string | null {
    for (const n of db.all<{ node_key: string; config: string | null }>(`SELECT node_key, config FROM nodes WHERE flow_id=?`, parentFlowId)) {
      if (fanoutOf(parseConfigSnapshot(n.config)).mode !== "whole") return n.node_key;
    }
    return null;
  }

  /** Internal helper for the checklist-edit guard: close a child that never started. */
  cancelUnstartedChild(childFlowId: string): void {
    const statuses = db.all<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, childFlowId).map((n) => n.status);
    if (statuses.some((s) => s === "running" || s === "awaiting_approval")) return; // started — never closed silently
    this.closeChild(childFlowId);
  }

  /**
   * Checklist-edit guards (mirror of assertPlanEditable): a step whose child
   * has started/merged cannot be deleted; a pending child with no run may be
   * removed — its child flow closes. Consumed by the plan-step editing paths.
   */
  deletableStepIds(flowId: string): { deletable: Set<string>; toCancel: Map<string, string> } {
    const deletable = new Set<string>();
    const toCancel = new Map<string, string>();
    for (const s of planSteps.list(flowId)) {
      if (!s.sub_flow_id) {
        deletable.add(s.id);
        continue;
      }
      const started = db.all<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, s.sub_flow_id)
        .some((n) => n.status === "running" || n.status === "awaiting_approval" || n.status === "failed" || n.status === "done" || n.status === "approved");
      if (started) continue; // building/done child — not deletable
      deletable.add(s.id);
      toCancel.set(s.id, s.sub_flow_id); // pending child with no run → removed + cancelled
    }
    return { deletable, toCancel };
  }

  // ── progress (parent panel + graph subtitle) ───────────────────────────────

  /** Fan-out progress for a parent node, or null when it never fanned out. */
  progress(parentFlowId: string, nodeKey: string): FanoutProgress | null {
    const states = this.statesOf(parentFlowId, nodeKey);
    if (!states.length) return null;
    const p: FanoutProgress = { total: states.length, done: 0, building: 0, awaiting: 0, failed: 0, skipped: 0 };
    for (const s of states) {
      if (s.step.completed_by === "skipped") p.skipped++;
      else if (s.step.status === "done") p.done++;
      else if (s.isFailed) p.failed++;
      else if (s.isAwaiting) p.awaiting++;
      else if (s.isRunning || s.childNodeStatus === "waiting") p.building++;
    }
    return p;
  }

  /**
   * Durable merge-back state per linked child (read-side, Phase 2): what the
   * parent panel's step cards key on — `mergeStatus` (running/conflict/
   * rejected/failed/merged), the fix-attempt count, the last error text, and
   * the stale-base derivation. `flowEngine.get()` folds this into each
   * plan step's `sub_flow` so the FanoutStepList renders the new states with
   * no extra side calls.
   */
  mergeStates(parentFlowId: string): Record<string, {
    mergeStatus: string | null;
    mergeAttempts: number;
    mergeError: string | null;
    staleBase: boolean;
  }> {
    const out: Record<string, { mergeStatus: string | null; mergeAttempts: number; mergeError: string | null; staleBase: boolean }> = {};
    // index by owner node key: one statesOf pass per owning node (usually one)
    // instead of one per step — Phase 3A de-O(k²)
    const perNode = new Map<string, string[]>();
    for (const s of planSteps.list(parentFlowId)) {
      if (!s.sub_flow_id) continue;
      const nodeKey = this.childPayload(s.sub_flow_id)?.parentNodeKey;
      if (!nodeKey) continue;
      const ids = perNode.get(nodeKey) ?? [];
      ids.push(s.sub_flow_id);
      perNode.set(nodeKey, ids);
    }
    for (const [nodeKey, ids] of perNode) {
      const states = this.statesOf(parentFlowId, nodeKey);
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
  wrapWholeOutput(flowId: string, nodeKey: string): void {
    const node = db.get<{ id: string; output: string | null }>(
      `SELECT id, output FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) return;
    let native: unknown = null;
    try { native = node.output ? JSON.parse(node.output) : null; } catch { native = null; }
    const task = this.e.ctx(flowId).task;
    const wrapped = {
      steps: [{ id: "whole", title: task?.summary ?? nodeKey, status: "done", output: native ?? {} }],
    };
    DEFAULT_FANOUT_OUTPUT.parse(wrapped);
    db.run(`UPDATE nodes SET output=?, updated_at=? WHERE id=?`, JSON.stringify(wrapped), db.now(), node.id);
  }

  // ── state derivation ────────────────────────────────────────────────────────

  /**
   * All step children a parent node owns. `null` engine key at bind time is
   * handled by callers via checkedRollup, so only linked rows are read here.
   */
  private statesOf(parentFlowId: string, nodeKey: string): StepState[] {
    const all = planSteps.list(parentFlowId).filter((s) => s.sub_flow_id != null);
    const states: StepState[] = [];
    for (const step of all) {
      const payload = this.childPayload(step.sub_flow_id!);
      if (!payload || payload.parentNodeKey !== nodeKey) continue;
      states.push(this.stateOf(parentFlowId, step, payload));
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
        o.step.completed_by === "merge");
    }
    return states;
  }

  private stateOf(parentFlowId: string, step: PlanStepRow, payload: StepChildPayload): StepState {
    const childFlowId = step.sub_flow_id!;
    const childFlow = this.childFlowOf(childFlowId) ?? null;
    const nodes = db.all<{ node_key: string; type: string; status: string }>(
      `SELECT node_key, type, status FROM nodes WHERE flow_id=? ORDER BY created_at`, childFlowId);
    const statuses = nodes.map((n) => n.status);
    const childDef = nodes.length ? nodeRegistry.maybe(nodes[0].type) : undefined;
    const isCodeChild = typeof (childDef?.capabilities as NodeCapabilities | undefined)?.mergeBack === "function";
    const rollup = StepFlowManager.childRollup(statuses, childFlow?.status ?? null);
    const merge = this.latestMergeRow(childFlowId);
    const isFailed =
      rollup === "failed" ||
      (merge != null && merge.status !== "merged" && step.status !== "done");
    return {
      step,
      childFlowId,
      childStatus: childFlow?.status ?? null,
      childNodeKey: nodes[0]?.node_key ?? null,
      childNodeType: nodes[0]?.type ?? null,
      childNodeStatus: rollup,
      branch: childFlow?.mr_branch ?? null,
      integrationBranch: isCodeChild ? this.integrationBranchFor(parentFlowId, payload.parentNodeKey, step.branch ?? null) : null,
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

  /** The latest step_merges row status for a child (null = none — non-code/no approval yet). */
  private latestMergeStatus(childFlowId: string): string | null {
    return this.latestMergeRow(childFlowId)?.status ?? null;
  }

  /** The latest step_merges row for a child (null = never merged/attempts). */
  private latestMergeRow(childFlowId: string): { status: string; attempts: number; error: string | null } | null {
    return db.get<{ status: string; attempts: number; error: string | null }>(
      `SELECT status, attempts, error FROM step_merges WHERE flow_id=? ORDER BY created_at DESC, id DESC LIMIT 1`,
      childFlowId
    ) ?? null;
  }

  /** Two steps overlap when their `files` lists share a path (empty lists ⇒ independent UNKNOWN ⇒ overlap). */
  private overlaps(a: StepState, b: StepState): boolean {
    const fa = StepFlowManager.filesOf(a.step);
    const fb = StepFlowManager.filesOf(b.step);
    if (!fa.length || !fb.length) return true;
    return fa.some((f) => fb.includes(f));
  }

  private childFlowOf(childFlowId: string): FlowRow | undefined {
    return db.get<FlowRow>(`SELECT * FROM flows WHERE id=?`, childFlowId);
  }

  /** Close a child flow (standard terminal state; keeps rows for the audit trail). */
  private closeChild(childFlowId: string): void {
    db.run(`UPDATE flows SET status='done', updated_at=? WHERE id=? AND status<>'done'`, db.now(), childFlowId);
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

  private childFlowStatus(childFlowId: string): string {
    return db.get<{ status: string }>(`SELECT status FROM flows WHERE id=?`, childFlowId)?.status ?? "";
  }

  private stepRowOf(childFlowId: string): PlanStepRow | undefined {
    return db.get<PlanStepRow>(`SELECT * FROM plan_steps WHERE sub_flow_id=?`, childFlowId);
  }

  /** The child flow's persisted trigger payload (parsed; null when absent/unparseable). */
  childPayload(childFlowId: string): StepChildPayload | null {
    const raw = db.get<{ trigger_payload: string | null }>(
      `SELECT trigger_payload FROM flows WHERE id=?`, childFlowId)?.trigger_payload ?? null;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StepChildPayload;
      return parsed && typeof parsed === "object" && parsed.parentNodeKey ? parsed : null;
    } catch {
      return null;
    }
  }

  /** The child's merged node outputs (last write wins per key). */
  private childOutput(childFlowId: string): Record<string, unknown> | null {
    const outs = db.all<{ output: string | null }>(
      `SELECT output FROM nodes WHERE flow_id=? AND output IS NOT NULL ORDER BY updated_at`, childFlowId);
    const merged: Record<string, unknown> = {};
    let any = false;
    for (const row of outs) {
      if (!row.output) continue;
      try {
        const parsed = JSON.parse(row.output);
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
  private planSummary(parentFlowId: string): { title: string; summary: string } {
    const task = this.e.ctx(parentFlowId).task;
    return { title: `${task.key}: ${task.summary}`, summary: task.summary };
  }
}

/** Shared application manager — bound to the flow engine by flow.ts at load. */
export const stepFlows = processSingleton("stepFlows", () => new StepFlowManager());

