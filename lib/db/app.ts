import "server-only";

import { prisma } from "./prismaClient";
import { Database } from "./database";

export type { Repo } from "./rows";
export { Database, DatabaseMigrationError } from "./database";
export { getDb } from "./dbAccess";

/**
 * Shared application database facade over the Prisma singleton. Plain module
 * const (decision Q9 — no process pinning): `Database` is a stateless facade
 * over the Prisma pool, so two module-graph copies cannot disagree. The web
 * process is pure request/response (decision Q10): time-driven work (the
 * poller, reconciler, job sweeps) lives in the dedicated worker process
 * (`npm run worker`, `worker/main.ts`) — importing `db` starts nothing.
 */
export const db = new Database(prisma);
