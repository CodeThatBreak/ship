import { db } from "../db";
import {
  ArtifactRow,
  BranchRow,
  FlowRow,
  NodeRow,
  PlanStepRow,
  RunRow,
  Task,
  rows,
} from "../db/rows";
import { agentPortRegistry, type AgentRunResult } from "./ports/agent-runner";
import { hostOf, type HostComment } from "./ports/git-host";
import { nodeSupport, type FlowCtx } from "./nodes/base";
import { uncachedInputTokens } from "./nodes/base/usage-tracker";
import { nodeRegistry } from "./nodes/registry";
import { planSteps, type PlanStepInput } from "./steps";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore, type TemplateGraph, type TemplateEdgeSpec } from "./templates";
import { appLayerConfig, mergeConfigLayers, parseConfigSnapshot } from "./node-config";
import { createSdlcChain } from "./nodes/sdlc/chain";
import { buildFlowContext, type FlowContextMap } from "./flow-context";
import { evalJsonata, jsonataTruthy } from "./jsonata-eval";
import { hookStore } from "./hooks";
import { parseStartContract, validateAgainstContract } from "./nodes/start/contract";
import { processSingleton } from "../singleton";

export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
  /** flow template to snapshot (default: the seeded SDLC loop) */
  templateId?: string;
  /** the trigger payload that started this flow (webhook / schedule, §6) —
   * persisted on the flow and available to input maps as {{trigger.payload}} */
  triggerPayload?: unknown;
}

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
 * the template's `next` edges (join all/any) and starts satisfying targets per
 * their trigger type. The built-in SDLC gate chain (gate → review →
 * resolve-if-open → re-gate) lives in the `sdlc/chain.ts` builtin-chain module
 * (pristine plan §2.1) — this class owns the generic mechanics it drives.
 */
export class FlowEngine {
  /** the SDLC builtin chain (approveBuild / gate chain / resolve scheduler) */
  private readonly chain = createSdlcChain(this);

  // ── flow creation / read ─────────────────────────────────────────────────

