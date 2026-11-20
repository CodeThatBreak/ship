import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import type { QueryExecutor } from "../../../db/database";
import { CommentRow, NodeRow } from "../../../db/rows";
import { ValidationError } from "../../../errors";
import {
  ARTIFACT_STATUS,
  COMMENT_STATUS,
  EVENT_KIND,
  RESOLVED_BY_AGENT,
  RUN_AGENT_REF,
  RUN_STATUS,
} from "../../constants/vocabulary";
import { NODE_LEASE_SECONDS, RUN_LEASE_SECONDS } from "../../constants/leases";
import type { HostNote } from "../../ports/gitHost";
import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type {
  NodeOutcome,
  TransitionKey,
} from "../../runtime/transitions/types/transitions";
import type { TransitionAuthority } from "../../runtime/transitions/nodeTransitions";
import { jsonInput, parseNodeJsonPatch, parseRow, parseRows } from "./nodeSupport/utils/ormRows";

/**
 * Persistence helpers for node rows, artifacts, runs and flow-feed events —
 * the shared DB surface every node implementation builds on. Node
 * implementations never import `db` directly: every read/write they need
 * appears here as a named method (T1 seam).
 *
 * Status writes funnel into the {@link TransitionAuthority} (step 02,
 * Invariant 1): `applyTransition`/`applyTransitionFenced`/`publishOutcome`
 * are thin delegates, and `setNode` REFUSES `status`/`attempt_id` keys so no
 * node kind can smuggle a raw status write past the declared table. The
 * instance is constructed in `lib/composition` (decision Q9).
 *
 * Must never: write `nodes.status` or `attempt_id` outside the authority.
 */
export class NodeSupport {
  constructor(private readonly transitions: TransitionAuthority) {}

