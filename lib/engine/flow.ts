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
import { branchStore } from "./nodes/build";
import { NODE_KEYS } from "./nodes/keys";
import { isCommitError, mergeRequests } from "./nodes/merge-request";
import type { PlanBranch } from "./nodes/plan";
import { nodeRegistry } from "./nodes/registry";
import { planSteps, type PlanStepInput } from "./steps";
import { processSingleton } from "../singleton";

export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
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
 * The flow orchestrator: flow creation and reads, node triggers (plan → build
 * → review → resolve, plus CI fix), chat routing, plan-step editing, retry /
 * cancel, restart recovery, and GitLab webhook/comment ingestion.
 *
 * All node-type-specific behavior lives in the node classes (registry); this
 * class only sequences them and owns cross-node state transitions.
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
    const id = db.uid("flow_");
    const ts = db.now();
    db.run(
      `INSERT INTO flows (id,ticket_id,name,status,repo_url,repo_id,execution_mode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, ticketId, name ?? `${ticket.key} flow`, "active", repoUrl, repo?.id ?? null, executionMode, ts, ts
    );
    // one node row per registered node type, in graph order
    for (const def of nodeRegistry.all()) {
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,status,created_at,updated_at)
         VALUES (?,?,?,?,'pending',?,?)`,
        db.uid("node_"), id, def.key, def.key, ts, ts
      );
    }
    db.emitEvent(id, null, "lifecycle", `flow created for ${ticket.key} (${executionMode} mode)`);
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
      c.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0) +
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

    const order = nodeRegistry.order();
    return {
      ...flow,
      cost: flowCost,
      branches,
      planSteps: steps,
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
        db.emitEvent(flowId, null, "error", msg);
        if (nodeKey) this.setNodeStatus(flowId, nodeKey, "failed");
        db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
      } finally {
        this.touch(flowId);
      }
    })();
  }

  /** Run a node with a validated input payload. */
  private async runNode(flowId: string, nodeKey: string, rawInput: unknown): Promise<string> {
    const def = nodeRegistry.get(nodeKey);
    const c = this.ctx(flowId);
    const input = def.parseInput(rawInput);
    const outcome = await def.run(c, input);
    return outcome.reply;
  }

  // ── public triggers ──────────────────────────────────────────────────────

  startPlan(flowId: string, prompt?: string, decompose?: boolean, model?: string, promptIsBody?: boolean): void {
    this.setCurrentNode(flowId, NODE_KEYS.PLAN);
    this.bg(flowId, NODE_KEYS.PLAN, () => this.runNode(flowId, NODE_KEYS.PLAN, {
      feedback: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false,
      decompose: decompose ?? false, model: model ?? null,
    }).then(() => {}));
  }

  refinePlan(flowId: string, feedback: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.setCurrentNode(flowId, NODE_KEYS.PLAN);
    this.bg(flowId, NODE_KEYS.PLAN, () => this.runNode(flowId, NODE_KEYS.PLAN, {
      feedback, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, decompose: false, model: model ?? null,
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

  approvePlan(flowId: string): void {
    const plan = db.get<{ id: string; content: string; meta: string | null }>(
      `SELECT a.* FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, flowId);
    if (!plan) throw new Error("no plan to approve");
    db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
    this.setNodeStatus(flowId, NODE_KEYS.PLAN, "approved");
    this.setCurrentNode(flowId, NODE_KEYS.BUILD);

    // structured branches from the plan-meta (validated by the plan node at save time)
    let branches: PlanBranch[] | null = null;
    try {
      const meta = plan.meta ? JSON.parse(plan.meta) : null;
      if (Array.isArray(meta?.branches) && meta.branches.length > 0) branches = meta.branches;
    } catch { /* single-branch fallback */ }

    // carry the model selected for the plan run into the build
    const planNode = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key='${NODE_KEYS.PLAN}'`, flowId);
    const planModel = (planNode?.input as { model?: string } | null)?.model ?? undefined;

    const buildDef = nodeRegistry.get(NODE_KEYS.BUILD);
    if (branches && branches.length > 1) {
      // Multi-branch: create branch rows and build sequentially in dependsOn order
      db.emitEvent(flowId, null, "lifecycle", `plan approved with ${branches.length} branches — building sequentially`);
      const sorted = this.topoSortBranches(branches);
      for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i];
        branchStore.upsert(flowId, b.name, { title: b.title, order: i, status: "pending" });
      }
      this.bg(flowId, NODE_KEYS.BUILD, async () => {
        const c = this.ctx(flowId);
        for (const b of sorted) {
          branchStore.upsert(flowId, b.name, { status: "building" });
          const input = buildDef.parseInput({
            plan: plan.content, prompt: null,
            branchInfo: { name: b.name, title: b.title, scope: b.scope },
            feedback: null, model: planModel ?? null,
          });
          await buildDef.run(c, input);
          branchStore.upsert(flowId, b.name, { status: "awaiting_approval" });
        }
      });
    } else {
      // Single-branch fast path
      this.bg(flowId, NODE_KEYS.BUILD, () => this.runNode(flowId, NODE_KEYS.BUILD, {
        plan: plan.content, prompt: null, branchInfo: null, feedback: null, model: planModel ?? null,
      }).then(() => {}));
    }
  }

  /** Topologically sort branches by dependsOn. Simple DFS — safe for small N. */
  private topoSortBranches(branches: PlanBranch[]): PlanBranch[] {
    const byName = new Map(branches.map((b) => [b.name, b]));
    const visited = new Set<string>();
    const result: PlanBranch[] = [];
    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const b = byName.get(name);
      if (!b) return;
      for (const dep of b.dependsOn ?? []) visit(dep);
      result.push(b);
    };
    for (const b of branches) visit(b.name);
    return result;
  }

  approveBuild(flowId: string, branchName?: string): void {
    this.setNodeStatus(flowId, NODE_KEYS.BUILD, "approved");
    this.setCurrentNode(flowId, NODE_KEYS.PIPELINE);
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
          this.setNodeStatus(flowId, NODE_KEYS.BUILD, "awaiting_approval");
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
    await this.afterPipelineGate(flowId, branchName);
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
   */
  private async afterPipelineGate(
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
    // first pass: resolve runs only when the scheduler had one due (comments
    // arrived mid-gate and the quiet period elapsed) — or immediately when the
    // caller just resolved code (resolveLoop). After a resolve run we re-gate,
    // and loop back into resolve whenever comments are still open.
    let inResolveLoop = opts.resolveLoop ?? false;
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
      this.setCurrentNode(flowId, NODE_KEYS.PIPELINE);
      await this.runNode(flowId, NODE_KEYS.PIPELINE, {
        branchName, pipelineId: null, guidance: null, prompt: null, promptIsBody: false, model: null,
        ...(gateInput ?? {}),
      });
      gateInput = null;

      // gate green → review (single-branch flows only; multi-branch reviews run
      // per-branch from the branch's own approval)
      if (!branchName) {
        this.setCurrentNode(flowId, NODE_KEYS.REVIEW);
        await this.runNode(flowId, NODE_KEYS.REVIEW, {
          instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
        });
      }

      // the resolve loop is flow-level (single-MR); multi-branch flows resolve
      // per branch from their own triggers
      if (branchName) return;
      const open = db.get<{ c: number }>(
        `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
      const due = this.resolveDue.get(flowId);
      this.resolveDue.delete(flowId);
      const scheduledDue = due != null && Date.now() >= due;
      if (open === 0 || (!inResolveLoop && !scheduledDue)) return;

      this.setCurrentNode(flowId, NODE_KEYS.RESOLVE);
      db.emitEvent(flowId, null, "lifecycle", `resolving ${open} open comment(s)`);
      await this.runNode(flowId, NODE_KEYS.RESOLVE, {
        instructions: null, prompt: null, promptIsBody: false, branchName: null, model: null,
      });
      const resolveNode = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, NODE_KEYS.RESOLVE);
      const resolved = (resolveNode?.output as { resolved?: number } | null)?.resolved ?? 0;
      if (resolved === 0) return; // nothing changed — no re-gate needed
      inResolveLoop = true; // code changed → loop: re-gate → review → resolve-if-open
    }
  }

  /**
   * Create the MR, running a commit-fix agent on the build node when the push
   * was rejected (pre-push/pre-receive hooks — e.g. type checks). Throws the
   * original error after MAX attempts, or immediately for infra failures.
   */
  private async createMrWithFixes(flowId: string, branchName: string | null): Promise<void> {
    const MAX_FIX_ATTEMPTS = 2;
    for (let attempt = 0; ; attempt++) {
      try {
        await mergeRequests.create(this.ctx(flowId), branchName ?? undefined);
        return;
      } catch (e: unknown) {
        if (!isCommitError(e) || attempt >= MAX_FIX_ATTEMPTS) throw e;
        db.emitEvent(flowId, null, "lifecycle",
          `push rejected — running a commit-fix agent on the build step (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
        this.setCurrentNode(flowId, NODE_KEYS.BUILD);
        this.setNodeStatus(flowId, NODE_KEYS.BUILD, "running");
        try {
          await this.runNode(flowId, NODE_KEYS.BUILD, {
            plan: null, prompt: null, branchInfo: null, model: null,
            feedback:
              `Pushing branch was rejected with the error below — most likely a pre-push/pre-receive hook ` +
              `(type check, lint, or test gate). Fix the code so the checks pass, commit, and push again to the same branch.\n\n` +
              `${e.detail}`,
          });
        } finally {
          this.setNodeStatus(flowId, NODE_KEYS.BUILD, "approved");
          this.setCurrentNode(flowId, NODE_KEYS.PIPELINE);
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

  /** Per-flow in-memory schedule state: "fire no earlier than". */
  private resolveDue = new Map<string, number>();

  /** How long after the last new open comment the resolve may start. */
  resolveDelayMs(): number {
    const stored = db.getSetting<number | null>("resolve.delay_ms", null);
    if (typeof stored === "number" && Number.isFinite(stored) && stored >= 0) return stored;
    const envRaw = (process.env.RESOLVE_DELAY_MINUTES ?? "").trim();
    if (envRaw) {
      const env = Number(envRaw);
      if (Number.isFinite(env) && env >= 0) return env * 60_000;
    }
    return 10 * 60_000; // default: 10 minutes
  }

  /**
   * Queue a resolve run for `flowId`, resetting the quiet period (each new
   * comment pushes the earliest start out by resolveDelayMs()). The flow's
   * poller tick fires the schedule — a no-op when the flow has no MR yet.
   */
  scheduleResolve(flowId: string): void {
    this.resolveDue.set(flowId, Date.now() + this.resolveDelayMs());
  }

  private pipelineGateBusy(flowId: string): boolean {
    const s = db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, NODE_KEYS.PIPELINE)?.status;
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
    const r = db.get<{ c: number }>(
      `SELECT COUNT(*) c FROM nodes WHERE flow_id=? AND status='running' AND node_key IN (?,?,?)`,
      flowId, NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE);
    return (r?.c ?? 0) > 0;
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
    this.setCurrentNode(flowId, NODE_KEYS.PIPELINE);
    this.bg(flowId, NODE_KEYS.PIPELINE, async () => {
      try {
        // always the full chain — a green gate flows on to review (and a
        // resolve when comments are waiting), never leaves the flow stranded
        await this.afterPipelineGate(flowId, null, {
          pipelineId: pipelineId ?? null, prompt: prompt ?? null,
          promptIsBody: promptIsBody ?? false, model: model ?? null,
        });
      } finally {
        this.setCurrentNode(flowId, null);
      }
    });
  }

  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean, opts: { scheduled?: boolean } = {}): void {
    if (this.nodeRunning(flowId, NODE_KEYS.RESOLVE)) return;
    // Direct triggers (Run button / API) respect the chain — resolve must not
    // run while the pipeline/review/resolve chain is in flight. `scheduled` is
    // the internal bypass for runs the scheduler already gated.
    if (!opts.scheduled && this.chainBusy(flowId)) {
      throw new Error("wait for the pipeline/review step to finish before running resolve");
    }
    this.setCurrentNode(flowId, NODE_KEYS.RESOLVE);
    this.bg(flowId, NODE_KEYS.RESOLVE, async () => {
      await this.runNode(flowId, NODE_KEYS.RESOLVE, {
        instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
      });
      // code changed on the MR branch (comments were resolved) — re-enter the
      // unified chain in resolve-loop mode (pipeline gate → review → resolve
      // while open comments remain). Everything runs inline in this task, so
      // resolve can never double-run for the same batch.
      const resolveNode = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, NODE_KEYS.RESOLVE);
      const resolved = (resolveNode?.output as { resolved?: number } | null)?.resolved ?? 0;
      if (resolved > 0) {
        await this.afterPipelineGate(flowId, null, { resolveLoop: true });
      }
      this.setCurrentNode(flowId, null);
    });
  }

  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    if (this.chainBusy(flowId)) throw new Error("wait for the current pipeline/review/resolve run to finish first");
    this.setCurrentNode(flowId, NODE_KEYS.REVIEW);
    this.bg(flowId, NODE_KEYS.REVIEW, () => this.runNode(flowId, NODE_KEYS.REVIEW, {
      instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
    }).then(() => this.setCurrentNode(flowId, null)));
  }

  /** Re-run a node after failure, using its recorded (schema-validated) input. */
  retryNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const def = nodeRegistry.get(nodeKey);
    if (!def.retryable) throw new Error(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (node.status === "running") throw new Error(`${nodeKey} is already running`);
    if ([NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE].includes(nodeKey as never) && this.chainBusy(flowId)) {
      throw new Error("wait for the current pipeline/review/resolve run to finish first");
    }
    db.emitEvent(flowId, node.id, "lifecycle", `retrying ${nodeKey}`);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      // retrying the pipeline gate continues the chain — a gate that timed out
      // self-heals (an already-green head finishes immediately) and the flow
      // then advances to review instead of staying stuck.
      if (nodeKey === NODE_KEYS.PIPELINE) {
        const branch = (recorded as { branchName?: string | null }).branchName ?? null;
        await this.afterPipelineGate(flowId, branch);
      } else {
        await def.run(this.ctx(flowId), recorded);
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
  sendChat(flowId: string, nodeKey: string, content: string, chatOnly = false): void {
    const def = nodeRegistry.get(nodeKey); // validates the key
    db.addMessage(flowId, nodeKey, "user", content);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      const reply = chatOnly
        ? await def.converse(this.ctx(flowId), content)
        : await def.chat(this.ctx(flowId), content);
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
