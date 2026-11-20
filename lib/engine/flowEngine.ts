import 'server-only';

import type { Prisma } from '@prisma/client';
import type { FlowData } from '@/types/flow';
import { db } from '../db/app';
import { FlowRow, NodeRow, Task, rows } from '../db/rows';
import { agentPortRegistry, type AgentRunResult } from './ports/agentPort';
import { type HostComment, type HostWebhookEvent } from './ports/gitHost';
import type { RecoveryResult } from './nodes/shared/types/recovery';
import {
  NodeDefinition,
  type ChainRole,
  type FlowCtx,
} from './nodes/shared/nodeSharedExports';
import { nodeRegistry } from './nodes/registry';
import './nodes/declarativeBootstrap';
import { NODE_KEYS } from './constants/nodeKeys';
import { RUN_STATUS } from './constants/vocabulary';
import type { PlanStepInput } from './runtime/planStepStore';
import {
  templateStore,
  type TemplateGraph,
} from './templates/templateStore';
import { appLayerConfig, mergeConfigLayers, parseConfigSnapshot } from './templates/nodeConfig';
import { createSdlcChain, type SdlcChain } from './nodes/chains/sdlcChain';
import { buildFlowContext, type FlowContextMap } from './context/flowVariables';
import { evalJsonata } from '@/lib/jsonata/eval';
import { NODE_STATUS, type EngineNodeStatus } from './constants/nodeStatus';
import { isNodeTerminalSuccess } from './runtime/transitions/constants/statusSets';
import type { TransitionKey } from './runtime/transitions/types/transitions';
import { TRIGGER_SOURCE } from './runtime/triggers/constants/triggerSources';
import type { TriggerResult, TriggerSource } from './runtime/triggers/types/triggerGateway';
import { InputContractError } from './errors/inputContractError';import { EVENT_KIND } from './constants/vocabulary';
import { stepFlows, type StepChildPayload } from './runtime/fanout/stepFlowManager';
import { mergeArena } from './runtime/fanout/mergeArena';
import { splitManager, type SplitChildPayload } from './runtime/split/splitManager';
import { worktreeManager } from './runtime/worktreeLifecycle';
import { engineParts, type EngineParts } from '../composition/container';
import { processSingleton } from '../singleton';

import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { RunSupersededError } from './errors/runSupersededError';
import { CommentIngestor } from './runtime/commentIngestor';
import { EdgeActivator } from './runtime/edgeActivator';
import { FlowFactory, type CreateFlowOptions } from './runtime/flowFactory';
import { FlowReadModel } from './runtime/flowReadModel';
import { WaitStore } from './runtime/waits/waitStore';
import { FlowApprovalService } from './flow/flowApprovalService';
import { FlowChatService } from './flow/flowChatService';
import { FlowRetryService } from './flow/flowRetryService';
import { FlowPlanStepService } from './flow/flowPlanStepService';

export type { CreateFlowOptions };

/** Flow-owned tables, in FK-safe delete order (children before `flows`).
 *  Keep in sync with `FLOW_CHILD_TABLES` in scripts/lib/seed-db.mjs. */
export const FLOW_CHILD_TABLES = [
  'step_merges', // parent_flow_id + flow_id — fan-out merge-back records
  'plan_steps', // sub_flow_id → flows (fan-out checklist)
  'events',
  'messages',
  'runs',
  'artifacts',
  'comments',
  'branches',
  'nodes',
  'hooks', // flow-bound inbound webhooks (wait_for nodes)
] as const;

/**
 * The flow orchestrator: flow creation and reads, node triggers, chat routing,
 * plan-step editing, retry / cancel, restart recovery, and git-host
 * webhook/comment ingestion.
 *
 * All node-type-specific behavior lives in the node classes (registry); this
 * class only sequences them and owns cross-node state transitions — every
 * `nodes.status` write goes through the transition authority (step 02,
 * Invariant 1), never raw SQL. The approval paths live in
 * `lib/engine/flow/flowApprovalService.ts`; the builtin SDLC chain actions in
 * `nodes/chains/sdlc-chain.ts`.
 *
 * Phase 1 (custom flows): every previously-hardcoded chain position
 * ("pipeline", "review", "resolve") is derived from the flow's template graph
 * (see `templateStore`) — no node-key constants here. Edge activation evaluates
 * the template's edges (join all/any, decision labels, JSONata conditions, real
 * re-entry loops) and starts satisfying targets per their trigger type;
 * debounced targets hold at `waiting` until their event source's quiet period
 * elapses.
 */
export class FlowEngine {
  private readonly parts: EngineParts;
  /** the SDLC builtin chain (approveBuild / panel stage entries) */
  private readonly waits: WaitStore;
  private readonly edges: EdgeActivator;
  private readonly readModel: FlowReadModel;
  private readonly factory: FlowFactory;
  private readonly comments: CommentIngestor;
  private readonly chain: SdlcChain;
  private readonly approvals: FlowApprovalService;
  private readonly chats: FlowChatService;
  private readonly retries: FlowRetryService;
  private readonly planStepEdits: FlowPlanStepService;

