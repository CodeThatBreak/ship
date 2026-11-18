import "server-only";

import { db } from "../../../db/app";
import type { FlowRow, NodeRow } from "../../../db/rows";
import { engineParts } from "../../../composition/container";
import { flowEngine } from "../../flowEngine";
import { agentPortRegistry } from "../../ports/agentPort";
import { flowCtxHelper, type FlowCtx } from "../../nodes/shared/nodeSharedExports";
import type { NodeSupport } from "../../nodes/shared/nodeSupport";
import type { RecoveryHost } from "./types/reconcile";

/**
 * RecoveryDriver — drives one lease-expired `running` node to
 * recovered-or-manual (Invariant 3, step 03 interim ABI: the full
 * result-object ABI lands in step 05). A throw never escapes: any failure
 * maps to `failOrphanedNode` (manual — the user retries), so the reconciler
 * pass itself is crash-safe per node.
 *
 * Liveness here is lease + persisted agent state, never in-process handles:
 * the worker-side driver probes the run row's lease first, then the SDK's
 * persisted session store (local mode) or the runtime API (cloud mode). The
 * one handle check that remains (`hasActiveRun`) is a fast-path for runs
 * executing in THIS process — correct in web and worker alike.
 */
export class RecoveryDriver {
  /** cloud runs we've re-attached to in this process (avoid double streaming) */
  private readonly reattached = new Set<string>();

  constructor(
    private readonly host: RecoveryHost = flowEngine,
    private readonly support: NodeSupport = engineParts.nodeSupport,
  ) {}

  /**
   * Recover one expired node. Interim ABI (step 05): resolves on
   * recovered/failed, never throws — an internal error fails the node
   * manually with the reason.
   */
  async recover(flow: FlowRow, node: { id: string; nodeKey: string }): Promise<void> {
    try {
      const full = await this.support.nodeByKey(flow.id, node.nodeKey);
      if (full.status !== "running") return; // a concurrent pass already moved it
      await this.recoverNode(flow, full);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      await this.host
        .failOrphanedNode(flow.id, node.id, node.nodeKey, `recovery failed: ${reason}`)
        .catch(() => {});
    }
  }

  private async recoverNode(flow: FlowRow, node: NodeRow): Promise<void> {
    const runRow = await db.get<{ agentRef: string; runRef: string; leaseLive: boolean }>(
      `SELECT agent_ref AS "agentRef", run_ref AS "runRef", (lease_until > now()) AS "leaseLive"
       FROM runs WHERE node_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1`,
      node.id,
    );
    // the run's own lease is still current — whichever process started it is
    // alive and heartbeating (the worker reconciles runs owned by the web
    // process; liveness is the lease, never this process's handle set)
    if (runRow?.leaseLive) return;
    const ctx = await this.host.ctx(flow.id);
    if (flow.executionMode === "local") {
      return this.recoverLocal(ctx, flow, node, runRow);
    }
    return this.recoverCloud(ctx, flow, node, runRow);
  }

  // ── local mode: the in-process handle means alive; otherwise the SDK's ────
  // ── persisted run state is the ground truth ───────────────────────────────
  private async recoverLocal(
    ctx: FlowCtx,
    flow: FlowRow,
    node: NodeRow,
    runRow: { agentRef: string; runRef: string } | undefined,
  ): Promise<void> {
    const { flow: flowCtx } = ctx;
    const port = await agentPortRegistry.forMode("local");
    // run still owned by this process → genuinely running, nothing to do
    if (runRow && port.hasActiveRun(runRow.runRef)) return;

    if (!runRow) {
      await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, "node was left running without an active run");
      return;
    }

    if (this.support.isStartupRun(runRow.agentRef)) {
      await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, "node startup was interrupted");
      return;
    }

    // Not owned by this process: local agent loops run in-process, so the run
    // is no longer executing. Ask the SDK's persisted run state what happened.
    // The probe must use the run's own cwd (the flow's worktree when it used
    // one) — the SDK keys persisted sessions on it.
    const runCwd = flowCtxHelper.runCwd(ctx);
    const sessionId = runRow.agentRef;
    const probe =
      sessionId && runCwd
        ? await port.inspectSession(sessionId, runRow.runRef, runCwd).catch(() => null)
        : null;

    if (!probe) {
      await this.host.failOrphanedNode(
        flowCtx.id, node.id, node.nodeKey,
        "server restarted mid-run and the agent session could not be re-attached",
      );
      return;
    }

    if (!probe.completed) {
      await this.host.failOrphanedNode(
        flowCtx.id, node.id, node.nodeKey,
        "server restarted mid-run — the agent session shows an unfinished turn",
      );
      return;
    }

    // the turn finished before the server died — recover it
    await db.emitEvent(flowCtx.id, node.id, "lifecycle",
      `server restarted — re-attached to the agent session; the ${node.nodeKey} turn had finished, recovering`);
    await this.host.completeNodeFromResult(
      ctx,
      node,
      { id: runRow.runRef, status: "finished", result: probe.text },
      "recovered from the persisted agent session after server restart",
    );
  }

  // ── cloud mode: ask the runtime's API ─────────────────────────────────────
  private async recoverCloud(
    ctx: FlowCtx,
    flow: FlowRow,
    node: NodeRow,
    runRow: { agentRef: string; runRef: string } | undefined,
  ): Promise<void> {
    const { flow: flowCtx } = ctx;
    const port = await agentPortRegistry.forMode("cloud");
    if (!runRow) {
      await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, "node was left running without an active run");
      return;
    }

    if (this.support.isStartupRun(runRow.agentRef)) {
      await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, "node startup was interrupted");
      return;
    }

    const query = await port.getRun({ agentId: runRow.agentRef, runId: runRow.runRef });
    if (query.state === "unavailable") {
      await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, query.error.message);
      return;
    }
    const TERMINAL = ["finished", "error", "cancelled"];
    if (query.state === "terminal" && TERMINAL.includes(query.result.status)) {
      await this.host.completeNodeFromResult(ctx, node, query.result, "reconciled from the git/agent API");
      return;
    }

    // still running — re-attach once and stream it to completion
    if (this.reattached.has(runRow.runRef)) return;
    this.reattached.add(runRow.runRef);
    await db.emitEvent(flowCtx.id, node.id, "lifecycle", `re-attached to ${node.nodeKey} run on the agent runtime (server restarted)`);
    void (async () => {
      try {
        const final = await port.stream(
          { agentId: runRow.agentRef, runId: runRow.runRef },
          {
            onStatus: (s) => db.emitEvent(flowCtx.id, node.id, "status", `run ${s}`),
            onAssistant: (t) => db.emitEvent(flowCtx.id, node.id, "assistant", t),
            onThinking: (t) => db.emitEvent(flowCtx.id, node.id, "thinking", t.slice(0, 500)),
            onTool: (name, status, args) =>
              db.emitEvent(flowCtx.id, node.id, "tool", `${name}: ${status}`, { args: JSON.stringify(args ?? {}).slice(0, 300) }),
          });
        await this.host.completeNodeFromResult(ctx, node, final.result, "completed after re-attach");
      } catch (e: unknown) {
        await this.host.failOrphanedNode(flowCtx.id, node.id, node.nodeKey, `lost run stream: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.reattached.delete(runRow.runRef);
      }
    })();
  }
}
