import "server-only";

import type { FlowData } from "@/types/flow";
import { db } from "../db/app";
import {
  ArtifactRow,
  BranchRow,
  FlowRow,
  NodeRow,
  PlanStepRow,
  RunRow,
  Task,
  rows,
  type NodeStatus,
} from "../db/rows";
import { agentPortRegistry, type AgentRunResult } from "./ports/agentPort";
import { hostOf, type HostComment, type HostWebhookEvent } from "./ports/gitHost";
import { NodeDefinition, nodeSupport, splitConsumeOf, type ChainRole, type FlowCtx, type SplitConsumeMode } from "./nodes/shared/nodeSharedExports";
import { CHAT_DECLINED, nodeRoles } from "./nodes/shared/nodeRoles";
import { nodeRegistry } from "./nodes/registry";
import "./nodes/declarativeBootstrap";
import { NODE_KEYS } from "./constants/nodeKeys";
import { planSteps, type PlanStepInput } from "./runtime/planStepStore";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore, type TemplateGraph, type TemplateEdgeSpec } from "./templates/templateStore";
import { appLayerConfig, configNumber, mergeConfigLayers, parseConfigSnapshot } from "./templates/nodeConfig";
import { createSdlcChain } from "./nodes/chains/sdlcChain";
import { buildFlowContext, type FlowContextMap } from "./context/flowVariables";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata/eval";
import { hookStore } from "./runtime/hookStore";
import { nodeStore } from "./runtime/nodeStore";
import { commentStore } from "./runtime/commentStore";
import { FLOW_KIND } from "./constants/flowKind";
import { isNodeTerminalSuccess, NODE_STATUS } from "./constants/nodeStatus";
import { accumulateRunRow, emptyRunTokenBucket } from "./utils/runTokenRollup";
import { parseStartContract, validateAgainstContract } from "./nodes/kinds/start/contract";
import { DEFAULT_FANOUT_OUTPUT, uiCapabilities, type NodeCapabilities } from "./nodes/shared/capabilities";
import { stepFlows, StepFlowManager, type StepChildPayload } from "./runtime/fanout/stepFlowManager";
import { mergeArena } from "./runtime/fanout/mergeArena";
import { DEFAULT_SPLIT_OUTPUT, splitManager, type SplitChildPayload } from "./runtime/split/splitManager";
import { worktreeManager } from "./runtime/worktreeLifecycle";
import { processSingleton } from "../singleton";
import { normalizePlanThread } from "./nodes/kinds/plan/constants/planThread";
import { PlanStore } from "./nodes/kinds/plan/planStore";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../errors";
import { RunSupersededError } from "./errors/runSupersededError";
import { CommentIngestor } from "./runtime/commentIngestor";
import { EdgeActivator } from "./runtime/edgeActivator";
import { FlowFactory, type CreateFlowOptions } from "./runtime/flowFactory";
import { FlowReadModel } from "./runtime/flowReadModel";
import { WaitScheduler } from "./runtime/waitScheduler";

export type { CreateFlowOptions };

/** Flow-owned tables, in FK-safe delete order (children before `flows`).
 *  Keep in sync with `FLOW_CHILD_TABLES` in scripts/lib/seed-db.mjs. */
export const FLOW_CHILD_TABLES = [
  "step_merges", // parent_flow_id + flow_id — fan-out merge-back records
  "plan_steps", // sub_flow_id → flows (fan-out checklist)
  "events",
  "messages",
  "runs",
  "artifacts",
  "comments",
  "branches",
  "nodes",
  "hooks", // flow-bound inbound webhooks (wait_for nodes)
] as const;

/**
 * The flow orchestrator: flow creation and reads, node triggers, chat routing,
 * plan-step editing, retry / cancel, restart recovery, and git-host
 * webhook/comment ingestion.
 *
 * All node-type-specific behavior lives in the node classes (registry); this
 * class only sequences them and owns cross-node state transitions.
 *
 * Phase 1 (custom flows): every previously-hardcoded chain position
 * ("pipeline", "review", "resolve") is derived from the flow's template graph
 * (see `templateStore`) — no node-key constants here. Edge activation evaluates
 * the template's edges (join all/any, decision labels, JSONata conditions, real
 * re-entry loops) and starts satisfying targets per their trigger type;
 * debounced targets hold at `waiting` until their event source's quiet period
 * elapses. The built-in SDLC flow actions live in the `chains/sdlc-chain.ts`
 * builtin-chain module (pristine plan §2.1–2.2).
 */
export class FlowEngine {
  /** the SDLC builtin chain (approveBuild / panel stage entries) */
  private readonly waits = new WaitScheduler(this);
  private readonly edges = new EdgeActivator(this, this.waits);
  private readonly readModel = new FlowReadModel(this.waits);
  private readonly factory = new FlowFactory(this);
  private readonly comments = new CommentIngestor(this, this.waits);

  private readonly chain = createSdlcChain(this);

