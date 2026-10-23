import { db } from "../db";
import {
  ArtifactRow,
  BranchRow,
  FlowRow,
  NodeRow,
  PlanStepRow,
  RunRow,
  Ticket,
  rows,
} from "../db/rows";
import { hostOf } from "../integrations/gitlab";
import type { CursorRunResult } from "../integrations/cursor";
import { localAgent } from "../integrations/localAgent";
import { nodeSupport, type FlowCtx } from "./nodes/base";
import { uncachedInputTokens } from "./nodes/base/usage-tracker";
import { branchStore } from "./nodes/build";
import { isCommitError, mergeRequests } from "./nodes/merge-request";
import { nodeRegistry } from "./nodes/registry";
import { planSteps, type PlanStepInput } from "./steps";
import { SDLC_TEMPLATE_ID, templateStore, type TemplateGraph } from "./templates";
import { appLayerConfig, configNumber, mergeConfigLayers, parseConfigSnapshot } from "./node-config";
import { processSingleton } from "../singleton";

export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
  /** flow template to snapshot (default: the seeded SDLC loop) */
  templateId?: string;
}

export interface MrCommentNote {
  id: number; system?: boolean; resolved?: boolean; resolvable?: boolean; body: string;
  author?: { username?: string }; position?: { new_path?: string; new_line?: number } | null;
  created_at: string;
}

/** Distinguishes MR-creation failures from later pipeline/review failures. */
class MrCreationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MrCreationFailed";
  }
}

/**
 * The flow orchestrator: flow creation and reads, node triggers, chat routing,
 * plan-step editing, retry / cancel, restart recovery, and GitLab
 * webhook/comment ingestion.
 *
 * All node-type-specific behavior lives in the node classes (registry); this
 * class only sequences them and owns cross-node state transitions.
 *
 * Phase 1 (custom flows): every previously-hardcoded chain position
 * ("pipeline", "review", "resolve") is derived from the flow's template graph
 * (see `templateStore`) — no node-key constants here. Edge activation evaluates
 * the template's `next` edges (join all/any) and starts satisfying targets per
 * their trigger type; the built-in gate chain (gate → review → resolve-if-open
 * → re-gate) keeps its faithful inline loop until edge conditions land (Phase 3).
 */
export class FlowEngine {
  // ── flow creation / read ─────────────────────────────────────────────────

  create(ticketId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): string {
    const ticket = rows.get(Ticket, `SELECT * FROM tickets WHERE id=?`, ticketId);
    if (!ticket) throw new Error("ticket not found — sync Jira first");
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

    const id = db.uid("flow_");
    const ts = db.now();
    db.run(
      `INSERT INTO flows (id,ticket_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, ticketId, name ?? `${ticket.key} flow`, "active", repoUrl, repo?.id ?? null, executionMode,
      graph.templateId, null, ts, ts
    );
    // one node row per template instance spec (template order), config merged
    // from class defaults ← app settings ← template node config
    for (const spec of graph.nodes) {
      const def = nodeRegistry.get(spec.defKey);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        db.uid("node_"), id, spec.key, spec.defKey,
        spec.label === def.label ? null : spec.label,
        JSON.stringify(config), spec.joinMode, ts, ts
      );
    }
    // no "flow created" announcement event — the chat feed starts with the
    // user's first message instead of boilerplate
    return id;
  }

  get(id: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return null;
    const ticket = rows.get(Ticket, `SELECT * FROM tickets WHERE id=?`, flow.ticket_id);

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
    return {
      ...flow,
      cost: flowCost,
      branches,
      planSteps: steps,
      resolveScheduleAt: this.resolveScheduleAt(id),
      ticket: ticket ?? null,
      nodes: rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, id)
        .sort((a, b) => order.indexOf(a.node_key) - order.indexOf(b.node_key))
        .map((n) => ({
          ...n,
          cost: nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] },
          artifacts: rows.all(ArtifactRow,
            `SELECT id, node_id, flow_id, kind, version, content, meta, status, feedback, created_at
             FROM artifacts WHERE node_id=? ORDER BY kind, version`, n.id),
        })),
    };
  }

  list() {
    return db.all<Record<string, unknown>>(`
      SELECT f.*, t.key AS ticket_key, t.summary AS ticket_summary
      FROM flows f JOIN tickets t ON t.id=f.ticket_id
      ORDER BY f.updated_at DESC`);
  }

  // ── context ──────────────────────────────────────────────────────────────

  ctx(flowId: string): FlowCtx {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow) throw new Error("flow not found");
    const ticket = rows.get(Ticket, `SELECT * FROM tickets WHERE id=?`, flow.ticket_id);
    if (!ticket) throw new Error("ticket not found");
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    return { flow, ticket, repo };
  }

  private touch(flowId: string): void {
    db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
  }

  private setCurrentNode(flowId: string, key: string | null): void {
    db.run(`UPDATE flows SET current_node=?, updated_at=? WHERE id=?`, key, db.now(), flowId);
  }

  private setNodeStatus(flowId: string, nodeKey: string, status: string): void {
    db.run(`UPDATE nodes SET status=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status, db.now(), flowId, nodeKey);
  }

