import { db } from "../db";
import { FlowRow, NodeRow, RunRow, rows } from "../db/rows";
import { cursorClient } from "../integrations/cursor";
import { localAgent, LocalAgentService } from "../integrations/localAgent";
import { nodeSupport, type FlowCtx } from "./nodes/base";
import { flowEngine } from "./flow";
import { processSingleton } from "../singleton";

/**
 * Re-sync nodes stuck in `running` with the real state of their agent run.
 * Called when a flow is opened (throttled) so the UI recovers after a server
 * restart instead of showing "running" forever.
 *
 * - local mode: ACP sessions are persisted by the CLI — after a restart we
 *   session/load the run's session and reconstruct its last turn. Recovery
 *   itself is delegated to the node's own recover() via completeNodeFromResult.
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
   * A run heartbeat older than this with a dead owner pid means orphaned.
   * 2.5× the 15s heartbeat interval tolerates a missed beat under load.
   */
  private static readonly HEARTBEAT_STALE_MS = 40_000;
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

  async reconcileFlow(flowId: string): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - (this.lastReconcile.get(flowId) ?? 0) < Reconciler.THROTTLE_MS) return;
    this.lastReconcile.set(flowId, nowMs);

    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow || flow.status !== "active") return;

    const running = rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND status='running'`, flowId);
    for (const node of running) {
      try {
        // skip nodes that just started — their run may not be visible yet
        const updatedMs = Date.parse(node.updated_at ?? "");
        if (Number.isFinite(updatedMs) && nowMs - updatedMs < Reconciler.START_GRACE_MS) continue;
        // the pipeline node runs a server-side wait loop (no agent run row while
        // polling) and stamps updated_at each iteration — a fresh stamp means alive
        if (node.node_key === "pipeline" && Number.isFinite(updatedMs) && nowMs - updatedMs < Reconciler.PIPELINE_STAMP_FRESH_MS) continue;
        await this.reconcileNode(flow, node);
      } catch (e: unknown) {
        db.emitEvent(flowId, node.id, "error", `reconcile: ${e instanceof Error ? e.message : e}`);
      }
    }

    // clear a stale current_node pointer
    if (flow.current_node) {
      const cur = rows.get(NodeRow,
        `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, flow.current_node);
      if (!cur || cur.status !== "running") {
        db.run(`UPDATE flows SET current_node=NULL, updated_at=? WHERE id=? AND current_node=?`,
          db.now(), flowId, flow.current_node);
      }
    }
  }

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

  // ── local mode: DB liveness first, the persisted ACP session as ground truth ─
  private async reconcileLocal(ctx: FlowCtx, node: NodeRow, runRow: RunRow | undefined): Promise<void> {
    const { flow } = ctx;
    // run still owned by this process → genuinely running, nothing to do
    if (runRow && localAgent.hasActiveRun(runRow.cursor_run_id)) return;

    if (!runRow) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, "node was left running without an active run");
      return;
    }

    // A live run proves itself with a fresh heartbeat, not with which module
    // graph happens to hold its handle. Two cases mean "still running — leave
    // it alone":
    //   1. fresh heartbeat → the owner process is actively pumping events
    //   2. owner pid alive but heartbeat stale/never started → owner is wedged;
    //      don't fail (can't distinguish from slow), but don't recover either
    const heartbeatMs = Date.parse(runRow.last_heartbeat_at ?? "");
    const heartbeatFresh =
      Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs < Reconciler.HEARTBEAT_STALE_MS;
    if (heartbeatFresh) return;
    if (LocalAgentService.pidAlive(runRow.owner_pid)) return;

    // Legacy row (started before run-liveness existed): no pid, no heartbeat.
    // inspectSession can't tell "unfinished because dead" from "unfinished
    // because still executing in another process" — both replay identically —
    // so only fail when the session itself proves the turn ended badly or is
    // unloadable. A probe that completes is recovered; an unfinished probe is
    // left alone (retry is always available manually) rather than falsely
    // failed, which was the original bug.
    const legacy = runRow.owner_pid == null;
    const localPath = ctx.repo?.local_path ?? null;
    const sessionId = runRow.cursor_agent_id;
    const probe =
      sessionId && localPath
        ? await localAgent
            // legacy probes may hit a session a live process owns — keep the
            // read-only window short so it can't linger on that session.
            .inspectSession(sessionId, localPath, legacy ? 20_000 : 90_000)
            .catch(() => null)
        : null;

    if (!probe) {
      // unloadable: for a dead-owner run the session is truly gone; for a
      // legacy run it's ambiguous — don't fail what we can't prove is dead.
      if (legacy) return;
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key,
        "server restarted mid-run and the agent session could not be re-attached");
      return;
    }

    if (!probe.completed) {
      if (legacy) return;
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
      { status: "FINISHED", text: probe.text },
      "recovered from the persisted agent session after server restart"
    );
  }

  // ── cloud mode: ask the Cursor API ────────────────────────────────────────
  private async reconcileCloud(ctx: FlowCtx, node: NodeRow, runRow: RunRow | undefined): Promise<void> {
    const { flow } = ctx;
    if (!runRow) {
      nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, "node was left running without an active run");
      return;
    }

    const result = await cursorClient.getRun(runRow.cursor_agent_id, runRow.cursor_run_id).catch(() => null);
    if (!result) return; // API unreachable — leave state as-is, try again next open

    const TERMINAL = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"];
    if (TERMINAL.includes(result.status)) {
      await flowEngine.completeNodeFromResult(ctx, node, result, "reconciled from Cursor API");
      return;
    }

    // still running on Cursor — re-attach once and stream it to completion
    if (this.reattached.has(runRow.cursor_run_id)) return;
    this.reattached.add(runRow.cursor_run_id);
    db.emitEvent(flow.id, node.id, "lifecycle", `re-attached to ${node.node_key} run on Cursor (server restarted)`);
    (async () => {
      try {
        const final = await cursorClient.streamRun(runRow.cursor_agent_id, runRow.cursor_run_id, {
          onStatus: (s) => db.emitEvent(flow.id, node.id, "status", `run ${s}`),
          onAssistant: (t) => db.emitEvent(flow.id, node.id, "assistant", t),
          onThinking: (t) => db.emitEvent(flow.id, node.id, "thinking", t.slice(0, 500)),
          onTool: (name, status, args) =>
            db.emitEvent(flow.id, node.id, "tool", `${name}: ${status}`, { args: JSON.stringify(args ?? {}).slice(0, 300) }),
        });
        await flowEngine.completeNodeFromResult(ctx, node, final, "completed after re-attach");
      } catch (e: unknown) {
        nodeSupport.failOrphanedNode(flow.id, node.id, node.node_key, `lost run stream: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.reattached.delete(runRow.cursor_run_id);
      }
    })();
  }
}

export const reconciler = processSingleton("reconciler", () => new Reconciler());
