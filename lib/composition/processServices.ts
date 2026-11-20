import "server-only";

/**
 * Process-services container (decision Q9 close-out — step 09 task 7).
 *
 * Role: the ONE sanctioned home for genuinely process-bound services —
 * in-memory state (run handles, mutex maps) whose loss or per-module-graph
 * divergence would break correctness. Everything else is stateless or
 * DB-fenced and is a plain module const (see `lib/composition/container.ts`);
 * the DB client keeps its own inline pin (`lib/db/prismaClient.ts`).
 *
 * Instances self-register through {@link pinnedProcessService} from their
 * defining module, so the public export surface (and import graph) is
 * unchanged — the container owns the pinning pattern, not the wiring (a
 * central construction here would cycle with the very modules it constructs).
 *
 * Invariants:
 * - Pinning is the `globalThis` trick implemented inline by the container:
 *   `Symbol.for("devflow.processService.<key>")`, one instance per process
 *   regardless of how many module graphs import the service. The arch test
 *   `tests/architecture/noProcessSingletonOutsideDb.test.ts` enforces that
 *   no service outside the DB client pins process state — do not reintroduce
 *   other pinning patterns.
 * - Only services with correctness-relevant in-memory state may register.
 *
 * Must-never: never store DB truth here (Invariant 2 — all truth lives in
 * Postgres); never register a stateless service (per-graph copies of those
 * cannot disagree — pinning them adds nothing and hides a classification
 * error).
 */

const PROCESS_SERVICE_PREFIX = "devflow.processService.";

const globalSlots = globalThis as Record<PropertyKey, unknown>;

/**
 * Pin a process-bound service on `globalThis`: one instance per process,
 * shared by every module graph that imports the defining module.
 */
export const pinnedProcessService = <T>(key: string, create: () => T): T => {
  const sym = Symbol.for(`${PROCESS_SERVICE_PREFIX}${key}`);
  if (globalSlots[sym] == null) globalSlots[sym] = create();
  return globalSlots[sym] as T;
};