  // fire-and-forget wrapper: runs async, marks node failed on error
  private bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
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
   * the node's def key (registry key = node template key), and the effective
   * config is layered the same way chat handlers see it: class defaults ←
   * app-settings ← the per-flow config snapshot (nodes.config).
   */
  private async runNode(flowId: string, nodeKey: string, rawInput: unknown): Promise<string> {
    const defKey = this.defKeyOf(flowId, nodeKey);
    const def = nodeRegistry.get(defKey);
    const c = this.ctx(flowId);
    const input = def.parseInput(rawInput);
    const config = this.nodeConfigFor(flowId, nodeKey, defKey);
    const outcome = await def.run(c, input, config);
    return outcome.reply;
  }

  /** The per-flow instance config layer for one node (nodes.config snapshot). */
  private flowNodeConfig(flowId: string, nodeKey: string): Record<string, unknown> {
    return parseConfigSnapshot(db.get<{ config: string | null }>(
      `SELECT config FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.config ?? null);
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot. */
  private nodeConfigFor(flowId: string, nodeKey: string, defKey: string): Record<string, unknown> {
    const def = nodeRegistry.get(defKey);
    return mergeConfigLayers(def.defaultConfig(), appLayerConfig(defKey), this.flowNodeConfig(flowId, nodeKey));
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

  /** Instance keys of the flow's template nodes with the given def key. */
  private keysOfType(flowId: string, defKey: string): string[] {
    const g = this.graph(flowId);
    if (g) return g.nodes.filter((n) => n.defKey === defKey).map((n) => n.key);
    return rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, flowId)
      .filter((n) => n.type === defKey)
      .map((n) => n.node_key);
  }

  private firstKeyOfType(flowId: string, defKey: string): string | null {
    return this.keysOfType(flowId, defKey)[0] ?? null;
  }

  /**
   * Role lookups (Phase 1): the CI gate node (waits on gitlab_pipeline), and
   * the post-gate chain [gate, …] from the template graph.
   */
  private gateKey(flowId: string): string | null {
    return templateStore.waitNodeKey(flowId, "gitlab_pipeline") ?? this.firstKeyOfType(flowId, "pipeline");
  }

  /** def key of a node instance (for def resolution). */
  private defKeyOf(flowId: string, nodeKey: string): string {
    const g = this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    if (spec) return spec.defKey;
    const n = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    return n?.type ?? nodeKey;
  }

  private nodeStatus(flowId: string, nodeKey: string): string {
    return db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status ?? "";
  }

  /** True when a node instance is a source of terminal node status (done | approved). */
  private statusTerminalSuccess(s: string): boolean {
    return s === "done" || s === "approved";
  }

  /**
   * Edge activation: a node just reached a success terminal (`done`, or
   * `approved` for approval-gated nodes, e.g. approvePlan) — resolve its
   * outgoing `next` edges and start whatever becomes eligible. `loop` edges
   * stay display metadata for the internal re-gate / commit-fix loops until
   * edge conditions land (Phase 3).
   */
  private async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    const g = this.graph(flowId);
    if (!g) return;
    const outgoing = g.edges.filter((e) => e.kind === "next" && e.from === fromKey);
    for (const e of outgoing) {
      // Phase 1: no conditions / decision labels — every next edge is active
      const target = g.byKey.get(e.to);
      if (!target) continue;
      if (!this.joinSatisfied(flowId, g, e.to)) continue;
      // gate stages keep dedicated entries (MR creation order + the faithful
      // gate chain loop) — see approveBuild / triggerPipelineGate / retryNode
      const gate = this.gateKey(flowId);
      if (target.key === gate) continue;
      await this.startNodeStage(flowId, target.key);
    }
  }

  /**
   * Join evaluation for a target's incoming `next` edges: all-resolved with at
   * least one active (skipped sources propagate inactive, Phase 3 status),
   * or first-active for `any` targets.
   */
  private joinSatisfied(flowId: string, g: TemplateGraph, key: string): boolean {
    const incoming = g.edges.filter((e) => e.kind === "next" && e.to === key);
    if (!incoming.length) return true;
    const spec = g.byKey.get(key);
    let resolved = 0;
    let active = 0;
    for (const e of incoming) {
      const src = g.byKey.get(e.from);
      if (!src) continue;
      const st = this.nodeStatus(flowId, e.from);
      if (!this.statusTerminalSuccess(st) && st !== "skipped") continue;
      resolved++;
      if (st !== "skipped") active++; // skipped sources propagate inactive
    }
    if (spec?.joinMode === "any") return active > 0;
    return resolved === incoming.length && active > 0;
  }

  /**
   * Run one trigger's node stage inline (sequential `triggerRuns` bundle —
   * e.g. the multi-branch build), then advance past it when it reached a
   * success terminal. Trigger types manual / debounced / approval-holds are
   * not started here.
   */
  private async startNodeStage(flowId: string, nodeKey: string): Promise<void> {
    if (this.nodeStatus(flowId, nodeKey) !== "pending") return;
    this.setCurrentNode(flowId, nodeKey);
    const def = nodeRegistry.get(this.defKeyOf(flowId, nodeKey));
    for (const run of def.triggerRuns(this.ctx(flowId))) {
      run.before?.();
      await this.runNode(flowId, nodeKey, run.input);
      run.after?.();
    }
    const finalStatus = this.nodeStatus(flowId, nodeKey);
    if (this.statusTerminalSuccess(finalStatus)) {
      await this.advanceFrom(flowId, nodeKey);
    }
  }

  approvePlan(flowId: string): void {
    const planKey = this.firstKeyOfType(flowId, "plan");
    if (!planKey) throw new Error("this flow template has no plan node");
    const buildKey = this.firstKeyOfType(flowId, "build");
    if (!buildKey) throw new Error("this flow template has no build node");
    const plan = db.get<{ id: string; content: string; meta: string | null }>(
      `SELECT a.* FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, flowId);
    if (!plan) throw new Error("no plan to approve");
    db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
    this.setNodeStatus(flowId, planKey, "approved");
    this.setCurrentNode(flowId, buildKey);

    // approvePlan originally inlined the plan→build handoff (plan-meta branch
    // decomposition, sequential builds). It now lives in the build node's
    // triggerRuns (a built-in internal) and is activated by the template edge
    // evaluation here. Failures attribute to the build node, as before.
    this.bg(flowId, buildKey, () => this.advanceFrom(flowId, planKey).then(() => {}));
  }

  approveBuild(flowId: string, branchName?: string): void {
    const buildKey = this.firstKeyOfType(flowId, "build");
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = this.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.setNodeStatus(flowId, buildKey, "approved");
    this.setCurrentNode(flowId, gate);
    this.bg(flowId, null, async () => {
      try {
        if (branchName) {
          await this.createMrAndGate(flowId, branchName);
        } else {
          const branches = branchStore.list(flowId).filter((b) => b.status === "awaiting_approval" || b.status === "approved");
          if (branches.length > 1) {
            for (const b of branches) await this.createMrAndGate(flowId, b.name);
          } else {
            await this.createMrAndGate(flowId, null);
          }
        }
        this.setCurrentNode(flowId, null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof MrCreationFailed) {
          // MR creation failed (infra, or commit-fix attempts exhausted): hand the
          // step back to the developer — the "Approve & create MR" button reappears
          // and clicking it retries MR creation with the current branch state.
          db.emitEvent(flowId, null, "mr_failed",
            `MR creation failed: ${msg} — fix the issue, then click "Approve & create MR" again to retry`,
            { branchName });
          this.setNodeStatus(flowId, buildKey, "awaiting_approval");
        } else {
          // pipeline gate / review failures: those nodes already carry their own
          // failed status + Retry — just surface the error.
          db.emitEvent(flowId, null, "error", msg);
        }
        this.setCurrentNode(flowId, null);
      }
    });
  }

  /**
   * MR creation → pipeline gate → review, for one branch (or the single-branch
   * flow). Each stage must succeed before the next starts:
   *  - MR creation failures from rejected pushes (hooks/type checks) are fixed
   *    by a commit-fix agent inside the build step and retried (bounded);
   *    infra failures (network/auth) surface to the user for manual retry.
   *  - the pipeline gate waits for a green pipeline, fixing failures itself.
   */
  private async createMrAndGate(flowId: string, branchName: string | null): Promise<void> {
    try {
      await this.createMrWithFixes(flowId, branchName);
    } catch (e: unknown) {
      throw new MrCreationFailed(e instanceof Error ? e.message : String(e));
    }
    await this.runGateChain(flowId, branchName);
  }

  /**
   * The single post-pipeline chain — the ONLY place the flow advances past the
   * CI gate. Every path that waits on the pipeline (build approval, the
   * Pipeline panel button, retry, and the resolve re-gate) funnels through
   * here, so the sequence is always:
   *
   *   pipeline gate (green) → review → resolve (only while open comments
   *   remain) → re-gate → review → …
   *
   * The whole chain runs inline in the caller's background task — no nested
   * fire-and-forget spawns — so the current-node pointer and the node guards
   * always reflect the one run that's actually in flight, and resolve never
   * runs twice for the same batch of comments. Multi-branch flows stop after
   * the gate (review/resolve run per branch from their own triggers).
   *
   * The node keys come from the flow's template graph (roles: the CI gate,
   * its auto-flowing successor, its debounced successor); the inline gate→
   * review→resolve→re-gate loop carries the loop's conditions until edge
   * conditions arrive with the Phase 3 decision/JSONata work.
   */
  private async runGateChain(
    flowId: string,
    branchName: string | null,
    opts: {
      resolveLoop?: boolean;
      pipelineId?: number | null;
      prompt?: string | null;
      promptIsBody?: boolean;
      model?: string | null;
    } = {},
  ): Promise<void> {
    const gate = this.gateKey(flowId);
    const chain = templateStore.chainNodeKeys(flowId);
    const reviewKey = chain[1] ?? this.firstKeyOfType(flowId, "review");
    const resolveKey = chain[2] ?? this.firstKeyOfType(flowId, "resolve");
    if (!gate) throw new Error("this flow template has no pipeline gate node");

    // the resolve node's max_regate_loops knob bounds the re-gate loop
    // (0/absent = unlimited, today's behavior)
    const maxRegateLoops = resolveKey
      ? configNumber(this.nodeConfigFor(flowId, resolveKey, "resolve"), "max_regate_loops", 0)
      : 0;

    // first pass: resolve runs only when the scheduler had one due (comments
    // arrived mid-gate and the quiet period elapsed) — or immediately when the
    // caller just resolved code (resolveLoop). After a resolve run we re-gate,
    // and loop back into resolve whenever comments are still open.
    let inResolveLoop = opts.resolveLoop ?? false;
    let regates = 0;
    // a specific watched pipeline / prompt / model applies to the chain's
    // first gate only — later gates re-read the MR head with defaults
    let gateInput: Record<string, unknown> | null = opts.pipelineId != null || opts.prompt != null || opts.model != null
      ? {
          pipelineId: opts.pipelineId ?? null,
          prompt: opts.prompt ?? null,
          promptIsBody: opts.promptIsBody ?? false,
          model: opts.model ?? null,
        }
      : null;
    for (;;) {
      this.setCurrentNode(flowId, gate);
      await this.runNode(flowId, gate, {
        branchName, pipelineId: null, guidance: null, prompt: null, promptIsBody: false, model: null,
        ...(gateInput ?? {}),
      });
      gateInput = null;

      // gate green → review (single-branch flows only; multi-branch reviews run
      // per-branch from the branch's own approval)
      if (!branchName && reviewKey) {
        this.setCurrentNode(flowId, reviewKey);
        await this.runNode(flowId, reviewKey, {
          instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
        });
      }

      // the resolve loop is flow-level (single-MR); multi-branch flows resolve
      // per branch from their own triggers
      if (branchName || !resolveKey) return;
      const open = db.get<{ c: number }>(
        `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
      const due = this.resolveDue.get(flowId);
      this.resolveDue.delete(flowId);
      const scheduledDue = due != null && Date.now() >= due;
      if (open === 0 || (!inResolveLoop && !scheduledDue)) return;

      this.setCurrentNode(flowId, resolveKey);
      db.emitEvent(flowId, null, "lifecycle", `resolving ${open} open comment(s)`);
      await this.runNode(flowId, resolveKey, {
        instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
      });
      // only loop when the resolve agent actually pushed code changes — a
      // fix run that touched nothing makes re-gate + re-review a no-op
      if (!this.resolveChangedCode(flowId, resolveKey)) return;
      if (maxRegateLoops > 0 && regates >= maxRegateLoops) {
        db.emitEvent(flowId, null, "lifecycle",
          `re-gate loop limit reached (${maxRegateLoops}) — the flow stays open for manual follow-up`);
        return;
      }
      regates++;
      inResolveLoop = true; // code changed → loop: re-gate → review → resolve-if-open
    }
  }

  /**
   * Create the MR, running a commit-fix agent on the build node when the push
   * was rejected (pre-push/pre-receive hooks — e.g. type checks). Throws the
   * original error after MAX attempts, or immediately for infra failures.
   * The attempt budget comes from the build node's `max_commit_fix_attempts`
   * knob (default = today's constant, 2).
   */
  private async createMrWithFixes(flowId: string, branchName: string | null): Promise<void> {
    const buildKey = this.firstKeyOfType(flowId, "build");
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = this.gateKey(flowId);
    const MAX_FIX_ATTEMPTS = configNumber(
      this.nodeConfigFor(flowId, buildKey, "build"), "max_commit_fix_attempts", 2);
    for (let attempt = 0; ; attempt++) {
      try {
        await mergeRequests.create(this.ctx(flowId), branchName ?? undefined);
        return;
      } catch (e: unknown) {
        if (!isCommitError(e) || attempt >= MAX_FIX_ATTEMPTS) throw e;
        db.emitEvent(flowId, null, "lifecycle",
          `push rejected — running a commit-fix agent on the build step (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
        this.setCurrentNode(flowId, buildKey);
        this.setNodeStatus(flowId, buildKey, "running");
        try {
          await this.runNode(flowId, buildKey, {
            plan: null, prompt: null, branchInfo: null, model: null,
            feedback:
              `Pushing branch was rejected with the error below — most likely a pre-push/pre-receive hook ` +
              `(type check, lint, or test gate). Fix the code so the checks pass, commit, and push again to the same branch.\n\n` +
              `${e.detail}`,
          });
        } finally {
          this.setNodeStatus(flowId, buildKey, "approved");
          // hand the pointer back to the gate the chain will enter next
          this.setCurrentNode(flowId, gate);
        }
      }
    }
  }

  // true when the node already has an in-flight run — guards against the webhook
  // + poller + UI all triggering the same node concurrently
  private nodeRunning(flowId: string, nodeKey: string): boolean {
    return db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status === "running";
  }

  // ── resolve scheduling (quiet-period debounce + pipeline gate) ───────────
  //
  // MR comments never start the resolve node directly: every ingest path
  // (webhook / poller) schedules a run. The poller's tick fires the schedule
  // once BOTH conditions hold:
  //   1. the pipeline node is not running or pending — resolve must wait for
  //      the pipeline step to pass first (a `failed` pipeline doesn't block:
  //      it's terminal until retried, and the resolve → re-gate loop covers it)
  //   2. no new open comment arrived within the quiet period — so reviewers
  //      adding several comments in a row get one resolve run for all of them

  // true when the latest resolve run actually pushed code changes to the MR
  // branch — the review re-trigger is gated on this, not on the comment count
  // (a resolve agent that only explained why comments were wrong resolves them
  // but must not kick off another pipeline/review pass)
  private resolveChangedCode(flowId: string, resolveKey: string): boolean {
    const out = rows.get(NodeRow,
      `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, resolveKey)?.output;
    return (out as { codeChanged?: boolean } | null)?.codeChanged === true;
  }

  /** Per-flow in-memory schedule state: "fire no earlier than". */
  private resolveDue = new Map<string, number>();

  /**
   * When the currently queued resolve run would start (epoch ms) — the quiet
   * period has to elapse first, then the pipeline gate must be clear. The
   * Resolve panel shows this as the scheduled start time. Null when nothing
   * is queued.
   */
  resolveScheduleAt(flowId: string): number | null {
    return this.resolveDue.get(flowId) ?? null;
  }

  /** The queued resolve's start time as wall-clock text ("14:32"), or null. */
  resolveScheduleClock(flowId: string): string | null {
    const at = this.resolveDue.get(flowId);
    if (at == null) return null;
    return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /** How long after the last new open comment the resolve may start.
   *  Per flow: the flow's resolve node `quiet_minutes` knob (class default 10,
   *  app settings overlay the legacy `resolve.delay_ms` / RESOLVE_DELAY_MINUTES
   *  aliases so existing setups behave exactly as before). Flows without a
   *  resolve node instance fall back to the app-settings layer alone. */
  resolveDelayMs(flowId?: string): number {
    const resolveKey = flowId ? this.firstKeyOfType(flowId, "resolve") : null;
    const cfg = mergeConfigLayers(
      appLayerConfig("resolve"),
      resolveKey ? this.flowNodeConfig(flowId!, resolveKey) : {},
    );
    return configNumber(cfg, "quiet_minutes", 10) * 60_000;
  }

  /**
   * Queue a resolve run for `flowId`, resetting the quiet period (each new
   * comment pushes the earliest start out by resolveDelayMs()). The flow's
   * poller tick fires the schedule — a no-op when the flow has no MR yet.
   */
  scheduleResolve(flowId: string): void {
    this.resolveDue.set(flowId, Date.now() + this.resolveDelayMs(flowId));
  }

  private pipelineGateBusy(flowId: string): boolean {
    const gate = this.gateKey(flowId);
    if (!gate) return false;
    const s = this.nodeStatus(flowId, gate);
    return s === "running" || s === "pending";
  }

  /**
   * True while any stage of the post-MR chain (pipeline gate → review →
   * resolve) is running. The chain executes inline in one background task, so
   * between node statuses flipping there is always exactly one `running` stage
   * — this guard keeps the poller/webhook/UI from starting a second chain
   * alongside it.
   */
  private chainBusy(flowId: string): boolean {
    for (const key of templateStore.chainNodeKeys(flowId)) {
      if (this.nodeStatus(flowId, key) === "running") return true;
    }
    return false;
  }

  /**
   * Fire scheduled resolves whose quiet period elapsed and whose pipeline
   * gate is clear. Called from the poller tick; emits one event per state
   * change so the activity feed explains what resolve is waiting for.
   */
  processResolveSchedules(): void {
    const now = Date.now();
    for (const [flowId, due] of [...this.resolveDue]) {
      if (now < due) continue; // quiet period still running
      this.fireScheduledResolve(flowId);
    }
  }

  /**
   * Fire a flow's scheduled resolve now when it's due and nothing blocks it.
   * Used both by the poller tick and by the post-pipeline chain — after a
   * green gate + review, a resolve that was queued mid-gate fires immediately
   * instead of waiting for the next poll.
   */
  private fireScheduledResolve(flowId: string): void {
    const due = this.resolveDue.get(flowId);
    if (due == null || Date.now() < due) return; // nothing scheduled / still quiet
    // a chain is in flight → it ends with a resolve-if-open check, so the
    // schedule stays queued and gets picked up by that chain (or the next tick)
    if (this.chainBusy(flowId)) return;
    if (this.pipelineGateBusy(flowId)) return; // re-checked on the next tick
    const open = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
    this.resolveDue.delete(flowId);
    if (open > 0) {
      this.triggerResolve(flowId, undefined, undefined, undefined, { scheduled: true });
    }
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  triggerPipelineGate(flowId: string, pipelineId?: number, prompt?: string, model?: string, promptIsBody?: boolean): void {
    if (this.chainBusy(flowId)) return;
    const gate = this.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.setCurrentNode(flowId, gate);
    this.bg(flowId, gate, async () => {
      try {
        // always the full chain — a green gate flows on to review (and a
        // resolve when comments are waiting), never leaves the flow stranded
        await this.runGateChain(flowId, null, {
          pipelineId: pipelineId ?? null, prompt: prompt ?? null,
          promptIsBody: promptIsBody ?? false, model: model ?? null,
        });
      } finally {
        this.setCurrentNode(flowId, null);
      }
    });
  }

  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean, opts: { scheduled?: boolean } = {}): void {
    const resolveKey = this.firstKeyOfType(flowId, "resolve");
    if (!resolveKey) return;
    if (this.nodeRunning(flowId, resolveKey)) return;
    // Direct triggers (Run button / API) respect the chain — resolve must not
    // run while the pipeline/review/resolve chain is in flight. `scheduled` is
    // the internal bypass for runs the scheduler already gated.
    if (!opts.scheduled && this.chainBusy(flowId)) {
      throw new Error("wait for the pipeline/review step to finish before running resolve");
    }
    this.setCurrentNode(flowId, resolveKey);
    this.bg(flowId, resolveKey, async () => {
      try {
        await this.runNode(flowId, resolveKey, {
          instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
        });
        // re-enter the unified chain in resolve-loop mode (pipeline gate →
        // review → resolve while open comments remain) — but only when the
        // resolve agent actually pushed code changes; a run that touched
        // nothing makes re-gate + re-review a no-op. Everything runs inline in
        // this task, so resolve can never double-run for the same batch.
        if (this.resolveChangedCode(flowId, resolveKey)) {
          await this.runGateChain(flowId, null, { resolveLoop: true });
        }
      } finally {
        this.setCurrentNode(flowId, null);
      }
    });
  }

  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    const reviewKey = this.firstKeyOfType(flowId, "review");
    if (!reviewKey) throw new Error("this flow template has no review node");
    if (this.chainBusy(flowId)) throw new Error("wait for the current pipeline/review/resolve run to finish first");
    this.setCurrentNode(flowId, reviewKey);
    this.bg(flowId, reviewKey, () => this.runNode(flowId, reviewKey, {
      instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
    }).then(() => this.setCurrentNode(flowId, null)));
  }

  /** Re-run a node after failure, using its recorded (schema-validated) input. */
  retryNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const def = nodeRegistry.get(this.defKeyOf(flowId, nodeKey));
    if (!def.retryable) throw new Error(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (node.status === "running") throw new Error(`${nodeKey} is already running`);
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
        await this.runGateChain(flowId, branch);
      } else {
        await def.run(this.ctx(flowId), recorded, this.nodeConfigFor(flowId, nodeKey, def.key));
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
      for (const r of active) localAgent.cancelRun(r.cursor_run_id);
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
    const def = nodeRegistry.get(nodeKey); // validates the key
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

  // ── recovery (called by reconcile) ───────────────────────────────────────

  /**
   * Finish a running node from a run result obtained out-of-band (server restart
   * recovery / cloud re-attach). Delegates to the node's own recover().
   */
  async completeNodeFromResult(
    c: FlowCtx,
    node: NodeRow,
    result: CursorRunResult,
    note: string
  ): Promise<boolean> {
    db.run(`UPDATE runs SET status=?, updated_at=? WHERE node_id=? AND status='running'`,
      result.status === "finished" ? "finished" : "error", db.now(), node.id);
    if (node.status !== "running") return true; // already reconciled by a concurrent pass

    const def = nodeRegistry.get(node.node_key);
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

  /** project ids are only unique per GitLab instance — match host too when given. */
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

  ingestComments(flowId: string, discussions: { id: string; notes?: MrCommentNote[] }[]): number {
    let newOpen = 0;
    for (const d of discussions) {
      for (const n of d.notes ?? []) {
        if (n.system) continue;
        const id = `gl_${n.id}`;
        const existing = db.get<{ id: string; status: string; resolved_by: string | null }>(
          `SELECT id,status,resolved_by FROM comments WHERE id=?`, id);
        const status = n.resolved ? "resolved" : "open";
        if (!existing) {
          db.run(
            `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,raw,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            id, flowId, null, d.id, n.author?.username, n.body,
            n.position?.new_path ?? null, n.position?.new_line ?? null,
            status, JSON.stringify(n), n.created_at, db.now()
          );
          if (status === "open") newOpen++;
        } else if (existing.status !== status) {
          // Never resurrect a comment the agent already resolved: plain MR notes
          // (bot reports, summaries) aren't resolvable via the GitLab API, so the
          // poll keeps reporting them as unresolved — without this guard they'd
          // flip back to open and trigger a redundant resolve run.
          if (existing.status === "resolved" && existing.resolved_by === "agent" && status === "open") continue;
          db.run(`UPDATE comments SET status=?, updated_at=? WHERE id=?`, status, db.now(), id);
          if (status === "open") newOpen++;
        }
      }
    }
    return newOpen;
  }
}

export const flowEngine = processSingleton("flowEngine", () => new FlowEngine());
