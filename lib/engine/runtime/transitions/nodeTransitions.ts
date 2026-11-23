import "server-only";

import { db } from "../../../db/app";
import type { Database, QueryExecutor } from "../../../db/database";
import { ConflictError } from "../../../errors";
import { NODE_STATUS, type EngineNodeStatus } from "../../constants/nodeStatus";
import { NODE_LEASE_SECONDS } from "../../constants/leases";
import { NodeAttemptRegistry } from "../nodeAttemptRegistry";
import { ContractPipeline } from "../contractPipeline";
import { RUN_STATUS } from "../../constants/vocabulary";
import { isClaimKey, resolveToStatus, sqlMarks } from "./utils/transitionLookup";
import { supersededOrConflict } from "./utils/supersededOrConflict";
import { generateCapabilityToken } from "./utils/capabilityToken";
import { TRANSITION_TABLE } from "./constants/transitionTable";
import type { NodeOutcome, TransitionKey, TransitionRecord, TriggerClaim } from "./types/transitions";
import type { OutcomeContractSource } from "./types/contractSource";
import type { TransitionEvents } from "./transitionEvents";

/**
 * TransitionAuthority — the ONLY writer of `nodes.status` and `attempt_id`
 * (Invariant 1). Every write resolves a row in the declared transition table
 * first (`constants/transitionTable.ts`, target-architecture §2) and is a
 * single conditional `UPDATE … WHERE status IN (from-set)` — attempt-fenced
 * on every later write, the terminal carrying the validated `output` in the
 * same statement. The CAS UPDATEs are the sanctioned raw-SQL exception (the
 * orm-migration containment list: from-set + `NOT EXISTS` fencing has no
 * Prisma query-API equivalent) and sit on Task 12's lint allowlist.
 *
 * The `NodeSupport.claim`/`NodeStore.claim` duplicates collapsed into this
 * class; `NodeSupport` keeps only thin delegates over it plus its
 * artifact/run/message helpers.
 *
 * Must never: write a status outside a declared from→to pair, write
 * `attempt_id` outside `claim`, skip the in-memory transition log (the test
 * helper asserts every recorded entry is declared), or emit free-string event
 * kinds (announcements go through {@link TransitionEvents}).
 *
 * Construction: `lib/composition` (decision Q9) — one instance per module
 * graph, every part stateless or DB-fenced, so instances can never disagree.
 */
export class TransitionAuthority {
  private readonly log: TransitionRecord[] = [];
  /** The bound def resolver (step 04's contract seam) — composition binds it. */
  private defs: OutcomeContractSource | null = null;

  constructor(
    private readonly attempts: NodeAttemptRegistry,
    private readonly events: TransitionEvents,
    private readonly contracts?: ContractPipeline,
    private readonly database: Database = db,
  ) {}

  /**
   * Bind the def resolver the contract seam validates through (step 04):
   * called once by the FlowEngine at construction — the authority must not
   * know how defs hydrate. Unbound (pre-composition direct constructions),
   * the terminal writes skip contract validation.
   */
  bindOutcomeContracts(defs: OutcomeContractSource): void {
    this.defs = defs;
  }

  /** The applied-transition log (tests assert every entry is declared). */
  records(flowId?: string): readonly TransitionRecord[] {
    return flowId ? this.log.filter((r) => r.flowId === flowId) : this.log;
  }

  /** Drop the log (test isolation between flows). */
  clearRecords(): void {
    this.log.length = 0;
  }

