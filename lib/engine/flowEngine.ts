import 'server-only';

import type { Prisma } from '@prisma/client';
import type { FlowData } from '@/types/flow';
import { db } from '../db/app';
import { NodeRow, rows } from '../db/rows';
import type { HostWebhookEvent } from './ports/gitHost';
import type { ChainRole, FlowCtx } from './nodes/shared/nodeSharedExports';
import { nodeRegistry } from './nodes/registry';
import './nodes/declarativeBootstrap';
import {
  templateStore,
  type TemplateGraph,
} from './templates/templateStore';
import { appLayerConfig, mergeConfigLayers } from './templates/nodeConfig';
import { createSdlcChain, type SdlcChain } from './nodes/chains/sdlcChain';
import type { EngineNodeStatus } from './constants/nodeStatus';
import type { TransitionKey } from './runtime/transitions/types/transitions';
import type { TriggerResult, TriggerSource } from './runtime/triggers/types/triggerGateway';
import { stepFlows } from './runtime/fanout/stepFlowManager';
import type { StepChildPayload } from './runtime/fanout/types/stepChildPayload';
import { splitManager } from './runtime/split/splitManager';
import type { SplitChildPayload } from './runtime/split/types/splitChildPayload';
import { EffectRegistry } from './runtime/effects/effectRegistry';
import type { EffectCtx } from './runtime/effects/types/nodeEffects';
import type { EffectLifecycle } from './runtime/effects/constants/effectLifecycles';
import { registerFanoutEffects } from './runtime/fanout/fanoutEffects';
import { registerSplitEffects } from './runtime/split/splitEffects';
import { registerSdlcEffects } from './nodes/chains/sdlcEffects';
import { engineParts, type EngineParts } from '../composition/container';
import { processSingleton } from '../singleton';

import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { CommentIngestor } from './runtime/commentIngestor';
import { StageRunner } from './runtime/staging/stageRunner';
import { BgRunner } from './runtime/bgRunner';
import { FlowFactory, type CreateFlowOptions } from './runtime/flowFactory';
import { FlowReadModel } from './runtime/flowReadModel';
import { WaitStore } from './runtime/waits/waitStore';
import { FlowApprovalService } from './flow/flowApprovalService';
import { FlowChatService } from './flow/flowChatService';
import { FlowRetryService } from './flow/flowRetryService';
import { FlowPlanStepService } from './flow/flowPlanStepService';
import { FlowManualRunService } from './flow/flowManualRunService';
import { JobQueue } from './runtime/jobs/jobQueue';
import { CancelHandler } from './runtime/jobs/cancelHandler';
import { JOB_KIND } from './runtime/jobs/constants/jobVocabulary';
import { cancelDedupKey } from './runtime/jobs/utils/jobDedupKeys';

export type { CreateFlowOptions };

/** FlowEngine — the composition root of the flow cluster and its read-model delegation surface (target-architecture §12: after steps 02–07 the facade is composition + delegation only — approvals/chat/retry live in `flow/`, staging in `runtime/staging/`, the chain in `nodes/chains/`, the effect/join layer in `runtime/effects/`, fan-out/split in their runtimes). Every `nodes.status` write goes through the transition authority (step 02, Invariant 1); every trigger claims through the gateway (step 06, Invariant 11); everything that happens after a stage/child/approval finishes dispatches through the effect registry (step 07, Invariant 8). Must never: grow chain logic or fan-out/split special cases back in — a new concern registers into the layer that owns it. */
export class FlowEngine {
  private readonly parts: EngineParts;
  /** the fire-and-forget runner (see BgRunner) */
  private readonly bgr: BgRunner;
  /** the SDLC builtin chain (approveBuild / panel stage entries) */
  readonly chain: SdlcChain;
  /** the effect/join layer (step 07, Invariant 8) — what happens after a stage/child/approval finishes, registered at this engine's boot */
  readonly effects: EffectRegistry;
  private readonly waits: WaitStore;
  private readonly stages: StageRunner;
  private readonly readModel: FlowReadModel;
  private readonly factory: FlowFactory;
  private readonly comments: CommentIngestor;
  /** the user-approval paths (the action route drives them directly) */
  readonly approvals: FlowApprovalService;
  /** the chat paths (the chat route drives them directly) */
  readonly chats: FlowChatService;
  /** the retry paths (the action route drives them directly) */
  readonly retries: FlowRetryService;
  /** the plan-checklist editing (the action route drives it directly) */
  readonly planStepEdits: FlowPlanStepService;
  private readonly manualRuns: FlowManualRunService;