  /** Engine parts are constructor-injected from the composition root (Q9). */
  constructor(parts: EngineParts = engineParts) {
    this.parts = parts;
    // step 04: the authority's contract seam resolves defs through this engine
    parts.transitions.bindOutcomeContracts({ defOf: (flowId, nodeKey) => this.defOf(flowId, nodeKey) });
    this.waits = new WaitStore(this, parts.events);
    this.edges = new EdgeActivator(this, this.waits, parts.events);
    this.readModel = new FlowReadModel(this.waits);
    this.factory = new FlowFactory(this, parts.nodeStore);
    this.comments = new CommentIngestor(this, this.waits);
    this.chain = createSdlcChain(this);
    this.approvals = new FlowApprovalService(this);
    this.chats = new FlowChatService(this);
    this.retries = new FlowRetryService(this);
    this.planStepEdits = new FlowPlanStepService(this);
  }

  async create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): Promise<string> {
    return this.factory.create(taskId, repoUrl, name, opts);
  }

  async createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
    tx?: Prisma.TransactionClient
  ): Promise<string> {
    return this.factory.createStepChild(parentFlowId, templateId, name, payload, opts, tx);
  }

  async createSplitChild(parentFlowId: string, templateId: string, name: string, payload: SplitChildPayload, tx?: Prisma.TransactionClient): Promise<string> {
    return this.factory.createSplitChild(parentFlowId, templateId, name, payload, tx);
  }

  async startStepChild(childFlowId: string): Promise<void> {
    this.bg(childFlowId, null, async () => this.start(childFlowId));
  }

  async get(id: string): Promise<FlowData | null> {
    return this.readModel.get(id);
  }

  async list() {
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
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean } = {}
  ): Promise<void> {
    return this.edges.startNodeStage(flowId, nodeKey, opts);
  }

  async armNodeWait(flowId: string, nodeKey: string, wait: 'webhook' | 'timer' | 'comments', minutes: number | null): Promise<void> {
    await this.waits.armNodeWait(flowId, nodeKey, wait, minutes);
  }

  async bounceCommentWaits(flowId: string): Promise<void> {
    await this.waits.bounceCommentWaits(flowId);
  }

  async resolveScheduleAt(flowId: string): Promise<number | null> {
    return this.waits.resolveScheduleAt(flowId);
  }

  async resolveScheduleClock(flowId: string): Promise<string | null> {
    return this.waits.resolveScheduleClock(flowId);
  }

  async resolveScheduleLabel(flowId: string): Promise<string> {
    return this.waits.resolveScheduleLabel(flowId);
  }

  async resolveDelayMs(flowId?: string): Promise<number> {
    return this.waits.resolveDelayMs(flowId);
  }

  async startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): Promise<string> {
    return this.factory.startFromTemplate(templateId, payload, opts);
  }

  async resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): Promise<void> {
    await this.waits.resumeNodeFromWebhook(flowId, nodeKey, payload);
  }

  /**
   * Sweep every due durable wait of active flows (the poller tick's wait
   * driver — and the restart resume: deadlines live on `nodes.wait_until`).
   */
  async processWaitTimers(): Promise<void> {
    await this.waits.sweepDueWaits();
  }

  /** The durable wait store (engine-internal — the worker's poller drives it). */
  get waitsStore(): WaitStore {
    return this.waits;
  }

  async handleHostEvent(event: HostWebhookEvent): Promise<void> {
    await this.comments.handleHostEvent(event);
  }

  async findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): Promise<FlowRow | undefined> {
    return this.comments.findFlowByMR(projectId, mrIid, projectUrl);
  }

  async ingestComments(flowId: string, incoming: HostComment[], mrIid?: number): Promise<number> {
    return this.comments.ingestComments(flowId, incoming, mrIid);
  }

  async graph(flowId: string): Promise<TemplateGraph | null> {
    return templateStore.graphForFlow(flowId);
  }

  // ── plan fan-out: finish hooks ───────────────────────────────────────────

  /**
   * Publish a fan-out node's terminal state (StepFlowManager internals — not a
   * public API): persist the aggregate output, move the node to its
   * trigger-type terminal (approval ⇒ `awaiting_approval` — the SDLC build's
   * final aggregate approval flows through the untouched approveBuild chain →
   * MR creation), then continue the normal edge evaluation on a success
   * terminal. The authority's `running` from-set is the fence: a late
   * aggregate that resolves after the user retried the node loses silently.
   */
  async finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>, attemptId?: string | null): Promise<void> {
    // the aggregate validates against the def's fanoutOutput contract at the
    // authority's seam (step 04) — a violation fails the node typed, `false`
    // comes back, and the flow never advances on unvalidated data
    const steps: unknown = output.steps ?? [];
    const tt = (await this.graph(parentFlowId))?.byKey.get(nodeKey)?.trigger.type ?? 'auto';
    const status = tt === 'approval' ? NODE_STATUS.AWAITING_APPROVAL : NODE_STATUS.DONE;
    const published = await this.parts.transitions.publishAggregate(parentFlowId, nodeKey, 'fanoutOutcome', {
      status,
      output: { ...output, steps },
      attemptId,
      detail: `fan-out resolved — aggregate published (${(steps as unknown[])?.length ?? 0} steps)${status === NODE_STATUS.AWAITING_APPROVAL ? ' · awaiting the final approval' : ''}`,
    });
    if (!published) return;
    await this.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.advanceFrom(parentFlowId, nodeKey);
    }
  }

  /**
   * Publish a split consumer's terminal state (SplitManager internals — not a
   * public API): the aggregate `{units: [{key, title, status, output}]}` is
   * validated against the def's `splitOutput` capability when one is
   * published (the default split shape otherwise), the node takes the
   * worst-of status of its unit entries (decision 4: failed >
   * awaiting_approval > done), and the parent continues via the normal edge
   * evaluation on a success terminal. A failed aggregate holds for the
   * per-unit actions (Retry the failed unit). The authority's `running`
   * from-set is the fence — a stale aggregate can no longer clobber a node
   * the user retried or cancelled (the step-00 characterization test).
   */
  async finishSplit(parentFlowId: string, nodeKey: string, output: Record<string, unknown>, attemptId?: string | null): Promise<void> {
    const units: unknown = output.units ?? [];
    // worst-of the unit entries (decision 4): failed > awaiting_approval > done
    const entries = Array.isArray(units) ? (units as { status?: unknown }[]) : [];
    const status = entries.some(u => u?.status === NODE_STATUS.FAILED)
      ? NODE_STATUS.FAILED
      : entries.some(u => u?.status === NODE_STATUS.AWAITING_APPROVAL)
        ? NODE_STATUS.AWAITING_APPROVAL
        : NODE_STATUS.DONE;
    const published = await this.parts.transitions.publishAggregate(parentFlowId, nodeKey, 'splitOutcome', {
      status,
      output: { ...output, units },
      attemptId,
      detail: `split resolved — aggregate published (${entries.length} units)${status === NODE_STATUS.AWAITING_APPROVAL ? ' · a unit awaits approval' : status === NODE_STATUS.FAILED ? ' · a unit failed' : ''}`,
    });
    if (!published) return;
    await this.touch(parentFlowId);
    if (isNodeTerminalSuccess(status)) {
      await this.advanceFrom(parentFlowId, nodeKey);
    }
  }

  /** True when the flow is a step child (plan fan-out). Engine internal helper. */
  async isStepChild(flowId: string): Promise<boolean> {
    const row = await db.get<{ parentFlowId: string | null }>(`SELECT parent_flow_id AS "parentFlowId" FROM flows WHERE id=$1`, flowId);
    return row?.parentFlowId != null;
  }

  /**
   * Delete a whole flow: its step children (plan fan-out), every flow-owned
   * row, and the local worktree(s). Throws when the flow does not exist.
   */
  async delete(id: string): Promise<void> {
    const flow = await db.get<{ id: string }>(`SELECT id FROM flows WHERE id=$1`, id);
    if (!flow) throw new NotFoundError('flow', id);
    const childIds = (await db.all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=$1`, id)).map(r => r.id);
    const ids = [id, ...childIds];
    for (const fid of ids) {
      if (mergeArena.isMerging(fid)) {
        throw new ConflictError('cannot delete a flow while a step merge is in progress');
      }
    }
    for (const fid of ids) {
      const active = await db.all<{ nodeKey: string; status: string }>(
        `SELECT node_key AS "nodeKey", status FROM nodes WHERE flow_id=$1 AND status IN ('running','waiting')`,
        fid
      );
      for (const n of active) {
        await this.cancelNode(fid, n.nodeKey);
      }
    }
    // durable waits die with the rows: cancelNode moved every running/waiting
    // node out of `waiting` (clearing wait_until), and the child-table delete
    // below removes the node rows entirely
    await Promise.allSettled(ids.map(fid => worktreeManager.removeFlowWorktree(fid, { reason: 'flow deleted' })));
    await db.transaction(async (tx) => {
      for (const fid of ids) {
        for (const table of FLOW_CHILD_TABLES) {
          await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE flow_id=$1`, fid);
        }
      }
      await tx.$executeRawUnsafe(`DELETE FROM flows WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ...ids);
    });
  }

  // ── context ──────────────────────────────────────────────────────────────

  async ctx(flowId: string): Promise<FlowCtx> {
    const flow = await rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, flowId);
    if (!flow) throw new NotFoundError('flow', flowId);
    const task = await rows.get(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks WHERE id=$1`, flow.taskId);
    if (!task) throw new NotFoundError('task', flow.taskId);
    const repo = flow.repoId ? (await db.repoById(flow.repoId) ?? null) : null;
    return { flow, task, repo };
  }

  private async touch(flowId: string): Promise<void> {
    await db.run(`UPDATE flows SET updated_at=$1 WHERE id=$2`, db.now(), flowId);
  }

  /**
   * The engine's keyed transition wrapper (engine internals shared with the
   * SDLC builtin-chain module — not a public API): a thin delegate to the
   * transition authority's declared table. Returns false when the from-set
   * missed.
   */
  async setNodeStatus(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<boolean> {
    return this.parts.transitions.apply(flowId, nodeKey, key, opts);
  }

  /** Atomically claim a node for a background run (see docs/coding-patterns.md
   *  §3.6) — keyed delegate to the authority: from-set guard, fresh attempt
   *  token, registry mark. */
  async claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string> {
    const { attemptId } = await this.parts.transitions.claim(flowId, nodeKey, key);
    return attemptId;
  }

  /** The keyed transition wrapper for callers whose contract says the
   *  from-set MUST hold (the retry service's plan-retry revert) — keyed
   *  delegate to the authority. */
  async applyOrThrow(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<void> {
    return this.parts.transitions.applyOrThrow(flowId, nodeKey, key, opts);
  }

  // fire-and-forget wrapper: runs, marks the node failed on error via the
  // authority's declared `stageError` transition.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    void (async () => {
      try {
        await fn();
      } catch (e: unknown) {
        if (e instanceof RunSupersededError) return;
        const msg = e instanceof Error ? e.message : String(e);
        await this.parts.events.error(flowId, nodeKey, msg, { nodeKey });
        if (nodeKey) {
          await this.parts.transitions.failFromRunning(flowId, nodeKey);
        }
      } finally {
        if (nodeKey) {
          const nodeId = await this.parts.nodeStore.idOf(flowId, nodeKey);
          if (nodeId) {
            const attemptId = (
              await db.get<{ attemptId: string | null }>(
                `SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`,
                nodeId,
              )
            )?.attemptId;
            this.parts.attemptRegistry.clear(nodeId, attemptId);
          }
        }
        await this.touch(flowId);
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
    const def = await this.defOf(flowId, nodeKey);
    const c = await this.ctx(flowId);
    const ctx = deliveryPayload !== undefined ? this.ctxWithDelivery(c, deliveryPayload) : c;
    // the context map the input maps evaluate against — with the delivery
    // override when a webhook resumed the run
    const spec = (await this.graph(flowId))?.byKey.get(nodeKey);
    const mapped = await this.evalInputMap(flowId, nodeKey, rawInput, await buildFlowContext(ctx), spec?.inputMap);
    // Invariant 5 (step 04): the stage refuses to proceed on an input that
    // misses the node's declared upstream needs — typed event names field + producer.
    try {
      this.parts.contracts.validateInput(def, mapped, { inputMap: spec?.inputMap });
    } catch (e: unknown) {
      if (e instanceof InputContractError) {
        await this.parts.events.emit(flowId, nodeKey, EVENT_KIND.INPUT_CONTRACT_VIOLATION, e.message,
          { nodeKey, field: e.missingField, ...(e.producerKey != null ? { producer: e.producerKey } : {}) });
      }
      throw e;
    }
    const input = def.parseInput(mapped);
    const config = def.parseRunConfig(await this.nodeConfigFor(flowId, nodeKey));
    const outcome = await def.run(ctx, input, config);
    return outcome.reply;
  }

  /** The flow ctx with a webhook delivery body as {{trigger.payload}} (fresh copy — no DB writes). */
  private ctxWithDelivery(c: FlowCtx, deliveryPayload: unknown): FlowCtx {
    return { ...c, flow: { ...c.flow, triggerPayload: deliveryPayload } } as FlowCtx;
  }

  /** The trigger input overlaid with the template node's evaluated input_map. */
  private async evalInputMap(
    flowId: string,
    nodeKey: string,
    rawInput: unknown,
    ctxMap?: FlowContextMap,
    inputMap?: Record<string, unknown>,
  ): Promise<unknown> {
    const map = inputMap ?? (await this.graph(flowId))?.byKey.get(nodeKey)?.inputMap ?? {};
    const entries = Object.entries(map).filter(([, v]) => typeof v === 'string' && (v as string).trim());
    if (!entries.length) return rawInput;
    const base: Record<string, unknown> =
      rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
        ? { ...(rawInput as Record<string, unknown>) }
        : {};
    const ctx = ctxMap ?? (await buildFlowContext(await this.ctx(flowId)));
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
  async defOf(flowId: string, nodeKey: string) {
    return nodeRegistry.resolve(await this.defKeyOf(flowId, nodeKey), nodeKey);
  }

  /** The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary, not a public API. */
  async flowNodeConfig(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    // nodes.config is a JSONB column — the driver returns it already parsed;
    // legacy string-encoded snapshots (pre-migration rows) still parse
    const raw = (await db.get<{ config: unknown }>(`SELECT config FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey))?.config;
    if (raw == null) return {};
    if (typeof raw === 'string') return parseConfigSnapshot(raw);
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot.
   *  The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts). */
  async nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    const def = await this.defOf(flowId, nodeKey);
    const appKey = await this.defKeyOf(flowId, nodeKey);
    return mergeConfigLayers(def.defaultConfig(), await appLayerConfig(appKey), await this.flowNodeConfig(flowId, nodeKey));
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
  private async splitConsumerFor(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<string> {
    if (consumerNodeKey) return consumerNodeKey;
    const owner = await splitManager.consumerOfUnit(flowId, unitKey);
    if (!owner) throw new Error(`no split unit "${unitKey}" on any consumer of flow ${flowId}`);
    return owner;
  }

  async skipSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    return splitManager.skipUnit(flowId, await this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  async retrySplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    await splitManager.retryUnit(flowId, await this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  async approveSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    await splitManager.approveUnit(flowId, await this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  async cancelSplitUnit(flowId: string, unitKey: string, consumerNodeKey?: string): Promise<void> {
    return splitManager.cancelUnit(flowId, await this.splitConsumerFor(flowId, unitKey, consumerNodeKey), unitKey);
  }

  // ── public triggers ──────────────────────────────────────────────────────

  // ── structured plan step editing (FlowPlanStepService — lib/engine/flow/) ─

  /** Bulk-replace the checklist from the Plan view editor. */
  async updatePlanSteps(flowId: string, input: PlanStepInput[]): Promise<void> {
    await this.planStepEdits.updatePlanSteps(flowId, input);
  }

  /** Toggle one step done/pending. */
  async setPlanStepStatus(flowId: string, stepId: string, status: 'pending' | 'done'): Promise<void> {
    await this.planStepEdits.setPlanStepStatus(flowId, stepId, status);
  }

  // ── template topology + edge-driven activation ───────────────────────────

  /** Instance keys of the flow's template nodes with the given def key. */
  async keysOfType(flowId: string, defKey: string): Promise<string[]> {
    const g = await this.graph(flowId);
    if (g) return g.nodes.filter(n => n.defKey === defKey).map(n => n.key);
    const nodeRows = await rows.all(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1`, flowId);
    return nodeRows.filter(n => n.type === defKey).map(n => n.nodeKey);
  }

  /** Instance keys → first instance of a def key. */
  async firstKeyOfType(flowId: string, defKey: string): Promise<string | null> {
    return (await this.keysOfType(flowId, defKey))[0] ?? null;
  }

  // ── chain-role routing (§T3/F1, F4): the engine names chain roles, never
  //    literal built-in def keys ─────────────────────────────────────────────

  /** The catalog def holding a chain role (plan/build/review/resolve), or undefined. */
  private roleDef(role: ChainRole) {
    return nodeRegistry.all().find(d => d.chainRole === role);
  }

  /** The instance key of the flow's node holding a chain role — the
   *  metadata-routed lookup the SDLC chain module and panel entries consume. */
  async keyOfRole(flowId: string, role: ChainRole): Promise<string | null> {
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
  async latestResourceArtifact<T>(flowId: string, role: ChainRole, columns = 'a.*'): Promise<T | undefined> {
    const kinds = this.resourceKinds(role);
    if (!kinds.length) return undefined;
    return db.get<T>(
      `SELECT ${columns} FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=$1 AND a.kind IN (${kinds.map((_, i) => `$${i + 2}`).join(',')})
       ORDER BY a.version DESC LIMIT 1`,
      flowId,
      ...kinds
    );
  }

  /**
   * Role lookups: the CI gate node (waits on the wait-source def's event
   * source — the pipeline kind declares `waitForKind`, §T3/F1), and the
   * post-gate chain [gate, …] from the template graph.
   * The ChainHost port the SDLC builtin-chain module drives (see
   * nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary.
   */
  async gateKey(flowId: string): Promise<string | null> {
    const source = nodeRegistry.all().find(d => d.waitForKind);
    if (!source?.waitForKind) return null;
    return (await templateStore.waitNodeKey(flowId, source.waitForKind)) ?? (await this.firstKeyOfType(flowId, source.key));
  }

  /** def key of a node instance (for def resolution). */
  private async defKeyOf(flowId: string, nodeKey: string): Promise<string> {
    const g = await this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    if (spec) return spec.defKey;
    const n = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    return n?.type ?? nodeKey;
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  async nodeStatus(flowId: string, nodeKey: string): Promise<string | null> {
    return this.parts.nodeStore.statusOf(flowId, nodeKey);
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

  // ── approvals (FlowApprovalService — lib/engine/flow/) ───────────────────

  /** Approve the plan (optional execution override chip) and release its edges. */
  async approvePlan(flowId: string, executionOverride?: 'whole' | 'steps'): Promise<TriggerResult> {
    return this.approvals.approvePlan(flowId, executionOverride);
  }

  /** Approve the build output ("Approve & create MR") — step children route
   *  to the fan-out approve. */
  async approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    return this.approvals.approveBuild(flowId, branchName);
  }

  /** The ChainHost / ApprovalHost port: the builtin chain's build approval. */
  async sdlcApproveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    return this.chain.approveBuild(flowId, branchName);
  }

  /** The ChainHost / ApprovalHost port: typed lifecycle emission. */
  async emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.parts.events.lifecycle(flowId, nodeKey, message, data);
  }

  /** The ChainHost port: typed MR-creation-failure emission. */
  async emitMrFailed(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.parts.events.mrFailed(flowId, nodeKey, message, data);
  }

  /** Approve an `awaiting_approval` node generically (approval-triggered
   *  declarative nodes; e.g. an agent output held for review). */
  async approveNode(flowId: string, nodeKey: string): Promise<TriggerResult> {
    return this.approvals.approveNode(flowId, nodeKey);
  }

  /** Record a branch pick on a decision node awaiting its choice (§4.3). */
  async chooseNode(flowId: string, nodeKey: string, chosen: string[], rationale?: string): Promise<void> {
    await this.approvals.chooseNode(flowId, nodeKey, chosen, rationale);
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook.
   * The gateway claim is the duplicate fence; the skipped result maps to 409
   * at the route (step 06). */
  async triggerPipelineGate(
    flowId: string,
    pipelineId?: number,
    model?: string,
    source: TriggerSource = TRIGGER_SOURCE.UI,
  ): Promise<TriggerResult> {
    return this.chain.triggerPipelineGate(flowId, pipelineId, model, source);
  }

  async triggerResolve(flowId: string, model?: string, source: TriggerSource = TRIGGER_SOURCE.UI): Promise<TriggerResult> {
    // a waiting resolve's durable wait clears itself: the chain's claim below
    // leaves `waiting` through the authority, which clears wait_until
    return this.chain.triggerResolve(flowId, model, source);
  }

  async triggerReview(flowId: string, model?: string, source: TriggerSource = TRIGGER_SOURCE.UI): Promise<TriggerResult> {
    return this.chain.triggerReview(flowId, model, source);
  }

  /**
   * The armed wait-timer deadline of the flow's debounced resolve node (epoch
   * ms), or null — the Resolve panel's scheduled start. The debounced resolve
   * is template data now (the review → resolve edge arms it), so this reads
   * the generic wait-timer state rather than a chain scheduler.
   */

  /**
   * The instance keys of the flow's post-MR chain stages — the claim guard's
   * in-flight set (step 06): the TriggerGateway folds it into the claim's
   * conditional UPDATE, so no read-then-act `chainBusy` pre-check guards a
   * trigger anymore. (The WaitStore's comments-debounce re-defer keeps a
   * scheduling read on this — it extends a wait, it never guards a status
   * write.)
   */
  async chainKeys(flowId: string): Promise<string[]> {
    return templateStore.chainNodeKeys(flowId);
  }

  /** The gateway's claim door (step 06, Invariant 11) — every run-starting
   * trigger loses its duplicates here, with the typed skip event emitted. */
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    chainKeys?: readonly string[];
  }): Promise<TriggerResult> {
    return this.parts.triggers.claimTrigger(params);
  }

  /** The gateway's approval-style door (step 06). */
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
  }): Promise<TriggerResult> {
    return this.parts.triggers.transitionTrigger(params);
  }
  /**
   * True while any stage of the post-MR chain (pipeline gate → review →
   * resolve) is running. Survives only as a scheduling read (the WaitStore's
   * comments-debounce re-defer) — no trigger coordination reads it anymore
   * (step 06 folded the guard into the claim UPDATE).
   */
  async chainBusy(flowId: string): Promise<boolean> {
    for (const key of await templateStore.chainNodeKeys(flowId)) {
      if ((await this.nodeStatus(flowId, key)) === 'running') return true;
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
  async runNodeManual(
    flowId: string,
    nodeKey: string,
    opts: { prompt?: string; model?: string; input?: Record<string, unknown> } = {}
  ): Promise<TriggerResult> {
    const def = await this.defOf(flowId, nodeKey);
    if (def.chainRole === NODE_KEYS.PLAN) {
      throw new ValidationError('The plan node only accepts input via POST /api/flows/:id/chat');
    }
    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) throw new NotFoundError('node', nodeKey);
    // a failed entry node re-runs from the form — its recorded input never
    // satisfied the contract, so the retry path (recorded input) can't help.
    // The status read only SELECTS the claim key — the claim's from-set still
    // decides (a racer that claimed first loses atomically and emits the
    // typed skip event; the old status pre-read throw is gone, step 06).
    const claimKey: TransitionKey = node.status === 'failed' && def.isEntry ? 'retry' : 'runFromPending';
    const result = await this.parts.triggers.claimTrigger({
      flowId,
      nodeKey,
      source: TRIGGER_SOURCE.UI,
      key: claimKey,
    });
    if (!result.started) return result;
    this.bg(flowId, nodeKey, async () => {
      const g = await this.graph(flowId);
      if (g && !(await this.joinSatisfied(flowId, g, nodeKey))) {
        throw new Error('upstream nodes must finish before this run can start');
      }
      // `input` carries the values the user provided at trigger time (the
      // start node's contract form) — it IS the payload. With no explicit
      // input, agent-style nodes (inheritsParentInput) take the merged
      // upstream outputs — the manual path must mirror the engine's auto
      // start (EdgeActivator.startNodeStage), otherwise `{{input.*}}` renders
      // empty — and prompt/model keep today's shape for agent nodes on top.
      const rawInput =
        opts.input && typeof opts.input === 'object'
          ? { ...opts.input }
          : {
              ...(def.inheritsParentInput
                ? await this.edges.inheritedInput(flowId, nodeKey, await this.ctx(flowId))
                : {}),
              prompt: opts.prompt ?? null,
              model: opts.model ?? null,
            };
      await this.runNode(flowId, nodeKey, rawInput);
      const finalStatus = await this.nodeStatus(flowId, nodeKey);
      if (await this.isStepChild(flowId)) {
        await stepFlows.onChildFinished(flowId);
      }
      if (isNodeTerminalSuccess(finalStatus ?? '')) {
        await this.advanceFrom(flowId, nodeKey);
      }
    });
    return result;
  }

  /** Update a node instance's config layer (nodes.config), merging per key. */
  async setNodeConfig(flowId: string, nodeKey: string, config: Record<string, unknown>): Promise<void> {
    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) throw new NotFoundError('node', nodeKey);
    if (node.status === 'running') throw new ConflictError("can't reconfigure a node while it is running");
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ValidationError('config must be an object');
    }
    const def = await this.defOf(flowId, nodeKey);
    const snapshot = mergeConfigLayers(await this.flowNodeConfig(flowId, nodeKey), config);
    const effective = mergeConfigLayers(def.defaultConfig(), await appLayerConfig(await this.defKeyOf(flowId, nodeKey)), snapshot);
    try {
      def.parseRunConfig(effective);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ValidationError(msg);
    }
    await this.parts.nodeSupport.setNode(node.id, { config: JSON.stringify(snapshot) });
    await this.parts.events.lifecycle(flowId, nodeKey, `${nodeKey} config updated`);
    await this.touch(flowId);
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
  async approveFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    const step = await db.get<{ subFlowId: string | null }>(
      `SELECT sub_flow_id AS "subFlowId" FROM plan_steps WHERE id=$1 AND flow_id=$2`,
      stepId,
      parentFlowId
    );
    if (!step?.subFlowId) throw new Error('that step has no sub-flow yet');
    await this.approveBuild(step.subFlowId); // step children route to the fan-out approve
  }

  /** Retry one failed fan-out step's child run (its recorded step input).
   *  A merge-back failure routes to the merge loop instead — the branch +
   *  approval state survive, so re-running the build prompt would discard the
   *  fix-agent work the conflict surfaced. */
  async retryFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    const step = await db.get<{ subFlowId: string | null }>(
      `SELECT sub_flow_id AS "subFlowId" FROM plan_steps WHERE id=$1 AND flow_id=$2`,
      stepId,
      parentFlowId
    );
    if (!step?.subFlowId) throw new Error('that step has no sub-flow yet');
    if (await stepFlows.resumeMergeRetry(parentFlowId, step.subFlowId)) return;
    const workNodeKey = await stepFlows.childWorkNodeKey(step.subFlowId);
    const workNode = await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      step.subFlowId,
      workNodeKey
    );
    if (!workNode || workNode.status !== 'failed') {
      throw new Error('the step child has no failed node to retry');
    }
    await this.retryNode(step.subFlowId, workNodeKey);
  }

  // ── retry (FlowRetryService — lib/engine/flow/) ───────────────────────────

  /** Re-run a node after failure, using its recorded (schema-validated) input. */
  async retryNode(flowId: string, nodeKey: string): Promise<TriggerResult> {
    return this.retries.retryNode(flowId, nodeKey);
  }

  /** The input a retry runs on — the retry service owns the step-05
   *  prompt-rebuild coherence; this private delegate keeps the engine-internal
   *  seam the promptRetryRebuild characterization asserts through unchanged. */
  private rebuildRetryInput(def: NodeDefinition, recorded: unknown): unknown {
    return this.retries.rebuildRetryInput(def, recorded);
  }

  /**
   * Stop a node that is stuck in `running`. Kills the in-process run (local mode)
   * and marks the node failed so it can be retried.
   */
  async cancelNode(flowId: string, nodeKey: string): Promise<void> {
    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) throw new NotFoundError('node', nodeKey);
    if (node.status !== 'running' && node.status !== 'waiting' && node.status !== 'awaiting_approval') {
      throw new ConflictError(`cannot cancel ${nodeKey} while it is ${node.status}`);
    }
    const mode = (await db.get<{ executionMode: string | null }>(`SELECT execution_mode AS "executionMode" FROM flows WHERE id=$1`, flowId))?.executionMode === 'local' ? 'local' : 'cloud';
    const active = await db.all<{ runRef: string }>(
      `SELECT run_ref AS "runRef" FROM runs WHERE node_id=$1 AND status='running'`,
      node.id
    );
    for (const r of active) {
      await (await agentPortRegistry.forMode(mode)).cancel({ runId: r.runRef });
    }
    // the cancel transition clears the durable wait + node lease (the
    // authority's non-claim UPDATE clears wait_until/lease_until with the
    // status); the interrupted run rows drop their leases here
    await db.run(`UPDATE runs SET status='error', lease_until=NULL, updated_at=$1 WHERE node_id=$2 AND status='running'`, db.now(), node.id);
    await this.parts.transitions.applyOrThrow(flowId, nodeKey, 'cancel');
    await this.touch(flowId);
    if (await this.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): a stopped step child
      // surfaces failed in its parent's rollup
      await stepFlows.onChildFinished(flowId);
      await splitManager.onChildFinished(flowId); // split runtime (§3) — no-op without split linkage
    }
  }

  // ── chat (FlowChatService — lib/engine/flow/) ─────────────────────────────

  /**
   * Chat with a node's agent — routed through the §T4 role interfaces
   * (`nodeRoles`): `chatOnly` asks a Converser for a lightweight conversational
   * reply (node state untouched); everything else goes to the node's ChatRefiner
   * when its capabilities opt in, and declines otherwise.
   */
  async sendChat(flowId: string, nodeKey: string, content: string, model?: string, thread?: string | null): Promise<TriggerResult> {
    return this.chats.sendChat(flowId, nodeKey, content, model, thread);
  }

  // ── Phase 4: triggers — flow start, webhooks, schedule, wait timers ──────

  /**
   * Start a flow's automatic nodes (webhook/schedule-started flows, §6):
   * every node whose joins are already satisfied AND whose trigger type
   * auto-starts (auto runs; approval runs to its hold). Manual nodes wait for
   * the user; debounced nodes wait for their scheduler. The gitlab wait
   * sources (built-in gate chain) are driven by their own poller paths.
   */
  async start(flowId: string): Promise<void> {
    const g = await this.graph(flowId);
    if (!g) throw new Error('this flow has no template graph');
    this.bg(flowId, null, async () => {
      for (const spec of g.nodes) {
        if (spec.trigger.type !== 'auto' && spec.trigger.type !== 'approval') continue;
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
  async completeNodeFromResult(c: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    await db.run(
      `UPDATE runs SET status=$1, lease_until=NULL, updated_at=$2 WHERE node_id=$3 AND status='running'`,
      result.status === 'finished' ? 'finished' : 'error',
      db.now(),
      node.id
    );
    if (node.status !== 'running') return true; // already reconciled by a concurrent pass

    const def = await this.defOf(c.flow.id, node.nodeKey);
    // The fixed recover() ABI (Invariant 4, step 05): a throw out of a def's
    // recover() is caught ONCE here — the recovery seam — and mapped to
    // `manual` + an error event, so the reconciler pass never sees a
    // recovery throw.
    let recovery: RecoveryResult;
    try {
      recovery = await def.recover(c, node, result, note);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      await this.parts.events.error(
        c.flow.id,
        node.nodeKey,
        `${node.nodeKey} recover() threw — recovery failed: ${reason}`,
      );
      recovery = { kind: "manual", reason: `recover() threw: ${reason}` };
    }
    if (recovery.kind === 'recovered') return true;

    // recovery is manual → fail the node so the user can retry
    await this.parts.transitions.apply(c.flow.id, node.nodeKey, 'recoverDeclined');
    await this.parts.events.error(
      c.flow.id,
      node.nodeKey,
      `${node.nodeKey} recovery is manual (${recovery.reason}) — retry the node to continue`
    );
    return true;
  }

  /**
   * Reconciler surface: mark an orphaned run's node failed (nothing
   * recoverable) through the declared `orphanFail` transition. */
  async failOrphanedNode(flowId: string, nodeId: string, nodeKey: string, reason: string): Promise<void> {
    const applied = await this.parts.transitions.apply(flowId, nodeKey, 'orphanFail');
    if (!applied) return; // already reconciled by a concurrent pass
    await db.run(
      `UPDATE runs SET status=$1, lease_until=NULL, updated_at=$2 WHERE node_id=$3 AND status=$4`,
      RUN_STATUS.ERROR,
      db.now(),
      nodeId,
      RUN_STATUS.RUNNING,
    );
    await this.parts.events.error(flowId, nodeKey, `${nodeKey}: ${reason} — retry the node to continue`);
  }

  /** The transition authority this engine writes through (engine-internal
   *  accessor — diagnostics and the test harness's transition-log assert). */
  get transitions() {
    return this.parts.transitions;
  }
}

export const flowEngine = processSingleton('flowEngine', () => new FlowEngine());

// plan fan-out: bind the StepFlowManager to the engine — resolves the
// flow ↔ step-flow-manager singleton cycle (step-flow-manager is imported by
// flow-engine.ts for the fan-out hook and cannot import the flowEngine value
// at module scope)
stepFlows.bind(flowEngine);

// split runtime (agent-node split plan §3): same cycle resolution for the
// SplitManager — flow-engine.ts imports it for the child-terminal hooks
splitManager.bind(flowEngine);
