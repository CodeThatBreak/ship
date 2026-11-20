import "server-only";

import { db } from "../../../db/app";
import type { Database } from "../../../db/database";
import { ConflictError } from "../../../errors";
import { NODE_STATUS, type EngineNodeStatus } from "../../constants/nodeStatus";
import { NODE_LEASE_SECONDS } from "../../constants/leases";
import { RunSupersededError } from "../../errors/runSupersededError";
import { NodeAttemptRegistry } from "../nodeAttemptRegistry";
import { ContractPipeline } from "../contractPipeline";
import { OutputContractError } from "../../errors/outputContractError";
import { EVENT_KIND } from "../../constants/vocabulary";
import { isClaimKey, resolveToStatus, sqlMarks } from "./utils/transitionLookup";
import { TRANSITION_TABLE } from "./constants/transitionTable";
import type {
  NodeOutcome,
  TransitionKey,
  TransitionRecord,
  TriggerClaim,
} from "./types/transitions";
import type { OutcomeContractSource } from "./types/contractSource";
import type { TransitionEvents } from "./transitionEvents";

/**
 * TransitionAuthority — the ONLY writer of `nodes.status` and `attempt_id`
 * (Invariant 1). Every write resolves a row in the declared transition table
 * first (`constants/transitionTable.ts`, target-architecture §2) and is a
 * single conditional `UPDATE … WHERE status IN (from-set)` — attempt-fenced
 * on every later write, with the terminal write carrying the validated
 * `output` in the same statement.
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
   * Claim a node for a run: conditional `UPDATE` to `running` guarded by the
   * key's from-set, stamping a fresh attempt token. Marks the attempt
   * registry so reconcile can distinguish this process's in-flight runs.
   * Leaves `waiting` (wait_until cleared) and stamps the durable node lease
   * (`lease_until = now() + NODE_LEASE_SECONDS`, DB-server time — the
   * clock-skew rule: never compare a lease against app-server time).
   * Throws {@link ConflictError} when the node is not in the from-set.
   */
  async claim(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
  ): Promise<{ attemptId: string; nodeId: string }> {
    const row = TRANSITION_TABLE[key];
    const attemptId = this.database.uid("att_");
    const claimed = await this.database.get<{ id: string }>(
      `UPDATE nodes SET status=$1, attempt_id=$2, wait_until=NULL,
         lease_until = now() + make_interval(secs => $3), updated_at=$4
       WHERE flow_id=$5 AND node_key=$6 AND status IN (${sqlMarks(row.from, 7)})
       RETURNING id`,
      NODE_STATUS.RUNNING,
      attemptId,
      NODE_LEASE_SECONDS,
      this.database.now(),
      flowId,
      nodeKey,
      ...row.from,
    );
    if (!claimed) {
      throw new ConflictError(`Node ${nodeKey} is not in ${row.from.join("/")}`);
    }
    this.attempts.mark(claimed.id, attemptId);
    this.record(flowId, nodeKey, key, NODE_STATUS.RUNNING, attemptId);
    return { attemptId, nodeId: claimed.id };
  }

  /**
   * The atomic trigger claim with the chain in-flight guard folded into the SAME
   * conditional UPDATE (step 06, Invariant 11): a post-MR chain trigger loses
   * atomically when a sibling stage runs; a lost claim never throws — the
   * holder's state returns so the TriggerGateway emits the typed skip event.
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
    const claimed = await this.database.get<{ id: string }>(
      `UPDATE nodes SET status=$1, attempt_id=$2, wait_until=NULL,
         lease_until = now() + make_interval(secs => $3), updated_at=$4
       WHERE flow_id=$5 AND node_key=$6${chainGuard}
         AND status IN (${sqlMarks(row.from, 7 + chainKeys.length)})
       RETURNING id`,
      NODE_STATUS.RUNNING, attemptId, NODE_LEASE_SECONDS, this.database.now(),
      flowId, nodeKey, ...chainKeys, ...row.from,
    );
    if (!claimed) {
      const holder = await this.database.get<{ status: string; attemptId: string | null }>(
        `SELECT status, attempt_id AS "attemptId" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
      return { claimed: false, status: holder?.status ?? null, holderAttemptId: holder?.attemptId ?? null };
    }
    this.attempts.mark(claimed.id, attemptId);
    this.record(flowId, nodeKey, key, NODE_STATUS.RUNNING, attemptId);
    return { claimed: true, attemptId, nodeId: claimed.id };
  }

  /**
   * Apply a keyed transition by (flow, nodeKey): conditional `UPDATE` guarded
   * by the row's from-set, clearing `attempt_id` (this never targets
   * `running` — claims do). Returns false when the from-set missed (fire-
   * and-forget callers tolerate the race; loud callers use
   * {@link applyOrThrow}).
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
    const applied = await this.database.get<{ id: string }>(
      `UPDATE nodes SET ${sets}
       WHERE flow_id=$${offset} AND node_key=$${offset + 1} AND status IN (${sqlMarks(row.from, offset + 2)})
       RETURNING id`,
      ...params,
    );
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
   * Apply a transition to every node of a flow in the row's from-set (the
   * split runtime's bulk unit skip). One statement; returns the affected node
   * keys for the caller's trail. Never announces per node (the feed never
   * showed the bulk skip).
   */
  async applyFlowScope(flowId: string, key: TransitionKey): Promise<string[]> {
    const to = resolveToStatus(key);
    if (isClaimKey(key)) {
      throw new Error(`transition "${key}" targets running — claim it instead`);
    }
    const row = TRANSITION_TABLE[key];
    const affected = await this.database.all<{ id: string; node_key: string }>(
      `UPDATE nodes SET status=$1, attempt_id=NULL, lease_until=NULL, wait_until=NULL, updated_at=$2
       WHERE flow_id=$3 AND status IN (${sqlMarks(row.from, 4)})
       RETURNING id, node_key AS "node_key"`,
      to,
      this.database.now(),
      flowId,
      ...row.from,
    );
    for (const n of affected) {
      this.attempts.clear(n.id);
      this.record(flowId, n.node_key, key, to);
    }
    return affected.map((n) => n.node_key);
  }

  /**
   * Attempt-fenced transition by node id (a chat turn's revert to its
   * pre-claim status, plan retry reverts). Throws {@link RunSupersededError}
   * when the attempt token no longer matches, {@link ConflictError} when the
   * status left the from-set.
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
    const changes = await this.database.run(
      `UPDATE nodes SET ${sets}
       WHERE id=$${idIdx} AND attempt_id=$${attemptIdx} AND status IN (${sqlMarks(row.from, idIdx + 1)})`,
      ...values,
    );
    if (changes !== 1) {
      await this.supersededOrConflict(params.nodeId, params.attemptId, row.from, params.nodeKey);
    }
    this.attempts.clear(params.nodeId);
    this.record(params.flowId, params.nodeKey, params.key, to);
  }

  /**
   * THE terminal door for a finished run (the defs' `applyOutcome` write):
   * validate the outcome against the node's declared output contract (step
   * 04 — nothing is published unvalidated; a violation throws
   * {@link OutputContractError} and the caller maps it to a failed node +
   * typed event), then write status + validated output + agent cursor in ONE
   * conditional `UPDATE` — fenced by the attempt token when the run holds one
   * (a superseded run throws {@link RunSupersededError}), from-set fenced
   * otherwise.
   */
  async publishOutcome(params: {
    flowId: string;
    nodeKey: string;
    nodeId: string;
    attemptId?: string | null;
    outcome: NodeOutcome;
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
    const changes = await this.database.run(
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
        await this.supersededOrConflict(params.nodeId, params.attemptId, row.from, params.nodeKey);
      }
      throw new ConflictError(`Node ${params.nodeKey} is not in ${row.from.join("/")}`);
    }
    this.attempts.clear(params.nodeId);
    this.record(params.flowId, params.nodeKey, "outcome", to);
  }

  /**
   * Publish a fan-out/split aggregate terminal by (flow, nodeKey).
   *
   * Fence semantics (CR-009 + the finishSplit overwrite bug, both fixed):
   *  - a bare caller (no captured attempt) may only publish a `running`
   *    consumer — one aggregate per run; a published terminal is final;
   *  - the runtime managers (split join / fan-out rollup) pass the attempt
   *    token captured at expand: a `running` row must match it (a user's
   *    re-claim refuses the stale aggregate), while the aggregate's own
   *    held/failed states (attempt cleared by its own earlier publish)
   *    republish — the per-unit approve/retry actions depend on that.
   */
  async publishAggregate(
    flowId: string,
    nodeKey: string,
    key: "fanoutOutcome" | "splitOutcome",
    outcome: { status: EngineNodeStatus; output: Record<string, unknown>; detail?: string; attemptId?: string | null },
  ): Promise<boolean> {
    const to = resolveToStatus(key, outcome.status);
    const row = TRANSITION_TABLE[key];
    // step 04: the seam closes the aggregates too — an aggregate that misses
    // its def's declared aggregate contract (capabilities fanout/splitOutput,
    // the generic defaults otherwise) is never written: the refusal maps to
    // the typed `output_contract_violation` event + the failed terminal right
    // here (the authority owns status writes), and the caller sees `false` —
    // it does not advance the flow on unvalidated data.
    if (this.contracts && this.defs) {
      const def = await this.defs.defOf(flowId, nodeKey);
      if (def) {
        try {
          this.contracts.validateAggregateOutput(key, def, outcome.output);
        } catch (e: unknown) {
          if (!(e instanceof OutputContractError)) throw e;
          await this.failContractViolation(flowId, nodeKey, e.issues);
          return false;
        }
      }
    }
    const fence = outcome.attemptId != null;
    const attemptGuard = fence
      ? ` AND (status <> '${NODE_STATUS.RUNNING}' OR attempt_id IS NULL OR attempt_id = $6)`
      : ` AND status = '${NODE_STATUS.RUNNING}'`;
    const params: unknown[] = [
      to,
      JSON.stringify(outcome.output),
      this.database.now(),
      flowId,
      nodeKey,
      ...(fence ? [outcome.attemptId] : []),
      ...row.from,
    ];
    const applied = await this.database.get<{ id: string }>(
      `UPDATE nodes SET status=$1, attempt_id=NULL, lease_until=NULL, output=$2::jsonb, updated_at=$3
       WHERE flow_id=$4 AND node_key=$5${attemptGuard} AND status IN (${sqlMarks(row.from, fence ? 7 : 6)})
       RETURNING id`,
      ...params,
    );
    if (!applied) return false;
    this.attempts.clear(applied.id);
    const record = this.record(flowId, nodeKey, key, to);
    await this.events.announcedTransition(record, outcome.detail);
    return true;
  }

  /**
   * Fail a node whose fire-and-forget run errored (`bg` catch / stage catch):
   * `running → failed` with the attempt cleared, silent when the node already
   * moved on — the caller's error event carries the failure detail.
   */
  async failFromRunning(flowId: string, nodeKey: string): Promise<void> {
    await this.apply(flowId, nodeKey, "stageError");
  }

  /**
   * The typed terminal for an aggregate that violated its contract (step 04 —
   * the old swallow-and-publish escape): a typed
   * `output_contract_violation` event carrying the per-path violations, then
   * the failed terminal (no output publish, no advance — the downstream never
   * consumes unvalidated data). Retriable like any other failed node.
   */
  private async failContractViolation(flowId: string, nodeKey: string, issues: readonly string[]): Promise<void> {
    const message = `${nodeKey}: output contract violation — ${issues[0] ?? "the output did not satisfy its schema"}`;
    await this.events.emit(flowId, nodeKey, EVENT_KIND.OUTPUT_CONTRACT_VIOLATION, message, {
      nodeKey,
      issues: [...issues],
    });
    await this.failFromRunning(flowId, nodeKey);
  }

  /**
   * Distinguish a superseded attempt from an undeclared from-state after a
   * fenced write missed: the attempt token decides which error to throw.
   */
  private async supersededOrConflict(
    nodeId: string,
    attemptId: string,
    from: readonly EngineNodeStatus[],
    nodeKey: string,
  ): Promise<never> {
    const node = await this.database.get<{ attemptId: string | null; status: string }>(
      `SELECT attempt_id AS "attemptId", status FROM nodes WHERE id=$1`,
      nodeId,
    );
    if (!node || node.attemptId !== attemptId) {
      throw new RunSupersededError(nodeId, node?.status ?? "unknown", attemptId);
    }
    throw new ConflictError(`Node ${nodeKey} is not in ${from.join("/")}`);
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
