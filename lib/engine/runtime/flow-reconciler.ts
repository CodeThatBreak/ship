import { db } from "../../db";
import { FlowRow, NodeRow, RunRow, rows } from "../../db/rows";
import { agentPortRegistry } from "../ports/agent-port";
import { flowCtxHelper, nodeSupport, type FlowCtx } from "../nodes/shared";
import { usageTracker } from "../harness/usage-tracker";
import { flowEngine } from "../flow-engine";
import { stepFlows } from "./fanout/step-flow-manager";
import { mergeArena } from "./fanout/merge-arena";
import { templateStore } from "../templates/template-store";
import { processSingleton } from "../../singleton";

/**
 * Re-sync nodes stuck in `running` with the real state of their agent run.
 * Called when a flow is opened (throttled) so the UI recovers after a server
 * restart instead of showing "running" forever.
 *
 * - local mode: SDK local agents are persisted in the workspace store — after
 *   a restart we re-attach to the run's persisted state and reconstruct its
 *   last turn. Recovery itself is delegated to the node's own recover() via
 *   completeNodeFromResult.
 * - cloud mode: run handles are durable (agent id + run id), so we ask the
 *   Cursor API. Still-running runs are re-attached (streamed to completion).
 */
export class Reconciler {
  /** per-flow throttle: reconcile at most once every 20s while the page is open */
  private static readonly THROTTLE_MS = 20_000;
  /**
   * Never fail a node that flipped to `running` very recently — a fresh run that
   * hasn't registered its run row/handle yet would otherwise be failed mid-startup.
   */
  private static readonly START_GRACE_MS = 90_000;
  /**
   * The pipeline node runs a server-side wait loop with no agent run row while
   * polling, stamping its node row once per ~20s poll cycle. A stamp fresher
   * than this means the gate is alive (3× the poll interval tolerates a slow
   * GitLab call); a stale one means the wait died with the server.
   */
  private static readonly PIPELINE_STAMP_FRESH_MS = 90_000;

  private readonly lastReconcile = new Map<string, number>();
  /** cloud runs we've re-attached to in this process (avoid double streaming) */
  private readonly reattached = new Set<string>();
  /** step children already flagged orphaned in this process (event dedup) */
  private readonly flaggedOrphans = new Set<string>();

  async reconcileFlow(flowId: string): Promise<void> {
    // legacy runs captured without cost (and stale estimates) get a cost from
    // our list-price calculation — once per process, async, non-blocking
    void usageTracker.backfillCosts().catch(() => {});
    const nowMs = Date.now();
    if (nowMs - (this.lastReconcile.get(flowId) ?? 0) < Reconciler.THROTTLE_MS) return;
    this.lastReconcile.set(flowId, nowMs);

    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow || flow.status !== "active") return;

    await this.reconcileRunningNodes(flow);

