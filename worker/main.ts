/**
 * The DevFlow worker process — the home of ALL time-driven engine work
 * (engine overhaul step 03; decisions Q9/Q10). The web process is pure
 * request/response (user actions claim synchronously in-request through the
 * same DB-fenced paths); this process owns:
 *
 *  - the FlowPoller tick — durable wait fires (`nodes.wait_until`), the
 *    template-schedule sweep, the job sweep (webhook deliveries, schedule
 *    fires), and per-MR pipeline/comment polling
 *  - the Reconciler v2 pass over every active flow
 *  - the ProcessLock (a Postgres advisory lock on a dedicated connection)
 *    that makes single-writer code instead of a runbook line
 *
 * Run it alongside the web process: `npm run worker` (two terminals in dev —
 * see README). Idempotent: a second worker fails to acquire the lock, logs
 * once, and idles — retrying periodically, so a dead holder is replaced.
 * Liveness and writer state are visible at the web process's `/api/health`.
 */
// `.env` must be loaded before anything reads the environment. ESM evaluates
// all imports before this module's body, so the load has to be an import
// itself — `worker/loadEnv.ts` — placed ahead of every env-reading import
// (a bare `loadEnvConfig(...)` call here would run too late).
import "./loadEnv";

import { config } from "@/lib/config";
import { prisma } from "@/lib/db/prismaClient";
import { ProcessLock } from "@/lib/engine/runtime/locks/processLock";
import { FlowPoller } from "@/lib/engine/runtime/flowPoller";

/** How often an idled worker retries acquisition (dead-holder failover). */
const LOCK_RETRY_MS = 60_000;

/** The poller tick — same cadence the old in-web poller ran at. */
const TICK_MS = 30_000;

const lock = new ProcessLock();
let poller: FlowPoller | null = null;
let shuttingDown = false;

const startPolling = (): void => {
  if (poller) return;
  poller = new FlowPoller(lock);
  poller.start(TICK_MS);
};

const tryAcquire = async (): Promise<void> => {
  if (lock.held) return;
  try {
    if (await lock.acquire()) {
      console.log("[devflow-worker] writer lock acquired — poller/reconciler/job sweeps running");
      startPolling();
    } else {
      console.warn(
        "[devflow-worker] another process holds the writer lock — idling " +
          `(retrying in ${LOCK_RETRY_MS / 1000}s; see /api/health)`,
      );
    }
  } catch (e: unknown) {
    console.error(`[devflow-worker] lock acquisition failed: ${e instanceof Error ? e.message : e}`);
  }
};

const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[devflow-worker] shutting down — releasing the writer lock");
  // the poller's lock gate makes further ticks no-ops; release + disconnect
  await lock.release().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

const main = async (): Promise<void> => {
  config.gitlab.logStartupWarnings();
  await tryAcquire();
  // an idled worker retries acquisition periodically — a dead holder is
  // replaced without operator action (and this interval keeps the process alive)
  setInterval(() => void tryAcquire(), LOCK_RETRY_MS);
};

void main();