  create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): string {
    return this.factory.create(taskId, repoUrl, name, opts);
  }

  createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
  ): string {
    return this.factory.createStepChild(parentFlowId, templateId, name, payload, opts);
  }

  createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload,
  ): string {
    return this.factory.createSplitChild(parentFlowId, templateId, name, payload);
  }

  startStepChild(childFlowId: string): void {
    this.bg(childFlowId, null, async () => this.start(childFlowId));
  }

  get(id: string): FlowData | null {
    return this.readModel.get(id);
  }

  list() {
    return this.readModel.list();
  }

  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    await this.edges.advanceFrom(flowId, fromKey);
  }

  joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    return this.edges.joinSatisfied(flowId, g, key);
  }

  startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean } = {},
  ): Promise<void> {
    return this.edges.startNodeStage(flowId, nodeKey, opts);
  }

  armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): void {
    this.waits.armNodeWait(flowId, nodeKey, wait, minutes);
  }

  bounceCommentWaits(flowId: string): void {
    this.waits.bounceCommentWaits(flowId);
  }

  resolveScheduleAt(flowId: string): number | null {
    return this.waits.resolveScheduleAt(flowId);
  }

  resolveScheduleClock(flowId: string): string | null {
    return this.waits.resolveScheduleClock(flowId);
  }

  resolveScheduleLabel(flowId: string): string {
    return this.waits.resolveScheduleLabel(flowId);
  }

  resolveDelayMs(flowId?: string): number {
    return this.waits.resolveDelayMs(flowId);
  }

  startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): string {
    return this.factory.startFromTemplate(templateId, payload, opts);
  }

  resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): void {
    this.waits.resumeNodeFromWebhook(flowId, nodeKey, payload);
  }

  reArmWaitingTimers(): void {
    this.waits.reArmWaitingTimers();
  }

  processWaitTimers(): void {
    this.waits.processWaitTimers();
  }

  handleHostEvent(event: HostWebhookEvent): void {
    this.comments.handleHostEvent(event);
  }

  findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): FlowRow | undefined {
    return this.comments.findFlowByMR(projectId, mrIid, projectUrl);
  }

  ingestComments(flowId: string, incoming: HostComment[], mrIid?: number): number {
    return this.comments.ingestComments(flowId, incoming, mrIid);
  }

  graph(flowId: string): TemplateGraph | null {
    return templateStore.graphForFlow(flowId);
  }

  // ── plan fan-out: finish hooks ───────────────────────────────────────────

  /**
   * Publish a fan-out node's terminal state (StepFlowManager internals — not a
   * public API): persist the aggregate output, move the node to its
   * trigger-type terminal (approval ⇒ `awaiting_approval` — the SDLC build's
   * final aggregate approval flows through the untouched approveBuild chain →
   * MR creation), then continue the normal edge evaluation on a success
   * terminal.
   */
  async finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): Promise<void> {
    const def = this.defOf(parentFlowId, nodeKey);
    // the aggregate `steps` array validates against the def's fanoutOutput
    // contract when one is published (default shape otherwise); the parent's
    // native fields (branch / latestArtifact) ride alongside it
    const fanoutContract = (def.capabilities as NodeCapabilities | undefined)?.fanoutOutput;
    let steps: unknown = output.steps ?? [];
    try {
      steps = ((fanoutContract ?? DEFAULT_FANOUT_OUTPUT).parse({ steps }) as { steps?: unknown })?.steps ?? steps;
    } catch (e: unknown) {
      db.emitEvent(parentFlowId, null, "error",
        `${nodeKey}: the fan-out aggregate failed its output contract — publishing it unvalidated (${e instanceof Error ? e.message : e})`,
        { nodeKey });
    }
    const tt = this.graph(parentFlowId)?.byKey.get(nodeKey)?.trigger.type ?? "auto";
    const status = tt === "approval" ? "awaiting_approval" : "done";
    const published = db.run(
      `UPDATE nodes SET status=?, output=?, updated_at=? WHERE flow_id=? AND node_key=? AND status='running'`,
      status, JSON.stringify({ ...output, steps }), db.now(), parentFlowId, nodeKey);
    if (published.changes === 0) return;
    nodeStore.emitEvent(
      parentFlowId,
      nodeKey,
      "lifecycle",
      `${nodeKey} fan-out resolved — aggregate published (${(steps as unknown[])?.length ?? 0} steps)${status === "awaiting_approval" ? " · awaiting the final approval" : ""}`,
      { nodeKey },
    );
    this.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.advanceFrom(parentFlowId, nodeKey);
    }
    this.clearCurrentIf(parentFlowId, nodeKey);
  }

  /**
   * Publish a split consumer's terminal state (SplitManager internals — not a
   * public API): the aggregate `{units: [{key, title, status, output}]}` is
   * validated against the def's `splitOutput` capability when one is
   * published (the default split shape otherwise), the node takes the
   * worst-of status of its unit entries (decision 4: failed >
   * awaiting_approval > done), and the parent continues via the normal edge
   * evaluation on a success terminal. A failed aggregate holds for the
   * per-unit actions (Retry the failed unit).
   */
  async finishSplit(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): Promise<void> {
    const def = this.defOf(parentFlowId, nodeKey);
    const splitContract = (def.capabilities as NodeCapabilities | undefined)?.splitOutput;
    let units: unknown = output.units ?? [];
    try {
      units = ((splitContract ?? DEFAULT_SPLIT_OUTPUT).parse({ units }) as { units?: unknown })?.units ?? units;
    } catch (e: unknown) {
      db.emitEvent(parentFlowId, null, "error",
        `${nodeKey}: the split aggregate failed its output contract — publishing it unvalidated (${e instanceof Error ? e.message : e})`,
        { nodeKey });
    }
    // worst-of the unit entries (decision 4): failed > awaiting_approval > done
    const entries = Array.isArray(units) ? (units as { status?: unknown }[]) : [];
    const status = entries.some((u) => u?.status === "failed") ? "failed"
      : entries.some((u) => u?.status === "awaiting_approval") ? "awaiting_approval"
      : "done";
    db.run(
      `UPDATE nodes SET status=?, output=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status, JSON.stringify({ ...output, units }), db.now(), parentFlowId, nodeKey);
    nodeStore.emitEvent(
      parentFlowId,
      nodeKey,
      "lifecycle",
      `${nodeKey} split resolved — aggregate published (${entries.length} units)${status === "awaiting_approval" ? " · a unit awaits approval" : status === "failed" ? " · a unit failed" : ""}`,
      { nodeKey },
    );
    this.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.advanceFrom(parentFlowId, nodeKey);
    }
    this.clearCurrentIf(parentFlowId, nodeKey);
  }


  /** True when the flow is a step child (plan fan-out). Engine internal helper. */
  isStepChild(flowId: string): boolean {
    const row = db.get<{ parent_flow_id: string | null }>(
      `SELECT parent_flow_id FROM flows WHERE id=?`, flowId);
    return row?.parent_flow_id != null;
  }

  /**
   * Delete a whole flow: its step children (plan fan-out), every flow-owned
   * row, and the local worktree(s). Throws when the flow does not exist.
   */
  async delete(id: string): Promise<void> {
    const flow = db.get<{ id: string }>(`SELECT id FROM flows WHERE id=?`, id);
    if (!flow) throw new NotFoundError("flow", id);
    const childIds = db
      .all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=?`, id)
      .map((r) => r.id);
    const ids = [id, ...childIds];
    for (const fid of ids) {
      if (mergeArena.isMerging(fid)) {
        throw new ConflictError("cannot delete a flow while a step merge is in progress");
      }
    }
    for (const fid of ids) {
      const active = db.all<{ node_key: string; status: string }>(
        `SELECT node_key, status FROM nodes WHERE flow_id=? AND status IN ('running','waiting')`,
        fid,
      );
      for (const n of active) {
        await this.cancelNode(fid, n.node_key);
      }
    }
    this.waits.clearTimersForFlows(ids);
    await Promise.allSettled(
      ids.map((fid) =>
        worktreeManager.removeFlowWorktree(fid, { reason: "flow deleted" })),
    );
    db.transaction(() => {
      for (const fid of ids) {
        for (const table of FLOW_CHILD_TABLES) {
          db.run(`DELETE FROM ${table} WHERE flow_id=?`, fid);
        }
      }
      db.run(`DELETE FROM flows WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
    });
  }

  // ── context ──────────────────────────────────────────────────────────────

  ctx(flowId: string): FlowCtx {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow) throw new NotFoundError("flow", flowId);
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) throw new NotFoundError("task", flow.task_id);
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    return { flow, task, repo };
  }

  private touch(flowId: string): void {
    db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  setCurrentNode(flowId: string, key: string | null): void {
    db.run(`UPDATE flows SET current_node=?, updated_at=? WHERE id=?`, key, db.now(), flowId);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  setNodeStatus(flowId: string, nodeKey: string, status: string): void {
    nodeStore.setStatus(flowId, nodeKey, status as NodeStatus);
  }

  /** Atomically claim a node for a background run (see docs/coding-patterns.md §3.6). */
  claimNode(flowId: string, nodeKey: string, from: readonly NodeStatus[]): string {
    return nodeStore.claim(flowId, nodeKey, from);
  }

  // fire-and-forget wrapper: runs async, marks node failed on error.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>, clearCurrentKey?: string | null): void {
    const clearKey = clearCurrentKey ?? nodeKey;
    void (async () => {
      try {
        await fn();
      } catch (e: unknown) {
        if (e instanceof RunSupersededError) return;
        const msg = e instanceof Error ? e.message : String(e);
        db.emitEvent(flowId, null, "error", msg, { nodeKey });
        if (nodeKey) {
          db.run(
            `UPDATE nodes SET status=?, attempt_id=NULL, updated_at=? WHERE flow_id=? AND node_key=? AND status=?`,
            NODE_STATUS.FAILED,
            db.now(),
            flowId,
            nodeKey,
            NODE_STATUS.RUNNING,
          );
        }
      } finally {
        if (clearKey) this.clearCurrentIf(flowId, clearKey);
        this.touch(flowId);
      }
    })();
  }

  /**
   * Run a node with a validated input payload. The definition is resolved by
   * the node's def key (registry key for built-ins, node_templates id for
   * declarative kinds), and the effective config is layered the same way chat
   * handlers see it: class defaults ← app-settings ← the per-flow config
   * snapshot (nodes.config).
   *
   * The template instance's `input_map` (§3: `{field: JSONata expr}` over the
   * flow context) is evaluated at trigger time and merged over the caller's
   * trigger input — a mapped field wins over the same key in the trigger
   * payload. A failing expression fails the node loudly with the field name.
   *
   * `deliveryPayload` (Phase 4B): when a waiting node is resumed by a webhook
   * delivery, the delivery body becomes `{{trigger.payload}}` for this run —
   * the context (input maps + agent prompt variables) reads the delivery, not
   * the payload that started the flow. Nothing is persisted from it beyond
   * what the run records.
   *
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  async runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string> {
    const def = this.defOf(flowId, nodeKey);
    const c = this.ctx(flowId);
    const ctx = deliveryPayload !== undefined ? this.ctxWithDelivery(c, deliveryPayload) : c;
    // the context map the input maps evaluate against — with the delivery
    // override when a webhook resumed the run
    const mapped = await this.evalInputMap(flowId, nodeKey, rawInput, buildFlowContext(ctx));
    const input = def.parseInput(mapped);
    const config = def.parseRunConfig(this.nodeConfigFor(flowId, nodeKey));
    const outcome = await def.run(ctx, input, config);
    return outcome.reply;
  }

  /** The flow ctx with a webhook delivery body as {{trigger.payload}} (fresh copy — no DB writes). */
  private ctxWithDelivery(c: FlowCtx, deliveryPayload: unknown): FlowCtx {
    return { ...c, flow: { ...c.flow, trigger_payload: deliveryPayload } } as FlowCtx;
  }

  /** The trigger input overlaid with the template node's evaluated input_map. */
  private async evalInputMap(flowId: string, nodeKey: string, rawInput: unknown, ctxMap?: FlowContextMap): Promise<unknown> {
    const g = this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    const map = spec?.inputMap ?? {};
    const entries = Object.entries(map).filter(([, v]) => typeof v === "string" && (v as string).trim());
    if (!entries.length) return rawInput;
    const base: Record<string, unknown> =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? { ...(rawInput as Record<string, unknown>) }
        : {};
    const ctx = ctxMap ?? buildFlowContext(this.ctx(flowId));
    for (const [field, expr] of entries) {
      const r = await evalJsonata(expr as string, ctx);
      if (!r.ok) {
        throw new Error(`${nodeKey}: input_map.${field} ("${expr}") failed — ${r.error}`);
      }
      if (r.value !== undefined) base[field] = r.value;
    }
    return base;
  }

  /**
   * The inherited run input for a node that declares no input contract: the
   * upstream `next`-edge sources' outputs merged (last wins). `input_map` still
   * overlays explicit mappings at run time — the mapped field wins.
   */

  /** The def for a node instance: built-ins by registry key, declarative kinds hydrate from their node_templates row. */
  defOf(flowId: string, nodeKey: string) {
    return nodeRegistry.resolve(this.defKeyOf(flowId, nodeKey), nodeKey);
  }

  /** The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary, not a public API. */
  flowNodeConfig(flowId: string, nodeKey: string): Record<string, unknown> {
    return parseConfigSnapshot(db.get<{ config: string | null }>(
      `SELECT config FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.config ?? null);
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot.
   *  The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts). */
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown> {
    const def = this.defOf(flowId, nodeKey);
    const appKey = this.defKeyOf(flowId, nodeKey);
    return mergeConfigLayers(def.defaultConfig(), appLayerConfig(appKey), this.flowNodeConfig(flowId, nodeKey));
  }

  // ── split gate (agent-node split plan §2.4, Phase 4) ──────────────────────

  /**
   * The split gate's source + mode resolution: which upstream node feeds this
   * consumer's split, and whether the consumer should expand at all. Returns
   * the source node key to expand against, or null (consume whole — the
   * normal path runs).
   *
   * Mode resolution (§2.4): `whole`/absent → null; explicit `per-unit` wins
   * over whatever the source recommends; `source` defers to the source def's
   * `splitResolution()` (absent ⇒ whole — `source` is the only deferring
   * mode). Source discovery walks the incoming `next` edges for a def that
   * OVERRIDES the `splitUnits` port (method identity against the base class —
   * no probe runs, so a producer error stays a producer-error at expand
   * time). One upstream split source is the Phase-4-supported shape: several
   * are a loud error, never a silent pick. Nested children never split (the
   * same guard the split manager enforces).
   */

  // ── per-unit split actions (plan §3): the unit cards' engine entries ──────

  /** The consumer node owning a unit key (the actions' optional addressing). */
  private splitConsumerFor(flowId: string, unitKey: string, consumerNodeKey?: string): string {
    if (consumerNodeKey) return consumerNodeKey;
    const owner = splitManager.consumerOfUnit(flowId, unitKey);
    if (!owner) throw new Error(`no split unit "${unitKey}" on any consumer of flow ${flowId}`);
    return owner;
  }

  skipSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    return splitManager.skipUnit(flowId, this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  retrySplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): void {
    splitManager.retryUnit(flowId, this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  approveSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): void {
    splitManager.approveUnit(flowId, this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  cancelSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    return splitManager.cancelUnit(flowId, this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  // ── public triggers ──────────────────────────────────────────────────────

  // ── structured plan step editing ─────────────────────────────────────────
  private assertPlanEditable(flowId: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow?.current_node) throw new Error(`wait for the ${flow.current_node} run to finish before editing steps`);
    return this.latestResourceArtifact<{ id: string }>(flowId, NODE_KEYS.PLAN, "a.id");
  }

  /** Bulk-replace the checklist from the Plan view editor.
   *  Phase 3B softened fan-out guards: the editor sends each row's plan-step
   *  row id (PlanSteps payload), so a harmless title/detail/files edit keeps
   *  the row — and its pending child sub-flow's linkage — instead of being
   *  read as a remove + re-add (the old title-match-only guard errored loudly
   *  on renames and destroyed pending children). Rows that are actually
   *  removed still hit the guards: a pending child's flow closes silently, a
   *  started/merged child's step refuses loudly. */
  updatePlanSteps(flowId: string, input: PlanStepInput[]): void {
    if (!Array.isArray(input) || input.some((s) => !s?.title?.trim?.())) {
      throw new Error("steps must be an array of {title, detail?, files?}");
    }
    const latestPlan = this.assertPlanEditable(flowId);
    const guards = stepFlows.deletableStepIds(flowId);
    const existing = planSteps.list(flowId);
    const byId = new Map(existing.map((s) => [s.id, s]));
    const claimed = new Set<string>(); // existing rows matched to a kept input row
    const matched = new Map<number, string>(); // input index → existing row id
    for (const [i, row] of input.entries()) {
      const sentId = typeof row.id === "string" ? row.id.trim() : "";
      const m = sentId ? byId.get(sentId) : undefined;
      if (m && !claimed.has(m.id)) {
        claimed.add(m.id);
        matched.set(i, m.id);
      }
    }
    // rows the user removed: a started/merged child's step cannot go (loud);
    // rows matched above are by definition kept — never treated as removed
    const removedIds = existing
      .filter((s) => !claimed.has(s.id) && !guards.deletable.has(s.id));
    if (removedIds.length) {
      throw new Error(
        `plan step "${removedIds[0].title}" has an active or merged sub-flow and can't be removed — skip the step instead`);
    }
    for (const [stepId, childId] of guards.toCancel) {
      // a step the user REMOVED whose child never started — close the child so
      // no half-scheduled sub-flow lingers (kept rows cancel nothing)
      if (claimed.has(stepId)) continue;
      stepFlows.cancelUnstartedChild(childId);
    }
    const updated = planSteps.replace(
      flowId,
      latestPlan?.id ?? null,
      input.map((s) => ({ title: s.title.trim(), detail: s.detail, files: s.files, branch: s.branch })),
      { matchedRows: matched },
    );
    db.emitEvent(flowId, null, "lifecycle", `plan checklist edited (${updated.length} steps)`, {
      // route the event to the tab that owns the checklist (§3.3 — stamped at
      // emit time; the feed no longer guesses from message text)
      nodeKey: this.keyOfRole(flowId, NODE_KEYS.PLAN) ?? undefined,
    });
    this.touch(flowId);
  }

  /** Toggle one step done/pending. */
  setPlanStepStatus(flowId: string, stepId: string, status: "pending" | "done"): void {
    if (status !== "pending" && status !== "done") throw new Error("status must be pending|done");
    if (!planSteps.setStatus(flowId, stepId, status, "manual")) throw new Error("step not found");
    this.touch(flowId);
  }


  // ── template topology + edge-driven activation ───────────────────────────

  /** Instance keys of the flow's template nodes with the given def key. */
  keysOfType(flowId: string, defKey: string): string[] {
    const g = this.graph(flowId);
    if (g) return g.nodes.filter((n) => n.defKey === defKey).map((n) => n.key);
    return rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, flowId)
      .filter((n) => n.type === defKey)
      .map((n) => n.node_key);
  }

  /** Instance keys → first instance of a def key. */
  firstKeyOfType(flowId: string, defKey: string): string | null {
    return this.keysOfType(flowId, defKey)[0] ?? null;
  }

  // ── chain-role routing (§T3/F1, F4): the engine names chain roles, never
  //    literal built-in def keys ─────────────────────────────────────────────

  /** The catalog def holding a chain role (plan/build/review/resolve), or undefined. */
  private roleDef(role: ChainRole) {
    return nodeRegistry.all().find((d) => d.chainRole === role);
  }

  /** The instance key of the flow's node holding a chain role — the
   *  metadata-routed lookup the SDLC chain module and panel entries consume. */
  keyOfRole(flowId: string, role: ChainRole): string | null {
    const def = this.roleDef(role);
    return def ? this.firstKeyOfType(flowId, def.key) : null;
  }

  /** Artifact kinds a chain role's def publishes as first-class engine
   *  resources (§T3/F3) — resource queries scope through this, not a literal kind. */
  private resourceKinds(role: ChainRole): readonly string[] {
    return this.roleDef(role)?.resourceArtifacts ?? [];
  }

  /**
   * The latest artifact version a chain role's def published as a first-class
   * resource (§T3/F3) — e.g. the plan document the plan editor and the
   * approval flow consume. Also on the StepFlowManager's engine surface
   * (publishedExecution reads the plan version through it).
   */
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns = "a.*"): T | undefined {
    const kinds = this.resourceKinds(role);
    if (!kinds.length) return undefined;
    return db.get<T>(
      `SELECT ${columns} FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind IN (${kinds.map(() => "?").join(",")})
       ORDER BY a.version DESC LIMIT 1`, flowId, ...kinds);
  }

  /**
   * Role lookups: the CI gate node (waits on the wait-source def's event
   * source — the pipeline kind declares `waitForKind`, §T3/F1), and the
   * post-gate chain [gate, …] from the template graph.
   * The ChainHost port the SDLC builtin-chain module drives (see
   * nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary.
   */
  gateKey(flowId: string): string | null {
    const source = nodeRegistry.all().find((d) => d.waitForKind);
    if (!source?.waitForKind) return null;
    return templateStore.waitNodeKey(flowId, source.waitForKind) ?? this.firstKeyOfType(flowId, source.key);
  }

  /** def key of a node instance (for def resolution). */
  private defKeyOf(flowId: string, nodeKey: string): string {
    const g = this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    if (spec) return spec.defKey;
    const n = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    return n?.type ?? nodeKey;
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  nodeStatus(flowId: string, nodeKey: string): string {
    return nodeStore.statusOf(flowId, nodeKey) ?? "";
  }

  /**
   * Edge activation (§3): a node just reached a success terminal (`done`, or
   * `approved` for approval-gated nodes, e.g. approvePlan) — resolve its
   * outgoing `next` edges and start whatever becomes eligible.
   *
   * Edge resolution per edge:
   *  - decision sources: an edge is active exactly when its `label` ∈
   *    `output.chosen` (labels are required on decision out-edges); every
   *    other out-edge resolves inactive
   *  - `condition` (JSONata over the flow context): absent or truthy ⇒ active
   *  - `kind: loop` edges are real re-entry edges: they activate only on an
   *    explicit truthy condition (no condition ⇒ display metadata, never
   *    activated), and entering a target resets it — and its downstream
   *    success-terminal path — to `pending` so the cycle can run again
   *
   * Inactive edges resolve their target side: a target whose incoming edges
   * are all resolved with none active becomes `skipped`, and the skip
   * propagates downstream (a skipped node's out-edges resolve inactive).
   *
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */


  approvePlan(flowId: string, executionOverride?: "whole" | "steps"): void {
    const planKey = this.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("this flow template has no plan node");
    const planStatus = this.nodeStatus(flowId, planKey);
    if (planStatus !== "awaiting_approval") {
      throw new ConflictError(`plan is not awaiting approval (${planStatus})`);
    }
    // Phase 3B: the plan panel's override chip — the user forced whole/steps
    // at approve. Recorded in the plan version's plan-meta (execution +
    // executionSource: "override") so a downstream from-plan fan-out node
    // honors it; every plan-meta field rides the artifact, so the override is
    // auditable per version. When the forced value equals the published one,
    // the approve is a no-op for the meta.
    if (executionOverride === "whole" || executionOverride === "steps") {
      const plan = this.latestResourceArtifact<{ id: string; meta: string | null }>(flowId, NODE_KEYS.PLAN);
      if (!plan) throw new Error("no plan to approve");
      let meta: Record<string, unknown> = {};
      try {
        const m = plan.meta ? JSON.parse(plan.meta) : null;
        if (m && typeof m === "object") meta = m;
      } catch { meta = {}; }
      const was = meta.execution === "steps" ? "steps" : "whole";
      const wasSource = typeof meta.executionSource === "string" ? meta.executionSource : "unknown";
      if (was !== executionOverride) {
        meta.execution = executionOverride;
        meta.executionSource = "override";
        delete meta.execution_rationale; // the planner's rationale no longer applies
        db.run(`UPDATE artifacts SET meta=?, updated_at=? WHERE id=?`, JSON.stringify(meta), db.now(), plan.id);
        nodeStore.emitEvent(
          flowId,
          planKey,
          "lifecycle",
          `plan execution overridden at approve: will execute ${executionOverride} (was ${was}, ${wasSource})`,
          { nodeKey: planKey },
        );
      }
    }
    const plan = this.latestResourceArtifact<{ id: string; content: string; meta: string | null }>(flowId, NODE_KEYS.PLAN);
    if (!plan) throw new Error("no plan to approve");
    db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
    nodeSupport.transition(flowId, planKey, ["awaiting_approval"], "approved");

    // approvePlan originally inlined the plan→build handoff (plan-meta branch
    // decomposition, sequential builds). It now lives in the build node's
    // triggerRuns (a built-in internal) and is activated by the template edge
    // evaluation here. The run attribution picks the first downstream node the
    // engine will actually start (auto / approval trigger) — the SDLC build
    // today; custom edge targets in Phase 2 templates.
    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === planKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? planKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, () => this.advanceFrom(flowId, planKey).then(() => {}));
  }

  approveBuild(flowId: string, branchName?: string): void {
    // step children route to the fan-out approve (merge-back, approve ≠ MR);
    // the parent's aggregate approval flows through the untouched chain below
    if (this.isStepChild(flowId)) {
      stepFlows.approveChildStep(flowId);
      return;
    }
    this.chain.approveBuild(flowId, branchName);
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  triggerPipelineGate(flowId: string, pipelineId?: number, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerPipelineGate(flowId, pipelineId, prompt, model, promptIsBody);
  }

  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerResolve(flowId, prompt, model, promptIsBody);
  }

  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerReview(flowId, prompt, model, promptIsBody);
  }

  /**
   * The armed wait-timer deadline of the flow's debounced resolve node (epoch
   * ms), or null — the Resolve panel's scheduled start. The debounced resolve
   * is template data now (the review → resolve edge arms it), so this reads
   * the generic wait-timer state rather than a chain scheduler.
   */

  // true when the node already has an in-flight run — guards against the webhook
  // + poller + UI all triggering the same node concurrently.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  nodeRunning(flowId: string, nodeKey: string): boolean {
    return db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status === "running";
  }
  /**
   * True while any stage of the post-MR chain (pipeline gate → review →
   * resolve) is running. The chain executes inline in one background task, so
   * between node statuses flipping there is always exactly one `running` stage
   * — this guard keeps the poller/webhook/UI from starting a second chain
   * alongside it.
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  chainBusy(flowId: string): boolean {
    for (const key of templateStore.chainNodeKeys(flowId)) {
      if (this.nodeStatus(flowId, key) === "running") return true;
    }
    return false;
  }
  // ── Phase 2: generic (template-driven) node actions ──────────────────────
  // The five built-ins have their own refined entries above; these are the
  // counterparts declarative (agent, …) nodes drive from the runtime panel.

  /**
   * Start a pending node on demand (manual trigger / declarative node panel).
   * Success terminal states advance the template edges exactly like engine
   * auto-starts do; `awaiting_approval` finishes wait for the generic approve.
   */
  runNodeManual(flowId: string, nodeKey: string, opts: { prompt?: string; model?: string; input?: Record<string, unknown> } = {}): void {
    const def = this.defOf(flowId, nodeKey);
    if (def.chainRole === NODE_KEYS.PLAN) {
      throw new ValidationError('The plan node only accepts input via POST /api/flows/:id/chat');
    }
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    // a failed entry node re-runs from the form — its recorded input never
    // satisfied the contract, so the retry path (recorded input) can't help
    if (node.status !== "pending" && !(node.status === "failed" && this.defOf(flowId, nodeKey).isEntry)) {
      throw new ConflictError(`run is not available while the node is ${node.status}`);
    }
    const claimFrom: readonly NodeStatus[] =
      node.status === "failed" && this.defOf(flowId, nodeKey).isEntry ? ["failed"] : ["pending"];
    this.claimNode(flowId, nodeKey, claimFrom);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
        const g = this.graph(flowId);
        if (g && !(await this.joinSatisfied(flowId, g, nodeKey))) {
          throw new Error("upstream nodes must finish before this run can start");
        }
        // `input` carries the values the user provided at trigger time (the
        // start node's contract form) — it IS the payload. prompt/model keep
        // today's shape for agent nodes when no explicit input is passed.
        const rawInput = opts.input && typeof opts.input === "object"
          ? { ...opts.input }
          : { prompt: opts.prompt ?? null, model: opts.model ?? null };
        await this.runNode(flowId, nodeKey, rawInput);
        const finalStatus = this.nodeStatus(flowId, nodeKey);
        if (this.isStepChild(flowId)) {
          stepFlows.onChildFinished(flowId);
        }
        if (isNodeTerminalSuccess(finalStatus)) {
          await this.advanceFrom(flowId, nodeKey);
        }
      });
  }

  /**
   * Approve an `awaiting_approval` node generically (approval-triggered
   * declarative nodes; e.g. an agent output held for review). Outgoing
   * template edges activate on approval — the same contract as plan/build.
   */
  approveNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    // step children route to the fan-out approve (merge-back vs plain approval)
    if (this.isStepChild(flowId) && node.status === "awaiting_approval") {
      stepFlows.approveChildStep(flowId);
      return;
    }
    if (node.status !== "awaiting_approval") {
      throw new ConflictError(`${nodeKey} is not awaiting approval`);
    }
    const def = this.defOf(flowId, nodeKey);
    if (def.builtinApproval) throw new ValidationError(`${nodeKey} approval belongs to its built-in flow actions`);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} approved`);
    nodeSupport.transition(flowId, nodeKey, ["awaiting_approval"], "approved");

    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === nodeKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? nodeKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, async () => {
      await this.advanceFrom(flowId, nodeKey);
    });
  }

  /**
   * Record a branch pick on a decision node awaiting its choice (§4.3 manual
   * source / approval-override): validates the labels against the node's
   * choices, marks the node approved with `{chosen, rationale}` output, and
   * activates the chosen outgoing edges (everything else resolves inactive).
   */
  async chooseNode(flowId: string, nodeKey: string, chosen: string[], rationale?: string): Promise<void> {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (node.status !== "awaiting_approval") {
      throw new ConflictError(`${nodeKey} is not waiting for a branch choice`);
    }
    const def = this.defOf(flowId, nodeKey);
    if (!("applyChoice" in def) || typeof (def as { applyChoice?: unknown }).applyChoice !== "function") {
      throw new Error(`${nodeKey} is not a decision node`);
    }
    if (!Array.isArray(chosen) || !chosen.length) throw new Error("pick at least one branch");
    await (def as { applyChoice: (n: NodeRow, f: string, c: string[], r?: string, ctx?: FlowCtx) => Promise<void> })
      .applyChoice(node, flowId, chosen.map((c) => String(c)), rationale?.trim() || undefined, this.ctx(flowId));

    // release downstream exactly like a generic approval does
    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === nodeKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? nodeKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, async () => {
      await this.advanceFrom(flowId, nodeKey);
    });
  }

  /** Update a node instance's config layer (nodes.config), merging per key. */
  setNodeConfig(flowId: string, nodeKey: string, config: Record<string, unknown>): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (node.status === "running") throw new ConflictError("can't reconfigure a node while it is running");
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new ValidationError("config must be an object");
    }
    const def = this.defOf(flowId, nodeKey);
    const snapshot = mergeConfigLayers(this.flowNodeConfig(flowId, nodeKey), config);
    const effective = mergeConfigLayers(
      def.defaultConfig(),
      appLayerConfig(this.defKeyOf(flowId, nodeKey)),
      snapshot,
    );
    try {
      def.parseRunConfig(effective);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ValidationError(msg);
    }
    nodeSupport.setNode(node.id, { config: JSON.stringify(snapshot) });
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} config updated`);
    this.touch(flowId);
  }

  /**
   * Skip one fan-out step (StepFlowManager internals): cancel the child, mark
   * the step done with `completed_by: 'skipped'`, emit, advance the scheduler.
   */
  async skipFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    await stepFlows.skipStepFlow(parentFlowId, stepId);
  }

  /**
   * Approve one fan-out step from the parent's step card: routes into the
   * child flow's approve (merge-back for code children, plain close for
   * non-code ones). The MR still comes only from the parent's final approval.
   */
  approveFanoutStep(parentFlowId: string, stepId: string): void {
    const step = db.get<{ sub_flow_id: string | null }>(
      `SELECT sub_flow_id FROM plan_steps WHERE id=? AND flow_id=?`, stepId, parentFlowId);
    if (!step?.sub_flow_id) throw new Error("that step has no sub-flow yet");
    this.approveBuild(step.sub_flow_id); // step children route to the fan-out approve
  }

  /** Retry one failed fan-out step's child run (its recorded step input).
   *  A merge-back failure routes to the merge loop instead — the branch +
   *  approval state survive, so re-running the build prompt would discard the
   *  fix-agent work the conflict surfaced. */
  retryFanoutStep(parentFlowId: string, stepId: string): void {
    const step = db.get<{ sub_flow_id: string | null }>(
      `SELECT sub_flow_id FROM plan_steps WHERE id=? AND flow_id=?`, stepId, parentFlowId);
    if (!step?.sub_flow_id) throw new Error("that step has no sub-flow yet");
    if (stepFlows.resumeMergeRetry(parentFlowId, step.sub_flow_id)) return;
    const workNodeKey = stepFlows.childWorkNodeKey(step.sub_flow_id);
    const workNode = db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, step.sub_flow_id, workNodeKey);
    if (!workNode || workNode.status !== "failed") {
      throw new Error("the step child has no failed node to retry");
    }
    this.retryNode(step.sub_flow_id, workNodeKey);
  }

  /** Clear the current-node pointer when it still points at the given node.
   *  Engine internals shared with the SDLC builtin-chain module — not a public API. */
  clearCurrentIf(flowId: string, nodeKey: string): void {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow?.current_node === nodeKey) this.setCurrentNode(flowId, null);
  }

  /** Re-run a node after failure, using its recorded (schema-validated) input. */
  retryNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    const def = this.defOf(flowId, nodeKey);
    if (!def.retryable) throw new ValidationError(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (node.status === "running") throw new ConflictError(`${nodeKey} is already running`);
    if (node.status === "waiting") {
      throw new ConflictError(
        `${nodeKey} is waiting for its event source — retry after it resumes (or cancel it)`,
      );
    }
    if (templateStore.chainNodeKeys(flowId).includes(nodeKey) && this.chainBusy(flowId)) {
      throw new ConflictError("wait for the current pipeline/review/resolve run to finish first");
    }
    db.emitEvent(flowId, node.id, "lifecycle", `retrying ${nodeKey}`);
    this.claimNode(flowId, nodeKey, ["failed"]);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      // a retried node re-runs on its recorded input; the pipeline gate
      // self-heals (an already-green head finishes immediately) and a green
      // gate then advances the template edges (review → debounced resolve)
      await def.run(this.ctx(flowId), recorded, this.nodeConfigFor(flowId, nodeKey));
      // a retried generic node that now succeeded advances the template
      // edges exactly like the engine's auto-start path
      const finalStatus = this.nodeStatus(flowId, nodeKey);
      if (this.isStepChild(flowId)) {
        // child-terminal notification hook (plan fan-out): the parent's
        // scheduler/rollup reacts to the retried child's terminal state
        stepFlows.onChildFinished(flowId);
        splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
      }
      if (isNodeTerminalSuccess(finalStatus)) {
        await this.advanceFrom(flowId, nodeKey);
      }
    });
  }

  /**
   * Stop a node that is stuck in `running`. Kills the in-process run (local mode)
   * and marks the node failed so it can be retried.
   */
  async cancelNode(flowId: string, nodeKey: string): Promise<void> {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (node.status !== "running" && node.status !== "waiting" && node.status !== "awaiting_approval") {
      throw new ConflictError(`cannot cancel ${nodeKey} while it is ${node.status}`);
    }
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    const active = db.all<{ run_ref: string }>(
      `SELECT run_ref FROM runs WHERE node_id=? AND status='running'`, node.id);
    const mode = flow?.execution_mode === "local" ? "local" : "cloud";
    for (const r of active) {
      await agentPortRegistry.forMode(mode).cancel({ runId: r.run_ref });
    }
    this.waits.clearTimerForNode(flowId, nodeKey);
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), node.id);
    nodeSupport.transition(flowId, nodeKey, ["running", "waiting", "awaiting_approval"], "failed");
    this.clearCurrentIf(flowId, nodeKey);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} stopped by user — retry when ready`);
    this.touch(flowId);
    if (this.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): a stopped step child
      // surfaces failed in its parent's rollup
      stepFlows.onChildFinished(flowId);
      splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
    }
  }

  /**
   * Chat with a node's agent — routed through the §T4 role interfaces
   * (`nodeRoles`): `chatOnly` asks a Converser for a lightweight conversational
   * reply (node state untouched); everything else goes to the node's ChatRefiner
   * when its capabilities opt in, and declines otherwise.
   */
  sendChat(flowId: string, nodeKey: string, content: string, chatOnly = false, model?: string, thread?: string | null): void {
    const def = this.defOf(flowId, nodeKey);
    if (!chatOnly && def.chainRole === NODE_KEYS.PLAN) {
      const branch = normalizePlanThread(thread);
      if (branch && !new PlanStore(nodeSupport).scopedRefine(flowId, branch)) {
        throw new ValidationError(`branch "${branch}" not found in the current plan`);
      }
    }
    db.addMessage(flowId, nodeKey, "user", content, thread ?? null);
    if (!chatOnly) {
      this.claimNode(flowId, nodeKey, ["pending", "awaiting_approval", "failed"]);
    }
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, chatOnly ? null : nodeKey, async () => {
      const reply = chatOnly
        ? (await nodeRoles.converserOf(def)?.converse(this.ctx(flowId), content)) ?? nodeRoles.noAgentReply(def.label)
        : (await nodeRoles.chatRefinerOf(def)?.turn(this.ctx(flowId), content, {
            model,
            thread: thread ?? null,
          })) ?? CHAT_DECLINED;
      db.addMessage(flowId, nodeKey, "assistant", reply || "Done.", thread ?? null);
    }, nodeKey);
  }

  // ── Phase 4: triggers — flow start, webhooks, schedule, wait timers ──────

  /**
   * Start a flow's automatic nodes (webhook/schedule-started flows, §6):
   * every node whose joins are already satisfied AND whose trigger type
   * auto-starts (auto runs; approval runs to its hold). Manual nodes wait for
   * the user; debounced nodes wait for their scheduler. The gitlab wait
   * sources (built-in gate chain) are driven by their own poller paths.
   */
  start(flowId: string): void {
    const g = this.graph(flowId);
    if (!g) throw new Error("this flow has no template graph");
    this.bg(flowId, null, async () => {
      for (const spec of g.nodes) {
        if (spec.trigger.type !== "auto" && spec.trigger.type !== "approval") continue;
        if (!(await this.joinSatisfied(flowId, g, spec.key))) continue;
        await this.startNodeStage(flowId, spec.key);
      }
    });
  }

  // ── recovery (called by reconcile) ───────────────────────────────────────

  /**
   * Finish a running node from a run result obtained out-of-band (server restart
   * recovery / cloud re-attach). Delegates to the node's own recover().
   */
  async completeNodeFromResult(
    c: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    note: string
  ): Promise<boolean> {
    db.run(`UPDATE runs SET status=?, updated_at=? WHERE node_id=? AND status='running'`,
      result.status === "finished" ? "finished" : "error", db.now(), node.id);
    if (node.status !== "running") return true; // already reconciled by a concurrent pass

    const def = this.defOf(c.flow.id, node.node_key);
    const ok = await def.recover(c, node, result, note);
    if (ok) return true;

    // node declined recovery → fail it so the user can retry
    nodeSupport.setNode(node.id, { status: "failed" });
    if (result.status !== "finished") {
      db.emitEvent(c.flow.id, node.id, "error", `${node.node_key} run ended with ${result.status} (${note}) — retry the node to continue`);
    } else {
      db.emitEvent(c.flow.id, node.id, "lifecycle", `${node.node_key} run finished while disconnected (${note}) — retry the node to apply it`);
    }
    return true;
  }


}

export const flowEngine = processSingleton("flowEngine", () => new FlowEngine());

// plan fan-out: bind the StepFlowManager to the engine — resolves the
// flow ↔ step-flow-manager singleton cycle (step-flow-manager is imported by
// flow-engine.ts for the fan-out hook and cannot import the flowEngine value
// at module scope)
stepFlows.bind(flowEngine);

// split runtime (agent-node split plan §3): same cycle resolution for the
// SplitManager — flow-engine.ts imports it for the child-terminal hooks
splitManager.bind(flowEngine);