    // clear a stale current_node pointer
    if (flow.current_node) {
      const cur = rows.get(NodeRow,
        `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, flow.current_node);
      if (!cur || cur.status !== "running") {
        db.run(`UPDATE flows SET current_node=NULL, updated_at=? WHERE id=? AND current_node=?`,
          db.now(), flowId, flow.current_node);
      }
    }

    // plan fan-out (Phase 2B): stuck step_merges rows resume-or-flag; orphan
    // children surface loud. Covers both directions — opening the parent page
    // or any child's page reconciles the fan-out family.
    await this.reconcileStepFanout(flow);
  }

  /** The stuck-`running` node recovery pass of one flow (page open / global sweep). */
  private async reconcileRunningNodes(flow: FlowRow): Promise<void> {
    const nowMs = Date.now();
    const flowId = flow.id;
    const running = rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND status='running'`, flowId);
    // the node waiting on the pipeline event source (role lookup — the CI gate
    // runs a server-side wait loop; no hardcoded node key)
    const gateKey = templateStore.waitNodeKey(flowId, "pipeline");
    for (const node of running) {
      try {
        // skip nodes that just started — their run may not be visible yet
        const updatedMs = Date.parse(node.updated_at ?? "");
        if (Number.isFinite(updatedMs) && nowMs - updatedMs < Reconciler.START_GRACE_MS) continue;
        // the pipeline gate runs a server-side wait loop (no agent run row while
        // polling) and stamps updated_at each iteration — a fresh stamp means alive
        if (node.node_key === gateKey && Number.isFinite(updatedMs) && nowMs - updatedMs < Reconciler.PIPELINE_STAMP_FRESH_MS) continue;
        await this.reconcileNode(flow, node);
      } catch (e: unknown) {
        db.emitEvent(flowId, node.id, "error", `reconcile: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ── plan fan-out (Phase 2B): stuck step_merges + orphan children ──────────

  private async reconcileNode(flow: FlowRow, node: NodeRow): Promise<void> {
    const runRow = rows.get(RunRow,
      `SELECT * FROM runs WHERE node_id=? AND status='running' ORDER BY created_at DESC LIMIT 1`,
      node.id
    );
    const ctx = flowEngine.ctx(flow.id);

    if (flow.execution_mode === "local") {
      return this.reconcileLocal(ctx, node, runRow);
    }
    return this.reconcileCloud(ctx, node, runRow);
  }

  // ── plan fan-out (Phase 2B): stuck step_merges + orphan children ──────────

  /**
   * Phase 2B — stuck merge-backs and orphaned step children of one fan-out
   * family. `step_merges` rows are durable (written before git), so after a
   * restart:
   *  - a row still `running`/`conflict`/`rejected` whose owning process is
   *    dead resumes the merge arena (bounded by the merge-fix budget) when the
   *    child is still approved/pending — or flags failed loudly (event on the
   *    parent, failed-visible step card) when the child is red/dead.
   *  - orphan children (the `plan_steps.sub_flow_id` linkage or the parent
   *    fan-out node gone) are surfaced on the parent once; they are inert.
   * In-flight merges of the live process are never double-booked
   * (`mergeArena.isMerging`).
   */
  private async reconcileStepFanout(flow: FlowRow): Promise<void> {
    const parentId = flow.parent_flow_id ?? flow.id;
    const stuck = db.all<{ id: string; flow_id: string; parent_flow_id: string; parent_node: string; status: string; updated_at: string | null }>(
      `SELECT * FROM step_merges WHERE parent_flow_id=? AND status IN ('running','conflict','rejected')`, parentId
    );
    for (const row of stuck) {
      try {
        await this.reconcileStepMerge(row);
      } catch (e: unknown) {
        db.emitEvent(parentId, null, "error",
          `reconcile: step merge ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (flow.parent_flow_id == null) await this.reconcileOrphanChildren(flow.id);
  }

  private async reconcileStepMerge(row: {
    id: string; flow_id: string; parent_flow_id: string; parent_node: string; status: string; updated_at: string | null;
  }): Promise<void> {
    const failLoud = (reason: string): void => {
      db.run(`UPDATE step_merges SET status='failed', error=?, updated_at=? WHERE id=? AND status IN ('running','conflict','rejected')`,
        reason.slice(0, 2000), db.now(), row.id);
      db.emitEvent(row.parent_flow_id, null, "error",
        `step merge-back on "${row.parent_node}" was interrupted: ${reason}`,
        { nodeKey: row.parent_node, childFlowId: row.flow_id, mergeId: row.id });
    };
    if (mergeArena.isMerging(row.flow_id)) return; // alive in this process — nothing to flag
    // freshness guard: an attempt this process just re-booked stamps the row —
    // give it the same start grace the node reconcile uses
    const updatedMs = Date.parse(row.updated_at ?? "");
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs < Reconciler.START_GRACE_MS) return;

    const parent = db.get<{ id: string; status: string }>(`SELECT id, status FROM flows WHERE id=?`, row.parent_flow_id);
    const child = db.get<{ id: string; parent_flow_id: string; status: string }>(
      `SELECT id, parent_flow_id, status FROM flows WHERE id=?`, row.flow_id);
    if (!parent || !child || child.parent_flow_id !== row.parent_flow_id) {
      failLoud("the step child or its parent flow row is gone (orphaned merge-back)");
      return;
    }
    const step = db.get<{ id: string; title: string; status: string }>(
      `SELECT id, title, status FROM plan_steps WHERE sub_flow_id=?`, row.flow_id);
    if (!step) {
      failLoud("the plan step ⇄ sub-flow linkage is gone (orphaned merge-back)");
      return;
    }
    const parentNode = db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, row.parent_flow_id, row.parent_node);
    if (!parentNode) {
      failLoud(`the parent fan-out node "${row.parent_node}" no longer exists (orphaned merge-back)`);
      return;
    }
    if (child.status !== "active") {
      failLoud(`the step child is ${child.status} but its merge never landed`);
      return;
    }
    const childNode = db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, row.flow_id);
    if (!childNode) {
      failLoud("the step child has no nodes (the fan-out linkage is broken)");
      return;
    }
    if (childNode.status === "running") {
      // a merge-fix agent run was mid-flight at the restart — the child's runs
      // are durable, so the STANDARD node reconcile decides recovered vs failed
      const childFlow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, row.flow_id);
      if (childFlow) await this.reconcileRunningNodes(childFlow);
      const after = db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, row.flow_id)?.status;
      if (after === "awaiting_approval") stepFlows.resumePendingMerge(row.flow_id);
      return;
    }
    if (childNode.status !== "awaiting_approval") {
      failLoud(`the step child node is ${childNode.status} (merge interrupted) — Retry the step to re-run the merge (+ fix agent)`);
      return;
    }
    // safe resume: the child is approved and unmerged — re-enter the bounded loop
    stepFlows.resumePendingMerge(row.flow_id);
  }

  /** Orphan step children: the linkage (or the whole parent node) is gone — flag once, leave inert. */
  private async reconcileOrphanChildren(parentFlowId: string): Promise<void> {
    const children = db.all<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM flows WHERE parent_flow_id=? AND kind='step'`, parentFlowId
    );
    for (const c of children) {
      if (db.get(`SELECT 1 FROM plan_steps WHERE sub_flow_id=?`, c.id)) continue;
      if (this.flaggedOrphans.has(c.id)) continue;
      this.flaggedOrphans.add(c.id);
      db.emitEvent(parentFlowId, null, "error",
        `orphan step child "${c.name}" — its plan step no longer links to it (the step was removed or the flow re-planned); the child is inert and hidden from lists`,
        { childFlowId: c.id });
    }
  }

  /**
   * Global pass (server start, called from the poller's lazy start next to the
   * worktree sweep): every parent with a stuck step_merges row after a
   * restart — resume or flag, including when nobody has opened a flow page.
   */
  async sweepStuckStepMerges(): Promise<void> {
    const parents = db.all<{ p: string }>(
      `SELECT DISTINCT parent_flow_id p FROM step_merges WHERE status IN ('running','conflict','rejected')`
    );
    for (const { p } of parents) {
      const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, p);
      if (!flow || flow.status !== "active") continue;
      try {
        await this.reconcileStepFanout(flow);
      } catch (e: unknown) {
        db.emitEvent(p, null, "error", `reconcile: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── local mode: the in-process handle means alive; otherwise the SDK's ────
  // ── persisted run state is the ground truth ───────────────────────────────
  private async reconcileLocal(ctx: FlowCtx, node: NodeRow, runRow: RunRow | undefined): Promise<void> {
    const { flow } = ctx;
    const port = agentPortRegistry.forMode("local");
    // run still owned by this process → genuinely running, nothing to do
    if (runRow && port.hasActiveRun(runRow.cursor_run_id)) return;

    if (!runRow) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, "node was left running without an active run");
      return;
    }

    // Not owned by this process: local agent loops run in-process, so the run
    // is no longer executing. Ask the SDK's persisted run state what happened.
    // The probe must use the run's own cwd (the flow's worktree when it used
    // one) — the SDK keys persisted sessions on it.
    const runCwd = flowCtxHelper.runCwd(ctx);
    const sessionId = runRow.cursor_agent_id;
    const probe =
      sessionId && runCwd
        ? await port
            .inspectSession(sessionId, runRow.cursor_run_id, runCwd)
            .catch(() => null)
        : null;

    if (!probe) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key,
        "server restarted mid-run and the agent session could not be re-attached");
      return;
    }

    if (!probe.completed) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key,
        "server restarted mid-run — the agent session shows an unfinished turn");
      return;
    }

    // the turn finished before the server died — recover it
    db.emitEvent(flow.id, node.id, "lifecycle",
      `server restarted — re-attached to the agent session; the ${node.node_key} turn had finished, recovering`);
    await flowEngine.completeNodeFromResult(
      ctx,
      node,
      { id: runRow.cursor_run_id, status: "finished", result: probe.text },
      "recovered from the persisted agent session after server restart"
    );
  }

  // ── cloud mode: ask the Cursor API ────────────────────────────────────────
  private async reconcileCloud(ctx: FlowCtx, node: NodeRow, runRow: RunRow | undefined): Promise<void> {
    const { flow } = ctx;
    const port = agentPortRegistry.forMode("cloud");
    if (!runRow) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, "node was left running without an active run");
      return;
    }

    const result = await port
      .getRun({ agentId: runRow.cursor_agent_id, runId: runRow.cursor_run_id })
      .catch(() => null);
    // null means either unreachable or still in flight — distinguish below.
    const TERMINAL = ["finished", "error", "cancelled"];
    if (result && TERMINAL.includes(result.status)) {
      await flowEngine.completeNodeFromResult(ctx, node, result, "reconciled from the git/agent API");
      return;
    }

    // still running — re-attach once and stream it to completion
    if (this.reattached.has(runRow.cursor_run_id)) return;
    this.reattached.add(runRow.cursor_run_id);
    db.emitEvent(flow.id, node.id, "lifecycle", `re-attached to ${node.node_key} run on the agent runtime (server restarted)`);
    (async () => {
      try {
        const final = await port.stream(
          { agentId: runRow.cursor_agent_id, runId: runRow.cursor_run_id },
          {
          onStatus: (s) => db.emitEvent(flow.id, node.id, "status", `run ${s}`),
          onAssistant: (t) => db.emitEvent(flow.id, node.id, "assistant", t),
          onThinking: (t) => db.emitEvent(flow.id, node.id, "thinking", t.slice(0, 500)),
          onTool: (name, status, args) =>
            db.emitEvent(flow.id, node.id, "tool", `${name}: ${status}`, { args: JSON.stringify(args ?? {}).slice(0, 300) }),
        });
        await flowEngine.completeNodeFromResult(ctx, node, final.result, "completed after re-attach");
      } catch (e: unknown) {
        nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, `lost run stream: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.reattached.delete(runRow.cursor_run_id);
      }
    })();
  }
}

export const reconciler = processSingleton("reconciler", () => new Reconciler());