  /** The comment ingestion surface (the poller's comment sweep drives it). */
  get ingest(): CommentIngestor {
    return this.comments;
  }

  /** Engine parts are constructor-injected from the composition root (Q9). */
  constructor(parts: EngineParts = engineParts) {
    this.parts = parts;
    this.bgr = new BgRunner(parts, (flowId) => this.touch(flowId));
    // step 04: the authority's contract seam resolves defs through this engine
    parts.transitions.bindOutcomeContracts({ defOf: (flowId, nodeKey) => this.defOf(flowId, nodeKey) });
    this.waits = new WaitStore(this, parts.events);
    // the effect/join layer (step 07, Invariant 8): the SDLC chain and the
    // fan-out/split runtimes register their post-finish effects at this boot
    // point — one registry per engine instance, so tests constructing their
    // own engine get their own dispatch scope
    this.effects = new EffectRegistry();
    this.stages = new StageRunner(this, this.waits, parts.events, this.effects, parts.contracts);
    this.readModel = new FlowReadModel(this.waits);
    this.factory = new FlowFactory(this, parts.nodeStore);
    this.comments = new CommentIngestor(this, this.waits);
    this.chain = createSdlcChain(this);
    registerSdlcEffects(this.effects, this, this.chain);
    registerFanoutEffects(this.effects, stepFlows);
    registerSplitEffects(this.effects, splitManager);
    this.approvals = new FlowApprovalService(this);
    this.chats = new FlowChatService(this);
    this.retries = new FlowRetryService(this);
    this.planStepEdits = new FlowPlanStepService(this);
    this.manualRuns = new FlowManualRunService(this);
  }

  // ── creation (FlowFactory) ────────────────────────────────────────────────

