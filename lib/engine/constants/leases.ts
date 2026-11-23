import "server-only";

/**
 * Durable lease budget (engine overhaul step 03, Invariant 2): liveness of a
 * `running` node is `lease_until > now()` on the node row — the
 * `updated_at`-as-heartbeat trick is dead.
 *
 * A claim stamps `nodes.lease_until = now() + NODE_LEASE_SECONDS` (the
 * transition authority does it in the claim UPDATE, on DB-server time). Every
 * loop that owns a running node — the agent stream heartbeat, the pipeline
 * gate's wait loop, the worktree-ensure path — re-extends the lease at least
 * every {@link NODE_LEASE_HEARTBEAT_MS}, so the budget tolerates several
 * missed heartbeats before the reconciler may recover the node. Liveness is
 * always lease + persisted run state — never in-process handles.
 */
export const NODE_LEASE_SECONDS = 180;

/** How often an owning loop re-extends `nodes.lease_until` / `runs.lease_until`. */
export const NODE_LEASE_HEARTBEAT_MS = 20_000;

/**
 * Run rows carry their own lease: `registerStartupRun`/`persistRun` stamp
 * `runs.lease_until` next to the attempt token, and the agent stream loop
 * heartbeats it. The reconciler treats a current run lease like a current
 * node lease (leave alone) — liveness is lease + persisted agent state,
 * never in-process handles (step 03, decision Q9/Q10).
 */
export const RUN_LEASE_SECONDS = 180;
