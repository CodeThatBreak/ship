import "server-only";

import { db } from "../../../db/app";
import type { Prisma } from "@prisma/client";
import { templateStore, type TemplateGraph } from "../../templates/templateStore";
import { nodeRegistry } from "../../nodes/registry";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { splitConsumeOf } from "../../nodes/shared/nodeSharedExports";
import { DEFAULT_FANOUT_OUTPUT } from "../../nodes/shared/schemas/defaultOutputs";
import type { NodeCapabilities } from "../../nodes/shared/capabilities";
import { parseStartContract, validateAgainstContract } from "../../nodes/kinds/start/contract";
import { branchStore } from "../../nodes/kinds/build/branchStore";
import { branchNamer } from "../../nodes/shared/branchNamer";
import type { NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import { configString, fanoutOf, stripFanoutKeys, type FanoutKnob } from "../../templates/nodeConfig";
import { planSteps } from "../planStepStore";
import type { PlanStepRow } from "../planStepStore/types/planStep";
import { fanoutAutoWrapDescription, hashFanoutChildConfig } from "./utils/autowrapKey";
import { jsonInput } from "@/lib/db/ormRowHelpers";
import { filesOf } from "./utils/stepFiles";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepChildPayload } from "./types/stepChildPayload";
import type { StepState } from "./types/stepState";
import type { StepRollup } from "./stepRollup";
import type { StepScheduler } from "./stepScheduler";
import type { StepChildStore } from "./stepChildStore";

/**
 * StepFlowExpander — the fan-out gate and expansion of `StepFlowManager`
 * (step 07 decomposition): decides whether a node's run fans out at all
 * (`gate`/`resolveMode`), spawns one child flow per pending plan step
 * (`expand`), and derives the child template + branches
 * (`childTemplateId`/`autoWrap`/`integrationBranchFor`). It also refreshes a
 * child's sibling context at start time (`refreshSiblings`) and wraps a
 * whole-mode output as a single-entry aggregate (`wrapWholeOutput`).
 *
 * Invariants upheld:
 * - No nesting: a child flow never fans out again (the runtime mirror of the
 *   template lint rule).
 * - The child template resolves ONCE per expansion — a missing/unresolvable
 *   child fails the node loudly BEFORE any child row exists.
 * - An explicit child template's start contract validates the step payload
 *   exactly like a webhook delivery, also before any child row exists.
 * - `from-plan` + whole resolution always publishes the aggregate shape
 *   (`whole-wrap`) so downstream `{{nodes.X.output.steps.*}}` mappings survive
 *   plan revisions that change the checklist size.
 *
 * Must never:
 * - write `nodes.status` or publish transitions (the expansion only creates
 *   child rows and hands off to the `StepScheduler`);
 * - start children itself — scheduling belongs to the `StepScheduler`;
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `StepFlowEngine` surface).
 */
export class StepFlowExpander {
  constructor(
    private readonly engine: () => StepFlowEngine,
    private readonly children: StepChildStore,
    private readonly scheduler: StepScheduler,
    private readonly rollup: StepRollup,
  ) {}