  /**
   * Claim a node for a run (Invariant 7 — the attempt-fenced CAS: from-set
   * guard, attempt stamp and lease stamp in ONE conditional UPDATE, so a
   * loser can never half-claim): `running` guarded by the key's from-set,
   * stamping a fresh attempt token (marks the registry for reconcile).
   * Leaves `waiting` (wait_until cleared); stamps the durable lease
   * (`lease_until = now() + NODE_LEASE_SECONDS`, DB-server time — the
   * clock-skew rule). Throws {@link ConflictError} outside the from-set.
   */
  async claim(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
  ): Promise<{ attemptId: string; nodeId: string; apiToken: string }> {
    const row = TRANSITION_TABLE[key];
    const attemptId = this.database.uid("att_");
    // step 08: the attempt and its capability token are born together (Invariant 10).
    const apiToken = generateCapabilityToken();
    const claimed = (await this.database.prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE nodes SET status=$1, attempt_id=$2, wait_until=NULL,
         lease_until = now() + make_interval(secs => $3), updated_at=$4
       WHERE flow_id=$5 AND node_key=$6 AND status IN (${sqlMarks(row.from, 7)})
       RETURNING id`,
      NODE_STATUS.RUNNING, attemptId, NODE_LEASE_SECONDS, this.database.now(),
      flowId, nodeKey, ...row.from,
    ))[0];
    if (!claimed) {
      throw new ConflictError(`Node ${nodeKey} is not in ${row.from.join("/")}`);
    }
    this.attempts.mark(claimed.id, attemptId, apiToken);
    this.record(flowId, nodeKey, key, NODE_STATUS.RUNNING, attemptId);
    return { attemptId, nodeId: claimed.id, apiToken };
  }

  /**
   * The atomic trigger claim (Invariant 11 — claim or lose, never queue) with
   * the chain in-flight guard folded into the SAME conditional UPDATE: a
   * post-MR chain trigger loses atomically when a sibling stage runs; a lost
   * claim never throws — the holder's state returns so the TriggerGateway
   * emits the typed skip event.
   */
  async claimTrigger(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { chainKeys?: readonly string[] } = {},
  ): Promise<TriggerClaim> {
    const row = TRANSITION_TABLE[key];
    const chainKeys = opts.chainKeys ?? [];
    // guard excludes the target (itself a chain key); old chainBusy predicate: running siblings only
    const chainGuard = chainKeys.length
      ? ` AND NOT EXISTS (SELECT 1 FROM nodes c WHERE c.flow_id=$5 AND c.node_key <> $6
           AND c.status='${NODE_STATUS.RUNNING}' AND c.node_key IN (${chainKeys.map((_, i) => `$${7 + i}`).join(", ")}))`
      : "";
    const attemptId = this.database.uid("att_");
    const apiToken = generateCapabilityToken(); // step 08: paired capability token
    const claimed = (await this.database.prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE nodes SET status=$1, attempt_id=$2, wait_until=NULL,
         lease_until = now() + make_interval(secs => $3), updated_at=$4
       WHERE flow_id=$5 AND node_key=$6${chainGuard}
         AND status IN (${sqlMarks(row.from, 7 + chainKeys.length)})
       RETURNING id`,
      NODE_STATUS.RUNNING, attemptId, NODE_LEASE_SECONDS, this.database.now(),
      flowId, nodeKey, ...chainKeys, ...row.from,
    ))[0];
    if (!claimed) {
      const holder = await this.database.prisma.node.findFirst({ where: { flowId, nodeKey }, select: { status: true, attemptId: true } });
      return { claimed: false, status: holder?.status ?? null, holderAttemptId: holder?.attemptId ?? null };
    }
    this.attempts.mark(claimed.id, attemptId, apiToken);
    this.record(flowId, nodeKey, key, NODE_STATUS.RUNNING, attemptId);
    return { claimed: true, attemptId, nodeId: claimed.id, apiToken };
  }

  /**
   * Apply a keyed transition by (flow, nodeKey) (Invariant 7 — attempt-fenced
   * CAS: from-set guard + attempt clear in ONE conditional UPDATE): guarded
   * by the row's from-set, clearing `attempt_id` (never targets `running` —
   * claims do). Returns false when the from-set missed (fire-and-forget
   * callers tolerate the race; loud callers use {@link applyOrThrow}).
   */
  async apply(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<boolean> {
    const to = resolveToStatus(key, opts.toStatus);
    if (isClaimKey(key)) {
      throw new Error(`transition "${key}" targets running — claim it instead`);
    }
    const row = TRANSITION_TABLE[key];
    const patchEntries = Object.entries(opts.patch ?? {});
    // leaving a state releases its liveness/wait markers: a terminal (or any
    // non-claim) transition clears the node lease, and wait_until goes with
    // it unless the transition itself arms a new wait (armWait patches it)
    const clearsWaitUntil = !patchEntries.some(([column]) => column === "wait_until");
    const sets = `status=$1, attempt_id=NULL, lease_until=NULL, updated_at=$2`
      + (clearsWaitUntil ? `, wait_until=NULL` : "")
      + (patchEntries.length ? `, ${patchEntries.map((e, i) => `${e[0]}=$${i + 3}`).join(", ")}` : "");
    const params: unknown[] = [to, this.database.now(), ...patchEntries.map((e) => e[1]), flowId, nodeKey, ...row.from];
    const offset = 3 + patchEntries.length;
    const applied = (await this.database.prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE nodes SET ${sets}
       WHERE flow_id=$${offset} AND node_key=$${offset + 1} AND status IN (${sqlMarks(row.from, offset + 2)})
       RETURNING id`,
      ...params,
    ))[0];
    if (!applied) return false;
    this.attempts.clear(applied.id);
    const record = this.record(flowId, nodeKey, key, to);
    await this.events.announcedTransition(record, opts.detail);
    return true;
  }

  /** {@link apply} for callers whose contract says the from-set MUST hold. */
  async applyOrThrow(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string } = {},
  ): Promise<void> {
    const applied = await this.apply(flowId, nodeKey, key, opts);
    if (!applied) {
      const row = TRANSITION_TABLE[key];
      throw new ConflictError(`Node ${nodeKey} is not in ${row.from.join("/")}`);
    }
  }

  /**
   * Attempt-fenced transition by node id (Invariants 7/11 — fences on the
   * attempt token AND the from-set, so a superseded attempt never reverts a
   * newer one; a chat turn's revert to its pre-claim status, plan retry
   * reverts). Throws {@link RunSupersededError} when the attempt token no
   * longer matches, {@link ConflictError} when the status left the from-set.
   */
  async transitionFenced(params: {
    flowId: string;
    nodeKey: string;
    nodeId: string;
    attemptId: string;
    key: TransitionKey;
    toStatus?: EngineNodeStatus;
    patch?: Record<string, unknown>;
  }): Promise<void> {
    const to = resolveToStatus(params.key, params.toStatus);
    const row = TRANSITION_TABLE[params.key];
    const patchEntries = Object.entries(params.patch ?? {});
    const sets = `status=$1, attempt_id=NULL, lease_until=NULL, wait_until=NULL, updated_at=$2`
      + (patchEntries.length ? `, ${patchEntries.map((e, i) => `${e[0]}=$${i + 3}`).join(", ")}` : "");
    const values: unknown[] = [to, this.database.now(), ...patchEntries.map((e) => e[1])];
    const attemptIdx = values.length + 1;
    const idIdx = values.length + 2;
    values.push(params.attemptId, params.nodeId, ...row.from);
    const changes = await this.database.prisma.$executeRawUnsafe(
      `UPDATE nodes SET ${sets}
       WHERE id=$${idIdx} AND attempt_id=$${attemptIdx} AND status IN (${sqlMarks(row.from, idIdx + 1)})`,
      ...values,
    );
    if (changes !== 1) {
      await supersededOrConflict(this.database, params.nodeId, params.attemptId, row.from, params.nodeKey);
    }
    this.attempts.clear(params.nodeId);
    this.record(params.flowId, params.nodeKey, params.key, to);
  }

  /**
   * THE terminal door for a finished run (Invariants 7/11 — the terminal CAS:
   * status + validated output land in ONE attempt-fenced UPDATE inside the
   * caller's completion transaction): validate the outcome against the node's
   * declared output contract (step 04 — a violation throws
   * {@link OutputContractError}, mapped by the caller to a failed node +
   * typed event), then write status + output + agent cursor in ONE
   * conditional `UPDATE` — attempt-fenced when the run holds a token,
   * from-set fenced otherwise.
   */
  async publishOutcome(params: {
    flowId: string;
    nodeKey: string;
    nodeId: string;
    attemptId?: string | null;
    outcome: NodeOutcome;
    tx?: QueryExecutor;
  }): Promise<void> {
    const to = resolveToStatus("outcome", params.outcome.status);
    const row = TRANSITION_TABLE.outcome;
    if (this.contracts && this.defs) {
      const def = await this.defs.defOf(params.flowId, params.nodeKey);
      if (def) {
        this.contracts.validateTerminalOutput(def, to, params.outcome.output);
      }
    }
    const agentId = params.outcome.agentId ?? null;
    // the raw CAS runs on the caller's tx when one is open (Invariant 7 — the terminal write joins the completion transaction)
    const client = params.tx ?? this.database.prisma;
    const changes = await client.$executeRawUnsafe(
      `UPDATE nodes SET status=$1, attempt_id=NULL, lease_until=NULL, output=$2::jsonb, agent_id=$3, updated_at=$4
       WHERE id=$5${params.attemptId ? ` AND attempt_id=$6` : ""} AND status IN (${sqlMarks(row.from, params.attemptId ? 7 : 6)})`,
      ...([
        to,
        JSON.stringify(params.outcome.output),
        agentId,
        this.database.now(),
        params.nodeId,
        ...(params.attemptId ? [params.attemptId] : []),
        ...row.from,
      ] as unknown[]),
    );
    if (changes !== 1) {
      if (params.attemptId) {
        await supersededOrConflict(this.database, params.nodeId, params.attemptId, row.from, params.nodeKey);
      }
      throw new ConflictError(`Node ${params.nodeKey} is not in ${row.from.join("/")}`);
    }
    this.attempts.clear(params.nodeId);
    await this.clearRunTokens(params.nodeId, client);
    this.record(params.flowId, params.nodeKey, "outcome", to);
  }

  /**
   * Fail a node whose fire-and-forget run errored (`bg` catch / stage catch):
   * `running → failed` with the attempt cleared, silent when the node already
   * moved on — the caller's error event carries the failure detail.
   */
  async failFromRunning(flowId: string, nodeKey: string): Promise<void> {
    await this.apply(flowId, nodeKey, "stageError");
  }

  /** Step 08: the attempt's capability token dies with the terminal — same
   *  client/tx as the status write, so a crash can't leave a live token behind. */
  private async clearRunTokens(nodeId: string, client: QueryExecutor): Promise<void> {
    await client.run.updateMany({
      where: { nodeId, status: RUN_STATUS.RUNNING },
      data: { apiToken: null, updatedAt: this.database.now() },
    });
  }

  private record(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    to: EngineNodeStatus,
    attemptId?: string,
  ): TransitionRecord {
    const entry: TransitionRecord = {
      flowId,
      nodeKey,
      key,
      to,
      actor: TRANSITION_TABLE[key].actor,
      attemptId,
      at: Date.now(),
    };
    this.log.push(entry);
    return entry;
  }
}