  /** One pure-DB sequence in a transaction — or joined to the caller's tx (step 06, Invariant 7). */
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, tx?: Prisma.TransactionClient): Promise<T> {
    return db.transaction(fn, tx);
  }

  /** The flow-node row (null when absent), narrowed through the shared NodeRow mapper. */
  private async nodeRow(flowId: string, nodeKey: string): Promise<NodeRow | null> {
    const row = await db.prisma.node.findFirst({ where: { flowId, nodeKey } });
    return row ? parseRow(NodeRow, row, `node ${nodeKey} for flow ${flowId}`) : null;
  }

  async nodeByKey(flowId: string, key: string): Promise<NodeRow> {
    const n = await this.nodeRow(flowId, key);
    if (!n) throw new Error(`node ${key} not found for flow ${flowId}`);
    return n;
  }

  /** Like nodeByKey but null when the instance key is absent (optional chain stages). */
  async optionalNodeByKey(flowId: string, key: string): Promise<NodeRow | null> {
    return this.nodeRow(flowId, key);
  }

  /** First node row of a given built-in node type (instance keys may differ
   *  from the type; callers that address by node_key use `nodeByKey`). */
  async nodeByType(flowId: string, type: string): Promise<NodeRow | null> {
    const row = await db.prisma.node.findFirst({ where: { flowId, type } });
    return row ? parseRow(NodeRow, row, `node of type ${type} for flow ${flowId}`) : null;
  }

  /** A node's current status (null when the row is gone) — polling callers
   * use this to detect an external cancel/retry mid-wait. */
  async nodeStatus(nodeId: string): Promise<string | null> {
    const row = await db.prisma.node.findUnique({ where: { id: nodeId }, select: { status: true } });
    return row?.status ?? null;
  }

  /**
   * Patch non-status node columns (input, output, agent_id, config …).
   * `status`/`attempt_id` are REFUSED — every status write goes through the
   * transition authority's declared table (Invariant 1), so a smuggled key
   * fails loudly here instead of landing unfenced in the DB.
   */
  async setNode(id: string, patch: Record<string, unknown>): Promise<void> {
    if ("status" in patch || "attempt_id" in patch) {
      throw new ValidationError("node status writes go through the TransitionAuthority (declared transitions only)");
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    // text→jsonb cast parity + column-name contract: pre-serialized strings
    // for the nodes JSONB columns (input/output/config) are parsed before
    // reaching Prisma, which the old `text → jsonb` cast used to do, and the
    // raw-era snake_case column keys map onto Prisma field names
    // (see parseNodeJsonPatch).
    await db.prisma.node.update({
      where: { id },
      data: { ...parseNodeJsonPatch(patch), updatedAt: new Date() } as Prisma.NodeUpdateInput,
    });
  }

  /**
   * Heartbeat a running stage's durable leases (step 03, Invariant 2):
   * extend `nodes.lease_until` (and `runs.lease_until` while a run row
   * exists — `runRef` null when it does not yet). Every loop that owns a
   * running node calls this at least every NODE_LEASE_HEARTBEAT_MS; the
   * reconciler's liveness test is `lease_until > now()`.
   */
  async heartbeatLeases(nodeId: string, runRef: string | null): Promise<void> {
    await this.stampNodeLease(nodeId);
    if (runRef) {
      await this.stampRunLease(runRef);
    }
  }

  /**
   * Lease invariant (step 03, Invariant 2): a `running` node is alive while
   * `nodes.lease_until > now()`. The stamp is interval arithmetic on
   * DB-server time (`make_interval` has no Prisma equivalent) — kept raw,
   * isolated here as the ONLY raw `nodes` write in this seam, touching
   * `lease_until` only (never `status`/`attempt_id`).
   */
  private async stampNodeLease(nodeId: string): Promise<void> {
    await db.run(`UPDATE nodes SET lease_until = now() + make_interval(secs => $1) WHERE id=$2`,
      NODE_LEASE_SECONDS, nodeId);
  }

  /** Run-lease half of the same invariant: `runs.lease_until > now()` while the agent runs. */
  private async stampRunLease(runRef: string): Promise<void> {
    await db.run(`UPDATE runs SET lease_until = now() + make_interval(secs => $1) WHERE run_ref=$2`,
      RUN_LEASE_SECONDS, runRef);
  }

  // ── transition-authority delegates (Invariant 1 funnels) ─────────────────

  /**
   * Apply a declared transition by (flow, nodeKey) — thin delegate to
   * `TransitionAuthority.apply` (from-set fenced; returns false on a missed
   * from-set, matching the fire-and-forget call sites that read-check first).
   */
  applyTransition(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<boolean> {
    return this.transitions.apply(flowId, nodeKey, key, opts);
  }

  /** Attempt-fenced transition by node id (chat-turn reverts). */
  applyTransitionFenced(params: {
    flowId: string;
    nodeKey: string;
    nodeId: string;
    attemptId: string;
    key: TransitionKey;
    toStatus?: EngineNodeStatus;
    patch?: Record<string, unknown>;
  }): Promise<void> {
    return this.transitions.transitionFenced(params);
  }

  /**
   * THE terminal door for a finished run — thin delegate to
   * `TransitionAuthority.publishOutcome` (status + validated output in one
   * attempt-fenced statement). Node kinds never publish a terminal any other
   * way.
   */
  publishOutcome(params: {
    flowId: string;
    nodeKey: string;
    nodeId: string;
    attemptId?: string | null;
    outcome: NodeOutcome; tx?: QueryExecutor;
  }): Promise<void> {
    return this.transitions.publishOutcome(params);
  }

  /** A chat row scoped to a refinement thread (the plan's sub-plan refines). */
  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null
  ): Promise<void> {
    return db.addMessage(flowId, nodeKey, role, content, thread ?? null);
  }

  /**
   * Save a new artifact version — supersede + insert (with the version read)
   * in ONE transaction (step 06, Invariant 7): a crash never leaves a kind
   * with no draft artifact. Joins the caller's tx when passed.
   */
  async saveArtifact(
    nodeId: string, flowId: string, kind: string, content: string,
    meta?: unknown, status = ARTIFACT_STATUS.DRAFT, tx?: QueryExecutor,
  ): Promise<{ id: string; version: number }> {
    return this.transaction(async (t) => {
      const top = await t.artifact.findFirst({
        where: { nodeId, kind },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (top?.version ?? 0) + 1;
      await t.artifact.updateMany({
        where: { nodeId, kind, status: ARTIFACT_STATUS.DRAFT },
        data: { status: ARTIFACT_STATUS.SUPERSEDED },
      });
      const id = db.uid("art_");
      await t.artifact.create({
        data: {
          id,
          nodeId,
          flowId,
          kind,
          version,
          content,
          meta: meta ? jsonInput(meta) : Prisma.JsonNull,
          status,
          createdAt: new Date(),
        },
      });
      return { id, version };
    }, tx);
  }

  /**
   * Placeholder run row for the current attempt — written at the start of
   * `executeRun` so reconcile sees a run while the agent is still starting.
   * `run_ref` is the attempt token until `persistRun` upgrades the row; the
   * attempt token, capability token and a run lease are stamped next to it.
   */
  async registerStartupRun(flowId: string, nodeId: string, attemptId: string, apiToken?: string | null): Promise<void> {
    const existing = await db.prisma.run.findFirst({
      where: { nodeId, status: RUN_STATUS.RUNNING },
      orderBy: { createdAt: "desc" },
      select: { agentRef: true, runRef: true },
    });
    if (existing?.agentRef === RUN_AGENT_REF.PENDING && existing.runRef === attemptId) {
      return;
    }
    // close-prior-runs UPDATE + placeholder INSERT in ONE tx (step 06, Invariant 7)
    await this.transaction(async (t) => {
      await t.run.updateMany({
        where: { nodeId, status: RUN_STATUS.RUNNING },
        data: { status: RUN_STATUS.ERROR, leaseUntil: null, updatedAt: new Date() },
      });
      // api_token (step 08): the claim-minted capability token rides the startup row.
      await t.run.create({
        data: {
          id: db.uid("run_"),
          flowId,
          nodeId,
          agentRef: RUN_AGENT_REF.PENDING,
          runRef: attemptId,
          attemptId,
          apiToken: apiToken ?? null,
          // Claim insert: the lease timestamp is computed in JS instead of the
          // old `now() + make_interval(...)` SQL — the single-writer lock makes
          // app-clock skew acceptable (decision in orm-migration task 03).
          leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
          status: RUN_STATUS.RUNNING,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }

  isStartupRun(agentRef: string): boolean {
    return agentRef === RUN_AGENT_REF.PENDING;
  }

  async persistRun(flowId: string, nodeId: string, agentId: string, runId: string, apiToken?: string | null): Promise<string> {
    const node = await db.prisma.node.findUnique({ where: { id: nodeId }, select: { attemptId: true } });
    const attemptId = node?.attemptId;
    if (attemptId) {
      const changes = await db.prisma.run.updateMany({
        where: {
          nodeId,
          status: RUN_STATUS.RUNNING,
          agentRef: RUN_AGENT_REF.PENDING,
          runRef: attemptId,
        },
        data: {
          agentRef: agentId,
          runRef: runId,
          attemptId,
          // Lease re-stamp rides the upgrade CAS: computed in JS (single-writer
          // lock makes app-clock skew acceptable — same rationale as the claim
          // inserts) so the fenced upgrade stays ONE statement.
          leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
          updatedAt: new Date(),
        },
      });
      if (changes.count === 1) {
        const upgraded = await db.prisma.run.findFirst({ where: { runRef: runId }, select: { id: true } });
        if (upgraded) {
          await db.prisma.run.updateMany({
            where: { nodeId, status: RUN_STATUS.RUNNING, runRef: { not: runId } },
            data: { status: RUN_STATUS.ERROR, updatedAt: new Date() },
          });
          return upgraded.id;
        }
      }
    }
    // close out any prior `running` rows for this node — they're stale (their
    // process died with a previous server/run) and would otherwise be picked up
    // as the "latest running run" by reconcile; close + insert in ONE tx (step 06, Invariant 7)
    return this.transaction(async (t) => {
      await t.run.updateMany({
        where: { nodeId, status: RUN_STATUS.RUNNING },
        data: { status: RUN_STATUS.ERROR, updatedAt: new Date() },
      });
      const id = db.uid("run_");
      await t.run.create({
        data: {
          id,
          flowId,
          nodeId,
          agentRef: agentId,
          runRef: runId,
          attemptId: attemptId ?? null,
          apiToken: apiToken ?? null,
          // Claim insert: lease computed in JS (see registerStartupRun).
          leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
          status: RUN_STATUS.RUNNING,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return id;
    });
  }

  async lastAgentId(nodeId: string, tx?: QueryExecutor): Promise<string | null> {
    const row = await (tx ?? db.prisma).run.findFirst({
      where: { nodeId, agentRef: { not: RUN_AGENT_REF.PENDING } },
      orderBy: { createdAt: "desc" },
      select: { agentRef: true },
    });
    return row?.agentRef ?? null;
  }

  /** Update the run row with the real agent/session id once known (local mode). */
  async setRunAgentId(runId: string, agentId: string): Promise<void> {
    await db.prisma.run.updateMany({
      where: { runRef: runId },
      data: { agentRef: agentId, updatedAt: new Date() },
    });
  }

  // ── artifacts ────────────────────────────────────────────────────────────

  /**
   * The flow's latest artifact of a kind (by version), optionally scoped to
   * the node rows of one type (e.g. only the plan node's plan artifacts when
   * a template holds several nodes that save the same kind). Raw meta comes
   * back unparsed — callers own their schema.
   */
  async latestArtifact(
    flowId: string,
    kind: string,
    opts: { nodeType?: string } = {},
  ): Promise<{ id: string; version: number; content: string; meta: unknown } | null> {
    return (await this.artifactsOfKind(flowId, kind, { ...opts, limit: 1 }))[0] ?? null;
  }

  /** A kind's artifacts within a flow, newest first, `limit`-bounded. */
  async artifactsOfKind(
    flowId: string,
    kind: string,
    opts: { nodeType?: string; limit?: number } = {},
  ): Promise<{ id: string; version: number; content: string; meta: unknown }[]> {
    const found = await db.prisma.artifact.findMany({
      where: {
        kind,
        node: { flowId, ...(opts.nodeType ? { type: opts.nodeType } : {}) },
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      take: opts.limit ? Math.trunc(opts.limit) : undefined,
      select: { id: true, version: true, content: true, meta: true },
    });
    return found.map((a) => ({ id: a.id, version: a.version, content: a.content, meta: a.meta }));
  }

  // ── branches ─────────────────────────────────────────────────────────────

  /** A branch row's MR iid (null when the branch has no merge request yet). */
  async branchMrIid(flowId: string, name: string): Promise<number | null> {
    const row = await db.prisma.branch.findFirst({ where: { flowId, name }, select: { mrIid: true } });
    return row?.mrIid ?? null;
  }

  // ── comments ─────────────────────────────────────────────────────────────

  /**
   * A flow's open MR comments (validated by the shared row mapper), in
   * deterministic order (G12) — the resolve prompt's comment list and the
   * contract's decision coverage are built from this ordering.
   */
  async openComments(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    return this.commentRows({
      flowId,
      status: COMMENT_STATUS.OPEN,
      ...(mrIid != null ? { mrIid } : {}),
    });
  }

  /** Comment rows in deterministic (created_at, id) order (G12), narrowed through the shared mapper. */
  private async commentRows(where: Prisma.CommentWhereInput): Promise<CommentRow[]> {
    const found = await db.prisma.comment.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return parseRows(CommentRow, found, "comments");
  }

  /** Record an agent resolution for a comment row. */
  resolveComment(id: string): Promise<void> {
    return this.resolveComments([id]);
  }

  /**
   * Mark several comment rows resolved-by-agent in one statement (G9) —
   * multi-note threads store one row per note, so every row of a resolved
   * discussion is closed together behind a single per-discussion host call.
   * No-op for an empty id list.
   */
  async resolveComments(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.prisma.comment.updateMany({
      where: { id: { in: [...ids] } },
      data: {
        status: COMMENT_STATUS.RESOLVED,
        resolvedBy: RESOLVED_BY_AGENT,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * The MR's agent-authored comment rows (`resolved_by='agent'`) — the resolve
   * prompt's "already replied — awaiting reviewer" markers (G11): an open row
   * in the same discussion means the agent answered it last cycle and the
   * reviewer hasn't responded yet. Deterministic order for the prompt.
   */
  async agentReplies(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    return this.commentRows({
      flowId,
      resolvedBy: RESOLVED_BY_AGENT,
      ...(mrIid != null ? { mrIid } : {}),
    });
  }

  /**
   * Insert the agent's just-posted thread reply as a local comment row (G10):
   * `resolved` + `resolved_by='agent'` keeps the `commentStore.ingest` guard
   * from re-opening it when the poller/webhook later deliver the same note,
   * and `presentComments` reads the row as the "already replied" marker.
   * Skips when a poll raced us and already ingested the host-prefixed note id.
   */
  async recordAgentReply(params: {
    flowId: string;
    mrIid: number | null;
    discussionId: string;
    body: string;
    note: HostNote;
  }): Promise<void> {
    const existing = await db.prisma.comment.findUnique({ where: { id: params.note.id }, select: { id: true } });
    if (existing) return;
    // The upsert's no-op update branch carries the old ON CONFLICT DO NOTHING
    // semantics: an ingest that raced the read above keeps its row untouched.
    await db.prisma.comment.upsert({
      where: { id: params.note.id },
      create: {
        id: params.note.id,
        flowId: params.flowId,
        mrIid: params.mrIid,
        discussionId: params.discussionId,
        author: params.note.author,
        body: params.body,
        filePath: null,
        line: null,
        status: COMMENT_STATUS.RESOLVED,
        resolvedBy: RESOLVED_BY_AGENT,
        raw: null,
        createdAt: params.note.createdAt,
        updatedAt: new Date(),
      },
      update: {},
    });
  }

  // ── flows ────────────────────────────────────────────────────────────────

  /** Point the flow's merge-request branch at `branch`. */
  async setFlowBranch(flowId: string, branch: string): Promise<void> {
    await db.prisma.flow.update({ where: { id: flowId }, data: { mrBranch: branch } });
  }

  // ── feed events ──────────────────────────────────────────────────────────

  /** A flow-feed event of any type ("pipeline", "error", "log"); `tx` joins the
   *  caller's completion transaction (step 06, Invariant 7). Named lifecycle
   *  transitions go through `emitLifecycle`. */
  emit(flowId: string, nodeId: string | null, type: string, message: string, data?: Record<string, unknown>, tx?: QueryExecutor): Promise<void> {
    return db.emitEvent(flowId, nodeId, type, message, data, tx);
  }

  /** The lifecycle event: run transitions and state changes the UI trail is built from. */
  emitLifecycle(flowId: string, nodeId: string | null, message: string, data?: Record<string, unknown>, tx?: QueryExecutor): Promise<void> {
    return db.emitEvent(flowId, nodeId, EVENT_KIND.LIFECYCLE, message, data, tx);
  }
}