  private get e(): StepFlowEngine {
    return this.engine();
  }

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
    const meta = (await this.e.latestResourceArtifact<{ meta: string | null }>(flowId, NODE_KEYS.PLAN))
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
    if (resolved.mode === "whole") {
      // documented conflict rule (split plan §2.4, Phase 4): a node whose
      // fan-out knob engaged keeps the fan-out behavior — record a split knob
      // it shadows so the trail explains the run's shape (step 07: the rule
      // lives in this gate, not in the stage runner)
      const shadowed = splitConsumeOf(config);
      if (shadowed !== "whole") {
        await this.e.emitLifecycle(flowId, nodeKey,
          `${nodeKey} ignores split_consume "${shadowed}" — the fan-out knob owns this run`,
          { nodeKey });
      }
      return "whole-wrap";
    }
    const pending = (await planSteps.list(flowId)).filter((s) => s.status === "pending" && s.subFlowId == null);
    if (!pending.length) return null; // nothing to expand — the whole path runs
    // the same conflict rule applies when the fan-out expansion engages
    const shadowed = splitConsumeOf(config);
    if (shadowed !== "whole") {
      await this.e.emitLifecycle(flowId, nodeKey,
        `${nodeKey} ignores split_consume "${shadowed}" — the fan-out knob owns this run`,
        { nodeKey });
    }
    return "fanout";
  }

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
        files: filesOf(pending[0]),
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
            files: filesOf(stepRow),
            ...(branch ? { branch } : {}),
          },
          siblings: (await planSteps.list(parentFlowId, tx))
            .filter((s) => s.id !== stepRow.id)
            .map((s) => ({ id: s.metaId ?? s.id, title: s.title, files: filesOf(s), status: s.status })),
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
        // the composite guard (id + flow) is the linkage fence — a child is
        // linked to its own parent's step only; a zero-count update is a bug
        const linked = await tx.planStep.updateMany({
          where: { id: stepRow.id, flowId: parentFlowId },
          data: { subFlowId: childId, updatedAt: new Date() },
        });
        if (linked.count !== 1) {
          throw new Error(`fan-out: plan step "${stepRow.id}" could not be linked to its child flow`);
        }
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
    const attemptId = (await db.prisma.node.findFirst({ where: { flowId: parentFlowId, nodeKey }, select: { attemptId: true } }))?.attemptId;
    if (attemptId) this.rollup.captureAggregateAttempt(parentFlowId, nodeKey, attemptId);
    const parallelMax = Math.max(1, fanoutOf(await this.e.nodeConfigFor(parentFlowId, nodeKey)).parallelMax);
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `${nodeKey} fans out into ${made} step sub-flow${made > 1 ? "s" : ""} — one child per pending plan step${parallelMax > 1 ? `, up to ${parallelMax} concurrent (file-disjoint)` : ", sequential"}`,
      { nodeKey });
    await this.scheduler.advance(parentFlowId, nodeKey);
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
  async refreshSiblings(
    parentFlowId: string,
    nodeKey: string,
    childFlowId: string,
    states: StepState[],
  ): Promise<void> {
    const payload = await this.children.childPayload(childFlowId);
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
          const out = s.childFlowId ? await this.children.childOutput(s.childFlowId) : null;
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
            files: filesOf(s.step),
            status,
            ...(summary ? { summary } : {}),
            ...(mergeStatus ? { mergeStatus } : {}),
          };
        }),
    );
    await db.prisma.flow.update({
      where: { id: childFlowId },
      data: { triggerPayload: jsonInput(payload), updatedAt: new Date() },
    });
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
    await db.prisma.flowTemplate.update({
      where: { id: tplId },
      data: { hidden: true, updatedAt: new Date() },
    });
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

  // ── whole-path wrap (from-plan + whole plan resolution) ─────────────────────
  /**
   * Wrap a fan-out node's whole-mode native output as a single-entry aggregate
   * (`step.id: "whole"` distinguishes it — spec §contract consequence).
   */
  async wrapWholeOutput(flowId: string, nodeKey: string): Promise<void> {
    const node = await db.prisma.node.findUnique({
      where: { flowId_nodeKey: { flowId, nodeKey } },
      select: { id: true, output: true },
    });
    if (!node) return;
    let native: unknown = null;
    try { native = typeof node.output === "string" ? JSON.parse(node.output) : node.output ?? null; } catch { native = null; }
    const task = (await this.e.ctx(flowId)).task;
    const wrapped = {
      steps: [{ id: "whole", title: task?.summary ?? nodeKey, status: "done", output: native ?? {} }],
    };
    DEFAULT_FANOUT_OUTPUT.parse(wrapped);
    await db.prisma.node.update({
      where: { id: node.id },
      data: { output: jsonInput(wrapped), updatedAt: new Date() },
    });
  }

  /** The parent plan's title/summary for the child payload (`plan` part). */
  private async planSummary(parentFlowId: string): Promise<{ title: string; summary: string }> {
    const task = (await this.e.ctx(parentFlowId)).task;
    return { title: `${task.key}: ${task.summary}`, summary: task.summary };
  }
}