  create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): string {
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new Error("task not found — import tasks first");
    const repo = opts.repoId ? db.repoById(opts.repoId) : undefined;
    if (repo) repoUrl = repo.cloud_url;
    const executionMode = opts.executionMode === "local" ? "local" : "cloud";
    if (executionMode === "local" && !repo?.local_path) {
      throw new Error("Local mode requires a repo registered on the Settings page with a local path.");
    }
    // snapshot the flow's node set from the template — running flows are never
    // mutated by later template edits
    const templateId = opts.templateId ?? SDLC_TEMPLATE_ID;
    const graph = templateStore.graph(templateId);
    if (!graph) throw new Error(`unknown flow template: ${templateId}`);
    // the template declares the task TYPE its flows run on (trigger.task_type,
    // Phase 3) — a manual start passing the picked task must match it
    const declaredType = typeof graph.flowTrigger.task_type === "string" ? graph.flowTrigger.task_type : null;
    if (declaredType && task.type !== declaredType) {
      throw new Error(
        `task ${task.key} is a "${task.type}" task but template "${templateStore.flowTemplate(templateId)?.name ?? templateId}" ` +
        `declares "${declaredType}" task context — pick a ${declaredType} task or change the template's task type`);
    }

    const id = db.uid("flow_");
    const ts = db.now();
    db.run(
      `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, taskId, name ?? `${task.key} flow`, "active", repoUrl, repo?.id ?? null, executionMode,
      graph.templateId, opts.triggerPayload != null ? JSON.stringify(opts.triggerPayload) : null, ts, ts
    );
    // one node row per template instance spec (template order), config merged
    // from class defaults ← app settings ← template node config
    for (const spec of graph.nodes) {
      const def = nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        db.uid("node_"), id, spec.key, spec.defKey,
        spec.label === def.label ? null : spec.label,
        JSON.stringify(config), spec.joinMode, ts, ts
      );
      // wait_for webhook nodes get their own inbound hook bound to the flow
      // instance (Phase 4B) — the delivery resumes the node
      if (spec.trigger.wait_for === "webhook") hookStore.ensureForNode(id, spec.key);
    }
    // no "flow created" announcement event — the chat feed starts with the
    // user's first message instead of boilerplate
    // webhook/schedule flow triggers auto-start their auto nodes (§6) — a
    // manual trigger template keeps today's explicit startPlan entry
    const triggerType = graph.flowTrigger.type;
    if (triggerType === "webhook" || triggerType === "schedule") this.start(id);
    return id;
  }

  get(id: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return null;
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);

    // per-run cost/usage rows, rolled up per node + flow total
    const runs = rows.all(RunRow,
      `SELECT * FROM runs WHERE flow_id=? ORDER BY created_at, id`, id);
    const nodeCosts = new Map<string, { totalCents: number; tokens: number; runs: RunRow[] }>();
    for (const r of runs) {
      const c = nodeCosts.get(r.node_id) ?? { totalCents: 0, tokens: 0, runs: [] };
      if (r.cost_cents != null) c.totalCents += r.cost_cents;
      // stored input_tokens is the full prompt for local runs (cache reads are
      // a subset of it) — roll up the overlap the same way the cost estimator does
      c.tokens += uncachedInputTokens({
        inputTokens: r.input_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
      }) + (r.output_tokens ?? 0) +
        (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
      c.runs.push(r);
      nodeCosts.set(r.node_id, c);
    }
    const flowCost = {
      totalCents: [...nodeCosts.values()].reduce((s, c) => s + c.totalCents, 0),
      tokens: [...nodeCosts.values()].reduce((s, c) => s + c.tokens, 0),
      runCount: runs.length,
    };
    const branches = rows.all(BranchRow, `SELECT * FROM branches WHERE flow_id=? ORDER BY "order", created_at`, id);
    const steps = rows.all(PlanStepRow, `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`, id)
      .map((s) => ({ ...s, files: s.files ?? [] }));

    // node order comes from the flow's own template (snapshot), not the global
    // registry — templates may order and label nodes differently
    const order = templateStore.graphForFlow(id)?.nodes.map((n) => n.key) ?? nodeRegistry.order();
    // catalog identity per node instance (kind/icon for the UI's generic panel)
    const ntRows = db.all<{ id: string; key: string; name: string; kind: string; icon: string | null; is_builtin: number }>(
      `SELECT id, key, name, kind, icon, is_builtin FROM node_templates`
    );
    const ntOf = (type: string) =>
      ntRows.find((r) => r.id === type || (r.is_builtin && r.key === type)) ?? null;
    return {
      ...flow,
      cost: flowCost,
      branches,
      planSteps: steps,
      resolveScheduleAt: this.resolveScheduleAt(id),
      task: task ?? null,
      hooks: hookStore.hooksForFlow(id),
      nodes: rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, id)
        .sort((a, b) => order.indexOf(a.node_key) - order.indexOf(b.node_key))
        .map((n) => {
          const nt = ntOf(n.type);
          return {
            ...n,
            kind: nt?.kind ?? null,
            icon: nt?.icon ?? null,
            template_name: nt?.name ?? null,
            cost: nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] },
            artifacts: rows.all(ArtifactRow,
              `SELECT id, node_id, flow_id, kind, version, content, meta, status, feedback, created_at
               FROM artifacts WHERE node_id=? ORDER BY kind, version`, n.id),
          };
        }),
    };
  }

  list() {
    return db.all<Record<string, unknown>>(`
      SELECT f.*, t.key AS task_key, t.summary AS task_summary
      FROM flows f JOIN tasks t ON t.id=f.task_id
      ORDER BY f.updated_at DESC`);
  }

  // ── context ──────────────────────────────────────────────────────────────

  ctx(flowId: string): FlowCtx {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow) throw new Error("flow not found");
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) throw new Error("task not found");
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
    db.run(`UPDATE nodes SET status=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status, db.now(), flowId, nodeKey);
  }

  // fire-and-forget wrapper: runs async, marks node failed on error.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    (async () => {
      try {
        await fn();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // tag the event with the node it belongs to — the chat panel groups
        // flow-level rows per tab, and an untagged run failure would show up
        // on every node's feed
        db.emitEvent(flowId, null, "error", msg, { nodeKey });
        if (nodeKey) this.setNodeStatus(flowId, nodeKey, "failed");
        db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
      } finally {
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
    const config = this.nodeConfigFor(flowId, nodeKey);
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
  private inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Record<string, unknown> {
    const parents = (this.graph(flowId)?.edges ?? [])
      .filter((e) => e.kind === "next" && e.to === nodeKey)
      .map((e) => e.from);
    const nodesMap = buildFlowContext(ctx).nodes;
    const out: Record<string, unknown> = {};
    for (const p of parents) Object.assign(out, nodesMap[p]?.output ?? {});
    return out;
  }

  /** The def for a node instance: built-ins by registry key, declarative kinds hydrate from their node_templates row. */
  defOf(flowId: string, nodeKey: string) {
    return nodeRegistry.resolve(this.defKeyOf(flowId, nodeKey), nodeKey);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  flowNodeConfig(flowId: string, nodeKey: string): Record<string, unknown> {
    return parseConfigSnapshot(db.get<{ config: string | null }>(
      `SELECT config FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.config ?? null);
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot.
   *  Engine internals shared with the SDLC builtin-chain module — not a public API. */
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown> {
    const def = this.defOf(flowId, nodeKey);
    return mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), this.flowNodeConfig(flowId, nodeKey));
  }

  // ── public triggers ──────────────────────────────────────────────────────

  startPlan(flowId: string, prompt?: string, decompose?: boolean, model?: string, promptIsBody?: boolean, complex?: boolean): void {
    const planKey = this.firstKeyOfType(flowId, "plan");
    if (!planKey) throw new Error("this flow template has no plan node");
    this.setCurrentNode(flowId, planKey);
    this.bg(flowId, planKey, () => this.runNode(flowId, planKey, {
      feedback: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false,
      decompose: decompose ?? false, model: model ?? null, complex: complex ?? false,
    }).then(() => {}));
  }

  refinePlan(
    flowId: string,
    feedback: string,
    prompt?: string,
    model?: string,
    promptIsBody?: boolean,
    complex?: boolean,
    branchRef?: string,
    fresh?: boolean,
    contextBlocks?: string[],
  ): void {
    const planKey = this.firstKeyOfType(flowId, "plan");
    if (!planKey) throw new Error("this flow template has no plan node");
    this.setCurrentNode(flowId, planKey);
    this.bg(flowId, planKey, () => this.runNode(flowId, planKey, {
      feedback, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, decompose: false, model: model ?? null,
      complex: complex ?? false, branchRef: branchRef ?? null,
      fresh: fresh ?? null, contextBlocks: contextBlocks ?? [],
    }).then(() => {}));
  }

  // ── structured plan step editing ─────────────────────────────────────────
  private assertPlanEditable(flowId: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow?.current_node) throw new Error(`wait for the ${flow.current_node} run to finish before editing steps`);
    return db.get<{ id: string }>(
      `SELECT a.id FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, flowId);
  }

  /** Bulk-replace the checklist from the Plan view editor. */
  updatePlanSteps(flowId: string, input: PlanStepInput[]): void {
    if (!Array.isArray(input) || input.some((s) => !s?.title?.trim?.())) {
      throw new Error("steps must be an array of {title, detail?, files?}");
    }
    const latestPlan = this.assertPlanEditable(flowId);
    const updated = planSteps.replace(
      flowId,
      latestPlan?.id ?? null,
      input.map((s) => ({ title: s.title.trim(), detail: s.detail, files: s.files, branch: s.branch }))
    );
    db.emitEvent(flowId, null, "lifecycle", `plan checklist edited (${updated.length} steps)`);
    this.touch(flowId);
  }

  /** Toggle one step done/pending. */
  setPlanStepStatus(flowId: string, stepId: string, status: "pending" | "done"): void {
    if (status !== "pending" && status !== "done") throw new Error("status must be pending|done");
    if (!planSteps.setStatus(flowId, stepId, status, "manual")) throw new Error("step not found");
    this.touch(flowId);
  }

  // ── template topology + edge-driven activation ───────────────────────────

  /** The flow's template graph (the seeded SDLC loop for legacy rows). */
  private graph(flowId: string): TemplateGraph | null {
    return templateStore.graphForFlow(flowId);
  }

  /** Instance keys of the flow's template nodes with the given def key.
   *  Engine internals shared with the SDLC builtin-chain module — not a public API. */
  keysOfType(flowId: string, defKey: string): string[] {
    const g = this.graph(flowId);
    if (g) return g.nodes.filter((n) => n.defKey === defKey).map((n) => n.key);
    return rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, flowId)
      .filter((n) => n.type === defKey)
      .map((n) => n.node_key);
  }

  /** Instance keys → first instance of a def key.
   *  Engine internals shared with the SDLC builtin-chain module — not a public API. */
  firstKeyOfType(flowId: string, defKey: string): string | null {
    return this.keysOfType(flowId, defKey)[0] ?? null;
  }

  /**
   * Role lookups: the CI gate node (waits on the pipeline source), and the
   * post-gate chain [gate, …] from the template graph.
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  gateKey(flowId: string): string | null {
    return templateStore.waitNodeKey(flowId, "pipeline") ?? this.firstKeyOfType(flowId, "pipeline");
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
    return db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status ?? "";
  }

  /** True when a node instance is a source of terminal node status (done | approved). */
  private statusTerminalSuccess(s: string): boolean {
    return s === "done" || s === "approved";
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
   *  - `kind: loop` edges stay display metadata for the internal re-gate /
   *    commit-fix loops (converted in a later pass)
   *
   * Inactive edges resolve their target side: a target whose incoming edges
   * are all resolved with none active becomes `skipped`, and the skip
   * propagates downstream (a skipped node's out-edges resolve inactive).
   *
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    const g = this.graph(flowId);
    if (!g) return;
    const outgoing = g.edges.filter((e) => e.kind === "next" && e.from === fromKey);
    if (!outgoing.length) return;

    const fromSpec = g.byKey.get(fromKey);
    const fromNtKind = fromSpec ? this.nodeKind(g, fromSpec) : null;
    const chosen = fromNtKind === "decision" ? this.decisionChosen(flowId, fromKey) : null;
    const ctx = fromNtKind !== "decision" && outgoing.some((e) => e.condition?.trim())
      ? buildFlowContext(this.ctx(flowId)) : null;

    for (const e of outgoing) {
      const target = g.byKey.get(e.to);
      if (!target) continue;
      if (!(await this.edgeActive(flowId, e, { decision: fromNtKind === "decision", chosen, ctx }))) {
        await this.resolveInactiveTarget(flowId, g, e.to);
        continue;
      }
      if (!(await this.joinSatisfied(flowId, g, e.to))) continue;
      // gate stages keep dedicated entries (MR creation order + the faithful
      // gate chain loop) — see approveBuild / triggerPipelineGate / retryNode
      const gate = this.gateKey(flowId);
      if (target.key === gate) continue;
      await this.startNodeStage(flowId, target.key);
    }
  }

  /** The node_templates kind behind a template node spec (decision/agent/…/builtin). */
  private nodeKind(g: TemplateGraph, spec: { nodeTemplateId: string; defKey: string }): string | null {
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
    if (!e.condition?.trim()) return true;
    const r = await evalJsonata(e.condition, src.ctx ?? buildFlowContext(this.ctx(flowId)));
    if (!r.ok) {
      // a broken condition resolves the edge inactive and says so loudly —
      // the engine never silently picks a branch (§4.3)
      if (src.loud !== false) {
        db.emitEvent(flowId, null, "error",
          `edge ${e.from} → ${e.to}: the condition failed (${r.error}) — the branch resolves inactive`);
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
      const st = this.nodeStatus(flowId, e.from);
      const srcSkipped = st === "skipped";
      if (!this.statusTerminalSuccess(st) && !srcSkipped) continue;
      resolved++;
      if (srcSkipped) continue; // skipped sources propagate inactive
      const srcKind = this.nodeKind(g, src);
      if (srcKind !== "decision" && e.condition?.trim() && !ctxBuilt) {
        flowCtx = buildFlowContext(this.ctx(flowId));
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
    if (this.nodeStatus(flowId, key) !== "pending") return;
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0 || r.resolved !== r.total || r.active > 0) return;
    this.setNodeStatus(flowId, key, "skipped");
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key)?.id ?? null,
      "lifecycle", `${key} skipped — no active branch leads to it`);
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
  private async joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0) return true;
    const spec = g.byKey.get(key);
    if (spec?.joinMode === "any") return r.active > 0;
    return r.resolved === r.total && r.active > 0;
  }

  /**
   * Run one trigger's node stage inline (sequential `triggerRuns` bundle —
   * e.g. the multi-branch build), then advance past it when it reached a
   * success terminal. Trigger types manual / debounced are not started here.
   *
   * Phase 4B: an auto/approval node whose `wait_for` is `webhook` or `timer`
   * does not run when it becomes eligible — it holds at `waiting` until the
   * event source delivers (a hook bound to this (flow, node) at flow creation
   * / a poller-driven timer), then `resumeNodeFromWebhook` /
   * `processWaitTimers` re-enter this stage with `resumeWaiting`. The gitlab
   * wait sources keep their built-in chains (gate, comment debounce).
   *
   * `rawInput` overrides the def's `triggerRuns` — the webhook-resume path
   * passes the delivery body as the trigger input.
   *
   * A stage's own failure is contained: the failing node is marked failed and
   * the advance stops there — the error never propagates to the upstream node
   * whose edge activation started this stage (upstream stays done/approved;
   * the downstream failure carries its own failed status + Retry).
   */
  private async startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean } = {},
  ): Promise<void> {
    const status = this.nodeStatus(flowId, nodeKey);
    if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;
    const spec = this.graph(flowId)?.byKey.get(nodeKey);
    const tt = spec?.trigger.type ?? "auto";
    if (tt === "manual" || tt === "debounced") return;
    // an approval-triggered start node holds for the user, not for an output
    // review: it publishes nothing until triggered, so the contract values are
    // provided when the user starts it (same entry as a manual start node)
    if (tt === "approval" && spec?.defKey === "start" && parseStartContract(spec.config).length) return;
    if (!opts.resumeWaiting && (tt === "auto" || tt === "approval")) {
      // wait_for event sources gate eligibility (§6) — the gitlab sources are
      // the built-in gate chain / comment debounce and don't arm here
      const wait = spec?.trigger.wait_for;
      if (wait === "webhook" || wait === "timer") {
        this.armNodeWait(flowId, nodeKey, wait, spec?.trigger.minutes ?? null);
        return;
      }
    }
    this.setCurrentNode(flowId, nodeKey);
    try {
      const def = this.defOf(flowId, nodeKey);
      const runs =
        opts.rawInput !== undefined
          ? [{ input: opts.rawInput }]
          : // declarative nodes declare no input contract — the input IS the
            // previous node's output (merged when several edges feed in)
            def.inheritsParentInput
            ? [{ input: this.inheritedInput(flowId, nodeKey, this.ctx(flowId)) }]
            : def.triggerRuns(this.ctx(flowId));
      for (const run of runs) {
        run.before?.();
        await this.runNode(flowId, nodeKey, run.input, opts.rawPayload);
        run.after?.();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(flowId, null, "error", msg, { nodeKey });
      this.setNodeStatus(flowId, nodeKey, "failed");
      return;
    } finally {
      this.clearCurrentIf(flowId, nodeKey);
    }
    const finalStatus = this.nodeStatus(flowId, nodeKey);
    if (this.statusTerminalSuccess(finalStatus)) {
      await this.advanceFrom(flowId, nodeKey);
    }
  }

  /**
   * A node that reached eligibility but still waits on an event source: mark
   * it `waiting` and (for a timer) arm the poller-driven resume. The webhook
   * case announces the hook endpoint the sender POSTs to.
   */
  private armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer", minutes: number | null): void {
    if (this.nodeStatus(flowId, nodeKey) !== "pending") return;
    if (wait === "timer") {
      const mins = minutes ?? 1;
      this.waitTimers.set(`${flowId}\n${nodeKey}`, Date.now() + mins * 60_000);
    }
    // the inbound hook is provisioned at flow creation — ensure it exists so
    // the announcement and the sender's curl example always have an endpoint
    const hook = wait === "webhook" ? hookStore.ensureForNode(flowId, nodeKey) : undefined;
    this.setNodeStatus(flowId, nodeKey, "waiting");
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.id ?? null,
      "lifecycle",
      wait === "timer"
        ? `${nodeKey} waits for a timer (${minutes ?? 1} min — the poller resumes it)`
        : `${nodeKey} waits for a webhook delivery — POST to /api/hooks/${hook?.id ?? "(hook unbound)"}`);
  }

  approvePlan(flowId: string): void {
    const planKey = this.firstKeyOfType(flowId, "plan");
    if (!planKey) throw new Error("this flow template has no plan node");
    const plan = db.get<{ id: string; content: string; meta: string | null }>(
      `SELECT a.* FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, flowId);
    if (!plan) throw new Error("no plan to approve");
    db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
    this.setNodeStatus(flowId, planKey, "approved");

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

  /** Queue/reset a resolve run (new open comments) — see the SDLC chain. */
  scheduleResolve(flowId: string): void {
    this.chain.scheduleResolve(flowId);
  }

  /** Fire queued resolves whose quiet period elapsed (poller tick). */
  processResolveSchedules(): void {
    this.chain.processResolveSchedules();
  }

  /** When the queued resolve run would start (epoch ms), or null. */
  resolveScheduleAt(flowId: string): number | null {
    return this.chain.resolveScheduleAt(flowId);
  }

  /** The queued resolve's start time as wall-clock text ("14:32"), or null. */
  resolveScheduleClock(flowId: string): string | null {
    return this.chain.resolveScheduleClock(flowId);
  }

  /** The resolve quiet period per flow (ms) — resolve `quiet_minutes` knob. */
  resolveDelayMs(flowId?: string): number {
    return this.chain.resolveDelayMs(flowId);
  }

  /** The armed wait-timer deadline for a (flow, node) — used by the chain. */
  waitTimerDueAt(flowId: string, nodeKey: string): number | null {
    return this.waitTimers.get(`${flowId}\n${nodeKey}`) ?? null;
  }
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
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    // a failed start node re-runs from the form — its recorded input never
    // satisfied the contract, so the retry path (recorded input) can't help
    if (node.status !== "pending" && !(node.status === "failed" && this.defKeyOf(flowId, nodeKey) === "start")) {
      throw new Error(`run is not available while the node is ${node.status}`);
    }
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      try {
        // wait for upstream stages (join semantics mirror the engine's edge activation)
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
        if (this.statusTerminalSuccess(finalStatus)) {
          await this.advanceFrom(flowId, nodeKey);
        }
      } finally {
        if (this.nodeStatus(flowId, nodeKey) !== "running") this.clearCurrentIf(flowId, nodeKey);
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
    if (!node) throw new Error("unknown node");
    if (node.status !== "awaiting_approval") {
      throw new Error(`${nodeKey} is not awaiting approval`);
    }
    const defKey = this.defKeyOf(flowId, nodeKey);
    if (defKey === "plan" || defKey === "build") throw new Error(`${nodeKey} approval belongs to its built-in flow actions`);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} approved`);
    this.setNodeStatus(flowId, nodeKey, "approved");

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
      try {
        await this.advanceFrom(flowId, nodeKey);
      } finally {
        this.clearCurrentIf(flowId, attribution);
      }
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
    if (!node) throw new Error("unknown node");
    if (node.status !== "awaiting_approval") {
      throw new Error(`${nodeKey} is not waiting for a branch choice`);
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
      try {
        await this.advanceFrom(flowId, nodeKey);
      } finally {
        this.clearCurrentIf(flowId, attribution);
      }
    });
  }

  /** Update a node instance's config layer (nodes.config), merging per key. */
  setNodeConfig(flowId: string, nodeKey: string, config: Record<string, unknown>): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    if (node.status === "running") throw new Error("can't reconfigure a node while it is running");
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("config must be an object");
    }
    const merged = { ...(node.config ?? {}), ...config };
    nodeSupport.setNode(node.id, { config: JSON.stringify(merged) });
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} config updated`);
    this.touch(flowId);
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
    if (!node) throw new Error("unknown node");
    const def = this.defOf(flowId, nodeKey);
    if (!def.retryable) throw new Error(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (node.status === "running") throw new Error(`${nodeKey} is already running`);
    if (node.status === "waiting") throw new Error(`${nodeKey} is waiting for its event source — retry after it resumes (or cancel it)`);
    if (templateStore.chainNodeKeys(flowId).includes(nodeKey) && this.chainBusy(flowId)) {
      throw new Error("wait for the current pipeline/review/resolve run to finish first");
    }
    db.emitEvent(flowId, node.id, "lifecycle", `retrying ${nodeKey}`);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      // retrying the pipeline gate continues the chain — a gate that timed out
      // self-heals (an already-green head finishes immediately) and the flow
      // then advances to review instead of staying stuck.
      if (nodeKey === this.gateKey(flowId)) {
        const branch = (recorded as { branchName?: string | null }).branchName ?? null;
        await this.chain.runGateChain(flowId, branch);
      } else {
        await def.run(this.ctx(flowId), recorded, this.nodeConfigFor(flowId, nodeKey));
        // a retried generic node that now succeeded advances the template
        // edges exactly like the engine's auto-start path
        const finalStatus = this.nodeStatus(flowId, nodeKey);
        if (this.statusTerminalSuccess(finalStatus)) {
          await this.advanceFrom(flowId, nodeKey);
        }
      }
    });
  }

  /**
   * Stop a node that is stuck in `running`. Kills the in-process run (local mode)
   * and marks the node failed so it can be retried.
   */
  async cancelNode(flowId: string, nodeKey: string): Promise<void> {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    const active = db.all<{ cursor_run_id: string }>(
      `SELECT cursor_run_id FROM runs WHERE node_id=? AND status='running'`, node.id);
    if (flow?.execution_mode === "local") {
      for (const r of active) agentPortRegistry.forMode("local").cancel({ runId: r.cursor_run_id });
    }
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), node.id);
    this.setNodeStatus(flowId, nodeKey, "failed");
    if (flow?.current_node === nodeKey) this.setCurrentNode(flowId, null);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} stopped by user — retry when ready`);
    this.touch(flowId);
  }

  /**
   * Chat with a node's agent. Default routes to the node's own chat handler
   * (usually a full refinement run); `chatOnly` asks for a lightweight
   * conversational reply that leaves node state and artifacts untouched.
   */
  sendChat(flowId: string, nodeKey: string, content: string, chatOnly = false, model?: string): void {
    const def = this.defOf(flowId, nodeKey);
    db.addMessage(flowId, nodeKey, "user", content);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      const reply = chatOnly
        ? await def.converse(this.ctx(flowId), content)
        : await def.chat(this.ctx(flowId), content, model);
      db.addMessage(flowId, nodeKey, "assistant", reply || "Done.");
      this.setCurrentNode(flowId, null);
    });
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

  /**
   * Create and start a flow from a template's flow trigger (webhook delivery
   * / due schedule). The template declares the task TYPE its flows run on
   * (`trigger.task_type`, Phase 3) and binds the repo they attach to.
   * Auto-start attaches the most recent imported task of the declared type —
   * flows no longer depend on one pinned task row existing. Execution mode
   * follows the repo: local when it has a local path, cloud otherwise.
   */
  startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): string {
    const t = templateStore.flowTemplate(templateId);
    if (!t) throw new Error("template not found");
    // the store normalizes trigger.task_type on read (absent → first provider)
    const trigger = templateStore.graph(templateId)?.flowTrigger ?? {};
    const taskType = typeof trigger.task_type === "string" ? trigger.task_type : NO_TASK_TYPE;
    const repoId = typeof trigger.repo_id === "string" ? trigger.repo_id : "";
    if (!repoId) {
      throw new Error(
        `template "${t.name}" has no repo binding — webhook and schedule triggers auto-create ` +
        `flows, so bind a repo in the template editor's flow-trigger section first`);
    }
    // The concrete task: a caller-provided taskId (manual/eager starts) wins
    // and is type-checked against the declared task_type; auto-start falls
    // back to the most recent imported task of that type. A legacy
    // `trigger.ticket_id` pin (pre-Phase-3 rows) is ignored — no crash.
    let taskId = typeof opts.taskId === "string" ? opts.taskId.trim() : "";
    if (taskId) {
      const existing = db.get<{ type: string }>(`SELECT type FROM tasks WHERE id=?`, taskId);
      if (!existing) throw new Error("the provided task no longer exists — import tasks first");
      if (existing.type !== taskType) {
        throw new Error(
          `task is a "${existing.type}" task but template "${t.name}" declares "${taskType}" task context — pick a ${taskType} task or change the template's task type`);
      }
    } else {
      const latest = db.get<{ id: string }>(
        `SELECT id FROM tasks WHERE type=? ORDER BY synced_at DESC, rowid DESC LIMIT 1`, taskType
      );
      if (!latest) {
        throw new Error(
          `template "${t.name}" runs on ${taskType} tasks but none are imported yet — import one on the task import screen first`);
      }
      taskId = latest.id;
    }
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new Error("the template's task no longer exists — import tasks first");
    const repo = db.repoById(repoId);
    if (!repo) throw new Error("the template's bound repo no longer exists — rebind in the template editor");
    // the start node's contract defines what the trigger must provide (§5):
    // a payload that doesn't match is rejected here — no flow is created, and
    // the hook route answers the sender with this exact message
    const startSpec = templateStore.graph(templateId)?.nodes.find((n) => n.defKey === "start");
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const v = validateAgainstContract(contractFields, payload);
      if (!v.ok) {
        throw new Error(`payload doesn't match the "${t.name}" start contract — ${v.error}`);
      }
    }
    const id = this.create(taskId, repo.cloud_url, `${t.name} · ${new Date().toISOString()}`, {
      repoId,
      executionMode: repo.local_path ? "local" : "cloud",
      templateId,
      triggerPayload: payload,
    });
    db.emitEvent(id, null, "lifecycle", `flow auto-created from the "${t.name}" template by a trigger — ${taskType} task ${task.key}`);
    // create() auto-starts templates with webhook/schedule flow triggers
    return id;
  }

  /**
   * Resume a waiting node (wait_for webhook) with a delivery body (§6): the
   * delivery becomes the node's trigger input and `{{trigger.payload}}` for
   * this run's context (input maps + agent prompt variables). Non-waiting
   * deliveries (node already resumed/finished/never armed) error loudly.
   */
  resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const spec = this.graph(flowId)?.byKey.get(nodeKey);
    if (spec?.trigger.wait_for !== "webhook") throw new Error(`${nodeKey} is not waiting on a webhook`);
    if (node.status !== "waiting") throw new Error(`${nodeKey} is not waiting for an event`);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} resumed by a webhook delivery`);
    this.bg(flowId, nodeKey, () =>
      this.startNodeStage(flowId, nodeKey, {
        resumeWaiting: true,
        rawInput: { payload, prompt: null, model: null },
        rawPayload: payload,
      }).then(() => {})
    );
  }

  /**
   * Per-(flow,node) in-memory timer state for `wait_for: timer` — armed when
   * the node goes to `waiting`, fired from the poller tick. In-memory like the
   * resolve debounce; a restart re-arms on the next join evaluation (the node
   * is `waiting`, not `pending`, so it resumes only via a new delivery).
   */
  private waitTimers = new Map<string, number>();

  /** Fire due `wait_for: timer` resumes. Called from the poller tick. */
  processWaitTimers(): void {
    const now = Date.now();
    for (const [k, due] of [...this.waitTimers]) {
      if (now < due) continue;
      this.waitTimers.delete(k);
      const i = k.indexOf("\n");
      this.fireWaitTimer(k.slice(0, i), k.slice(i + 1));
    }
  }

  private fireWaitTimer(flowId: string, nodeKey: string): void {
    if (this.nodeStatus(flowId, nodeKey) !== "waiting") return;
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.id ?? null,
      "lifecycle", `${nodeKey} timer elapsed — resuming`);
    this.bg(flowId, nodeKey, () =>
      this.startNodeStage(flowId, nodeKey, { resumeWaiting: true }).then(() => {})
    );
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

  // ── GitLab webhook / poll handling ───────────────────────────────────────

  /** project ids are only unique per git host — match host too when given. */
  findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): FlowRow | undefined {
    // check branches table first (multi-branch MRs)
    const branchRow = rows.get(FlowRow,
      `SELECT f.* FROM branches b JOIN flows f ON f.id = b.flow_id
       WHERE b.mr_iid=? AND f.gitlab_project_id=?`, mrIid, projectId
    );
    if (branchRow) {
      if (projectUrl) {
        const h = hostOf(projectUrl);
        if (h && hostOf(branchRow.repo_url ?? "") !== h) {
          // host mismatch — fall through to flows table
        } else {
          return branchRow;
        }
      } else {
        return branchRow;
      }
    }
    // fall back to flows table (single-branch)
    const candidates = rows.all(FlowRow,
      `SELECT * FROM flows WHERE gitlab_project_id=? AND mr_iid=?`, projectId, mrIid
    );
    if (candidates.length <= 1) return candidates[0];
    const h = projectUrl ? hostOf(projectUrl) : null;
    if (!h) return candidates[0];
    return candidates.find((f) => hostOf(f.repo_url ?? "") === h) ?? candidates[0];
  }

  ingestComments(flowId: string, incoming: HostComment[]): number {
    let newOpen = 0;
    for (const c of incoming) {
      if (c.system) continue;
      const existing = db.get<{ id: string; status: string; resolved_by: string | null }>(
        `SELECT id,status,resolved_by FROM comments WHERE id=?`, c.id);
      const status = c.resolved ? "resolved" : "open";
      if (!existing) {
        db.run(
          `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,raw,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.id, flowId, null, c.threadId, c.author, c.body,
          c.path ?? null, c.line ?? null,
          status, JSON.stringify(c), c.createdAt, db.now()
        );
        if (status === "open") newOpen++;
      } else if (existing.status !== status) {
        // Never resurrect a comment the agent already resolved: plain notes
        // (bot reports, summaries) aren't resolvable via the git-host API, so
        // the poll keeps reporting them as unresolved — without this guard
        // they'd flip back to open and trigger a redundant resolve run.
        if (existing.status === "resolved" && existing.resolved_by === "agent" && status === "open") continue;
        db.run(`UPDATE comments SET status=?, updated_at=? WHERE id=?`, status, db.now(), c.id);
        if (status === "open") newOpen++;
      }
    }
    return newOpen;
  }
}

export const flowEngine = processSingleton("flowEngine", () => new FlowEngine());
