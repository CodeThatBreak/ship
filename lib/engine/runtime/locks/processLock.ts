import "server-only";

import pg from "pg";
import { config } from "../../../config";
import { PROCESS_LOCK_KEY } from "./constants/processLockKey";

/**
 * ProcessLock — the Postgres advisory lock that makes "keep one server
 * running" code instead of a runbook line (step 03, Invariants 2 + 7). The
 * poller, reconciler and job sweeps refuse to run unless THIS process holds
 * the lock; a second worker (duplicate deploy, dev accident) simply does not
 * acquire and idles.
 *
 * The lock lives on ONE dedicated `pg` connection, not Prisma's pool: an
 * advisory lock is session-scoped, and a pooled connection can be closed or
 * reused by unrelated queries at any time — the pool cannot be trusted to
 * keep holding it. The dedicated client stays connected for the process's
 * lifetime (released on shutdown); if it dies, Postgres drops the lock and
 * another worker may take over.
 *
 * Must never: run time-driven engine work without holding the lock, hold the
 * lock on a pooled/shared connection, or block on `pg_advisory_lock` (the
 * try-variant fails fast — a non-holder logs once and idles).
 */
export class ProcessLock {
  private client: pg.Client | null = null;
  private heldSince: Date | null = null;

  /** Whether THIS process holds the writer lock. */
  get held(): boolean {
    return this.client !== null;
  }

  /** When this process acquired the lock (null when not held). */
  get since(): Date | null {
    return this.heldSince;
  }

  /**
   * Try to acquire the writer lock. Returns false when another process
   * holds it — the caller idles (or retries later); never throws for a
   * taken lock.
   */
  async acquire(): Promise<boolean> {
    if (this.held) return true;
    const client = new pg.Client({ connectionString: config.db.url() });
    try {
      await client.connect();
      const res = await client.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [PROCESS_LOCK_KEY],
      );
      if (!res.rows[0]?.ok) {
        await client.end();
        return false;
      }
      this.client = client;
      this.heldSince = new Date();
      return true;
    } catch (e: unknown) {
      try {
        await client.end();
      } catch {
        // connection already gone — the acquire error is the real failure
      }
      throw e;
    }
  }

  /** Release the lock and close the dedicated connection (shutdown path). */
  async release(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.heldSince = null;
    if (!client) return;
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [PROCESS_LOCK_KEY]);
    } finally {
      await client.end();
    }
  }
}