  async create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): Promise<string> {
    return this.factory.create(taskId, repoUrl, name, opts);
  }

  async createStepChild(
    parentFlowId: string, templateId: string, name: string, payload: StepChildPayload,
    opts: { branch: string | null }, tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.factory.createStepChild(parentFlowId, templateId, name, payload, opts, tx);
  }

  async createSplitChild(parentFlowId: string, templateId: string, name: string, payload: SplitChildPayload, tx?: Prisma.TransactionClient): Promise<string> {
    return this.factory.createSplitChild(parentFlowId, templateId, name, payload, tx);
  }

  async startStepChild(childFlowId: string): Promise<void> {
    this.bg(childFlowId, null, async () => this.start(childFlowId));
  }

  // ── reads (FlowReadModel) ─────────────────────────────────────────────────

  async get(id: string): Promise<FlowData | null> {
    return this.readModel.get(id);
  }

  async list() {
    return this.readModel.list();
  }

  async graph(flowId: string): Promise<TemplateGraph | null> {
    return this.readModel.graph(flowId);
  }

  async ctx(flowId: string): Promise<FlowCtx> {
    return this.readModel.ctx(flowId);
  }

  /** The def for a node instance: built-ins by registry key, declarative kinds hydrate from their node_templates row. */
  async defOf(flowId: string, nodeKey: string) {
    return nodeRegistry.resolve(await this.readModel.defKeyOf(flowId, nodeKey), nodeKey);
  }

  /** The node instance's own config snapshot (nodes.config JSONB). */
  async flowNodeConfig(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    return this.readModel.flowNodeConfig(flowId, nodeKey);
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot. */
  async nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>> {
    return this.readModel.nodeConfigFor(flowId, nodeKey);
  }

  /** Instance keys of the flow's template nodes with the given def key. */
  async keysOfType(flowId: string, defKey: string): Promise<string[]> {
    return this.readModel.keysOfType(flowId, defKey);
  }

  /** Instance keys → first instance of a def key. */
  async firstKeyOfType(flowId: string, defKey: string): Promise<string | null> {
    return this.readModel.firstKeyOfType(flowId, defKey);
  }

  /** The instance key of the flow's node holding a chain role (§T3 metadata routing). */
  async keyOfRole(flowId: string, role: ChainRole): Promise<string | null> {
    return this.readModel.keyOfRole(flowId, role);
  }

  /** The latest artifact version a chain role's def published (§T3/F3). */
  async latestResourceArtifact<T>(flowId: string, role: ChainRole, columns = 'a.*'): Promise<T | undefined> {
    return this.readModel.latestResourceArtifact<T>(flowId, role, columns);
  }

  /** The CI gate node (waits on the pipeline kind's event source). */
  async gateKey(flowId: string): Promise<string | null> {
    return this.readModel.gateKey(flowId);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  async nodeStatus(flowId: string, nodeKey: string): Promise<string | null> {
    return this.parts.nodeStore.statusOf(flowId, nodeKey);
  }

  async isStepChild(flowId: string): Promise<boolean> {
    const row = await db.get<{ parentFlowId: string | null }>(`SELECT parent_flow_id AS "parentFlowId" FROM flows WHERE id=$1`, flowId);
    return row?.parentFlowId != null;
  }

  /** flows.updated_at heartbeat — the fan-out runtime's aggregate publish rides it. */
  async touch(flowId: string): Promise<void> {
    await db.run(`UPDATE flows SET updated_at=$1 WHERE id=$2`, db.now(), flowId);
  }

  // ── staging (StageRunner — runtime/staging/) ─────────────────────────────

  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    await this.stages.advanceFrom(flowId, fromKey);
  }

  /** the post-terminal dispatch (step 07, Invariant 8): child-terminal notifications + the registered lifecycle effects, falling through to the edge walk when nothing claims */
  postTerminal = (flowId: string, nodeKey: string): Promise<void> =>
    this.stages.postTerminal(flowId, nodeKey);

  /** the effect registry's dispatch door (step 07): true when a registered effect claimed the follow-on */
  runEffect = (lifecycle: EffectLifecycle, ctx: EffectCtx): Promise<boolean> =>
    this.effects.run(lifecycle, ctx);

  joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    return this.stages.joinSatisfied(flowId, g, key);
  }

  /** The merged upstream outputs a declarative run inherits (see InputMaterializer). */
  inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Promise<Record<string, unknown>> {
    return this.stages.inheritedInput(flowId, nodeKey, ctx);
  }

  startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean; source?: TriggerSource } = {},
  ): Promise<void> {
    return this.stages.startNodeStage(flowId, nodeKey, opts);
  }

  /** The validated def run (the staging cluster owns def execution + input materialization). */
  async runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string> {
    return this.stages.runNode(flowId, nodeKey, rawInput, deliveryPayload);
  }

  // ── waits (WaitStore — runtime/waits/) ────────────────────────────────────

  async startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): Promise<string> {
    return this.factory.startFromTemplate(templateId, payload, opts);
  }

  /** The durable wait store (the worker's poller and the webhook resume drive it). */
  get waitsStore(): WaitStore {
    return this.waits;
  }

  // ── comments (CommentIngestor) ────────────────────────────────────────────

  async handleHostEvent(event: HostWebhookEvent): Promise<void> {
    await this.comments.handleHostEvent(event);
  }

  // ── transition authority delegates (Invariant 1) ──────────────────────────

  /** Keyed delegate to the authority's declared table; false when the from-set missed. */
  async setNodeStatus(
    flowId: string, nodeKey: string, key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<boolean> {
    return this.parts.transitions.apply(flowId, nodeKey, key, opts);
  }

  /** Atomically claim a node for a background run (docs/coding-patterns §3.6). */
  async claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string> {
    const { attemptId } = await this.parts.transitions.claim(flowId, nodeKey, key);
    return attemptId;
  }

  /** The keyed transition for callers whose contract says the from-set MUST hold. */
  async applyOrThrow(
    flowId: string, nodeKey: string, key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<void> {
    return this.parts.transitions.applyOrThrow(flowId, nodeKey, key, opts);
  }

  /** Fire-and-forget stage/step work (see BgRunner). */
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    this.bgr.run(flowId, nodeKey, fn);
  }

  // ── deletion ──────────────────────────────────────────────────────────────

  /** Delete a flow tree (see FlowFactory.deleteFlow). */
  async delete(id: string): Promise<void> {
    await this.factory.deleteFlow(id);
  }

  // ── approvals (FlowApprovalService — flow/) ───────────────────────────────

  /** Approve the build output ("Approve & create MR") — step children route to the fan-out approve. */
  async approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    return this.approvals.approveBuild(flowId, branchName);
  }

  async emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.parts.events.lifecycle(flowId, nodeKey, message, data);
  }

  async emitMrFailed(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.parts.events.mrFailed(flowId, nodeKey, message, data);
  }

  // ── the gateway doors (step 06, Invariant 11) ─────────────────────────────

  /** The instance keys of the flow's post-MR chain stages — folded into the claim UPDATE. */
  async chainKeys(flowId: string): Promise<string[]> {
    return templateStore.chainNodeKeys(flowId);
  }

  /** The gateway's claim door — every run-starting trigger loses its duplicates here. */
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    chainKeys?: readonly string[];
  }): Promise<TriggerResult> {
    return this.parts.triggers.claimTrigger(params);
  }

  /** The gateway's approval-style door. */
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
  }): Promise<TriggerResult> {
    return this.parts.triggers.transitionTrigger(params);
  }

  /** Any chain stage `running` — the WaitStore's comments-debounce scheduling read. */
  async chainBusy(flowId: string): Promise<boolean> {
    const keys = await templateStore.chainNodeKeys(flowId);
    for (const key of keys) {
      if ((await this.nodeStatus(flowId, key)) === 'running') return true;
    }
    return false;
  }

  // ── manual run (FlowManualRunService — flow/) ─────────────────────────────

  async runNodeManual(
    flowId: string,
    nodeKey: string,
    opts: { prompt?: string; model?: string; input?: Record<string, unknown> } = {}
  ): Promise<TriggerResult> {
    return this.manualRuns.runNodeManual(flowId, nodeKey, opts);
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
    const effective = mergeConfigLayers(def.defaultConfig(), await appLayerConfig(await this.readModel.defKeyOf(flowId, nodeKey)), snapshot);
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

  // ── fan-out step actions (the fan-out runtime owns the bodies) ────────────

  async skipFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    await stepFlows.skipStepFlow(parentFlowId, stepId);
  }

  async approveFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    await stepFlows.approveFanoutStep(parentFlowId, stepId);
  }

  async retryFanoutStep(parentFlowId: string, stepId: string): Promise<void> {
    await stepFlows.retryFanoutStep(parentFlowId, stepId);
  }

  // ── plan steps (FlowPlanStepService), retry, cancel, chat ─────────────────

  /** Stop an in-flight node: journal the cancel intent write-ahead (Invariant 7), then run the same CancelHandler the worker sweep's re-claim would (step 06 task 4). */
  async cancelNode(flowId: string, nodeKey: string): Promise<void> {
    const node = await db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
    if (!node) throw new NotFoundError('node', nodeKey);
    if (node.status !== 'running' && node.status !== 'waiting' && node.status !== 'awaiting_approval') {
      throw new ConflictError(`cannot cancel ${nodeKey} while it is ${node.status}`);
    }
    // write the intent first; whoever wins the claim finalizes — a crash
    // between claim and finalize leaves the job for the sweep's re-claim
    const jobs = new JobQueue();
    const { id: jobId, deduplicated } = await jobs.enqueue({ kind: JOB_KIND.CANCEL, flowId, dedupKey: cancelDedupKey(flowId, nodeKey), payload: { flowId, nodeKey } });
    if (deduplicated) return; // a live intent owns the finalize
    const job = await jobs.claimById(jobId);
    if (!job) return; // the sweep (or a concurrent cancel) owns the finalize
    await new CancelHandler(jobs, this.effects).handle(job); // a throw surfaces here; the claim's lease expiry re-claims the job
    await jobs.complete(jobId);
  }

  // ── flow start ────────────────────────────────────────────────────────────

  /** Start a flow's automatic nodes (webhook/schedule-started flows, §6): every node whose joins are already satisfied AND whose trigger type auto-starts (auto runs; approval runs to its hold). Manual nodes wait for the user; debounced nodes wait for their scheduler. */
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

  // ── recovery (the seam lives on RecoveryDriver since step 07) ─────────────

  /** The transition authority this engine writes through (engine-internal accessor — diagnostics and the test harness's transition-log assert). */
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

// split runtime (agent-node split plan §3): same cycle resolution
splitManager.bind(flowEngine);
