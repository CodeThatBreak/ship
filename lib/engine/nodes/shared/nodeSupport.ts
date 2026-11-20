import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import type { QueryExecutor } from "../../../db/database";
import { CommentRow, NodeRow, rows } from "../../../db/rows";
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
import { executorFor } from "../../runtime/transitions/utils/executor";

const NODE_SELECT = `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status,
       attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef",
       session_id AS "sessionId", label, config,
       join_mode AS "joinMode", input, output, created_at AS "createdAt",
       updated_at AS "updatedAt" FROM nodes`;
const COMMENT_SELECT = `SELECT id, flow_id AS "flowId", mr_iid AS "mrIid",
       discussion_id AS "discussionId", author, body, file_path AS "filePath", line,
       status, resolved_by AS "resolvedBy", raw, created_at AS "createdAt",
       updated_at AS "updatedAt" FROM comments`;

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

  async nodeByKey(flowId: string, key: string): Promise<NodeRow> {
    const n = await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND node_key=$2`, flowId, key);
    if (!n) throw new Error(`node ${key} not found for flow ${flowId}`);
    return n;
  }

  /** Like nodeByKey but null when the instance key is absent (optional chain stages). */
  async optionalNodeByKey(flowId: string, key: string): Promise<NodeRow | null> {
    return (await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND node_key=$2`, flowId, key)) ?? null;
  }

  /** First node row of a given built-in node type (instance keys may differ
   *  from the type; callers that address by node_key use `nodeByKey`). */
  async nodeByType(flowId: string, type: string): Promise<NodeRow | null> {
    return (await rows.get(NodeRow, `${NODE_SELECT} WHERE flow_id=$1 AND type=$2`, flowId, type)) ?? null;
  }

  /** A node's current status (null when the row is gone) — polling callers
   * use this to detect an external cancel/retry mid-wait. */
  async nodeStatus(nodeId: string): Promise<string | null> {
    return (await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status ?? null;
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
    await db.run(
      `UPDATE nodes SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`,
      ...keys.map((k) => patch[k] as never),
      db.now(),
      id
    );
  }

  /**
   * Heartbeat a running stage's durable leases (step 03, Invariant 2):
   * extend `nodes.lease_until` (and `runs.lease_until` while a run row
   * exists — `runRef` null when it does not yet). Every loop that owns a
   * running node calls this at least every NODE_LEASE_HEARTBEAT_MS; the
   * reconciler's liveness test is `lease_until > now()`.
   */
  async heartbeatLeases(nodeId: string, runRef: string | null): Promise<void> {
    await db.run(`UPDATE nodes SET lease_until = now() + make_interval(secs => $1) WHERE id=$2`,
      NODE_LEASE_SECONDS, nodeId);
    if (runRef) {
      await db.run(`UPDATE runs SET lease_until = now() + make_interval(secs => $1) WHERE run_ref=$2`,
        RUN_LEASE_SECONDS, runRef);
    }
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
      const exec = executorFor(db, t);
      const version = ((await exec.get<{ v: number | null }>(`SELECT MAX(version) AS v FROM artifacts WHERE node_id=$1 AND kind=$2`, nodeId, kind))?.v ?? 0) + 1;
      await exec.run(`UPDATE artifacts SET status=$1 WHERE node_id=$2 AND kind=$3 AND status=$4`, ARTIFACT_STATUS.SUPERSEDED, nodeId, kind, ARTIFACT_STATUS.DRAFT);
      const id = db.uid("art_");
      await exec.run(`INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        id, nodeId, flowId, kind, version, content, meta ? JSON.stringify(meta) : null, status, db.now());
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
    const existing = await db.get<{ agentRef: string; runRef: string }>(
      `SELECT agent_ref AS "agentRef", run_ref AS "runRef" FROM runs
       WHERE node_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1`,
      nodeId, RUN_STATUS.RUNNING);
    if (existing?.agentRef === RUN_AGENT_REF.PENDING && existing.runRef === attemptId) {
      return;
    }
    // close-prior-runs UPDATE + placeholder INSERT in ONE tx (step 06, Invariant 7)
    await this.transaction(async (t) => {
      const exec = executorFor(db, t);
      await exec.run(`UPDATE runs SET status=$1, lease_until=NULL, updated_at=$2 WHERE node_id=$3 AND status=$4`,
        RUN_STATUS.ERROR, db.now(), nodeId, RUN_STATUS.RUNNING);
      const id = db.uid("run_");
      // api_token (step 08): the claim-minted capability token rides the startup row.
      await exec.run(`INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,attempt_id,api_token,lease_until,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8),$9,$10,$11)`,
        id, flowId, nodeId, RUN_AGENT_REF.PENDING, attemptId, attemptId, apiToken ?? null, RUN_LEASE_SECONDS, RUN_STATUS.RUNNING, db.now(), db.now());
    });
  }

  isStartupRun(agentRef: string): boolean {
    return agentRef === RUN_AGENT_REF.PENDING;
  }

  async persistRun(flowId: string, nodeId: string, agentId: string, runId: string, apiToken?: string | null): Promise<string> {
    const attemptId = (await db.get<{ attemptId: string | null }>(
      `SELECT attempt_id AS "attemptId" FROM nodes WHERE id=$1`, nodeId))?.attemptId;
    if (attemptId) {
      const changes = await db.run(
        `UPDATE runs SET agent_ref=$1, run_ref=$2, attempt_id=$3,
            lease_until = now() + make_interval(secs => $4), updated_at=$5
         WHERE node_id=$6 AND status=$7 AND agent_ref=$8 AND run_ref=$9`,
        agentId,
        runId,
        attemptId,
        RUN_LEASE_SECONDS,
        db.now(),
        nodeId,
        RUN_STATUS.RUNNING,
        RUN_AGENT_REF.PENDING,
        attemptId,
      );
      if (changes === 1) {
        const upgraded = await db.get<{ id: string }>(`SELECT id FROM runs WHERE run_ref=$1`, runId);
        if (upgraded) {
          await db.run(
            `UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4 AND run_ref<>$5`,
            RUN_STATUS.ERROR,
            db.now(),
            nodeId,
            RUN_STATUS.RUNNING,
            runId,
          );
          return upgraded.id;
        }
      }
    }
    // close out any prior `running` rows for this node — they're stale (their
    // process died with a previous server/run) and would otherwise be picked up
    // as the "latest running run" by reconcile; close + insert in ONE tx (step 06, Invariant 7)
    return this.transaction(async (t) => {
      const exec = executorFor(db, t);
      await exec.run(`UPDATE runs SET status=$1, updated_at=$2 WHERE node_id=$3 AND status=$4`, RUN_STATUS.ERROR, db.now(), nodeId, RUN_STATUS.RUNNING);
      const id = db.uid("run_");
      await exec.run(
        `INSERT INTO runs (id,flow_id,node_id,agent_ref,run_ref,attempt_id,api_token,lease_until,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8),$9,$10,$11)`,
        id, flowId, nodeId, agentId, runId, attemptId, apiToken ?? null, RUN_LEASE_SECONDS, RUN_STATUS.RUNNING, db.now(), db.now());
      return id;
    });
  }

  async lastAgentId(nodeId: string, tx?: QueryExecutor): Promise<string | null> {
    return (await executorFor(db, tx).get<{ agentRef: string }>(
      `SELECT agent_ref AS "agentRef" FROM runs WHERE node_id=$1 AND agent_ref<>$2 ORDER BY created_at DESC LIMIT 1`,
      nodeId, RUN_AGENT_REF.PENDING))?.agentRef ?? null;
  }

  /** Update the run row with the real agent/session id once known (local mode). */
  async setRunAgentId(runId: string, agentId: string): Promise<void> {
    await db.run(`UPDATE runs SET agent_ref=$1, updated_at=$2 WHERE run_ref=$3`, agentId, db.now(), runId);
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
    const type = opts.nodeType;
    const scope = type ? ` AND n.type=$3` : "";
    const cap = opts.limit ? ` LIMIT ${Math.trunc(opts.limit)}` : "";
    const sql = `SELECT a.id, a.version, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=$1 AND a.kind=$2${scope}
       ORDER BY a.version DESC, a.created_at DESC${cap}`;
    return type ? await db.all(sql, flowId, kind, type) : await db.all(sql, flowId, kind);
  }

  // ── branches ─────────────────────────────────────────────────────────────

  /** A branch row's MR iid (null when the branch has no merge request yet). */
  async branchMrIid(flowId: string, name: string): Promise<number | null> {
    return (await db.get<{ mrIid: number | null }>(
      `SELECT mr_iid AS "mrIid" FROM branches WHERE flow_id=$1 AND name=$2`, flowId, name))?.mrIid ?? null;
  }

  // ── comments ─────────────────────────────────────────────────────────────

  /**
   * A flow's open MR comments (validated by the shared row mapper), in
   * deterministic order (G12) — the resolve prompt's comment list and the
   * contract's decision coverage are built from this ordering.
   */
  async openComments(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    if (mrIid != null) {
      return rows.all(
        CommentRow,
        `${COMMENT_SELECT} WHERE flow_id=$1 AND status=$2 AND mr_iid=$3 ORDER BY created_at ASC, id ASC`,
        flowId,
        COMMENT_STATUS.OPEN,
        mrIid,
      );
    }
    return rows.all(
      CommentRow,
      `${COMMENT_SELECT} WHERE flow_id=$1 AND status=$2 ORDER BY created_at ASC, id ASC`,
      flowId,
      COMMENT_STATUS.OPEN,
    );
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
    const marks = ids.map((_, i) => `$${i + 4}`).join(",");
    await db.run(
      `UPDATE comments SET status=$1, resolved_by=$2, updated_at=$3 WHERE id IN (${marks})`,
      COMMENT_STATUS.RESOLVED,
      RESOLVED_BY_AGENT,
      db.now(),
      ...ids,
    );
  }

  /**
   * The MR's agent-authored comment rows (`resolved_by='agent'`) — the resolve
   * prompt's "already replied — awaiting reviewer" markers (G11): an open row
   * in the same discussion means the agent answered it last cycle and the
   * reviewer hasn't responded yet. Deterministic order for the prompt.
   */
  async agentReplies(flowId: string, mrIid?: number | null): Promise<CommentRow[]> {
    if (mrIid != null) {
      return rows.all(
        CommentRow,
        `${COMMENT_SELECT} WHERE flow_id=$1 AND mr_iid=$2 AND resolved_by=$3 ORDER BY created_at ASC, id ASC`,
        flowId,
        mrIid,
        RESOLVED_BY_AGENT,
      );
    }
    return rows.all(
      CommentRow,
      `${COMMENT_SELECT} WHERE flow_id=$1 AND resolved_by=$2 ORDER BY created_at ASC, id ASC`,
      flowId,
      RESOLVED_BY_AGENT,
    );
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
    const existing = await db.get<{ id: string }>(`SELECT id FROM comments WHERE id=$1`, params.note.id);
    if (existing) return;
    await db.run(
      `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,resolved_by,raw,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      params.note.id,
      params.flowId,
      params.mrIid,
      params.discussionId,
      params.note.author,
      params.body,
      null,
      null,
      COMMENT_STATUS.RESOLVED,
      RESOLVED_BY_AGENT,
      null,
      params.note.createdAt,
      db.now(),
    );
  }

  // ── flows ────────────────────────────────────────────────────────────────

  /** Point the flow's merge-request branch at `branch`. */
  async setFlowBranch(flowId: string, branch: string): Promise<void> {
    await db.run(`UPDATE flows SET mr_branch=$1 WHERE id=$2`, branch, flowId);
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
