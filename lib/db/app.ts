import "server-only";

import { processSingleton } from "../singleton";
import { prisma } from "./prismaClient";
import { Database } from "./database";

export type { Repo } from "./rows";
export { Database, DatabaseMigrationError } from "./database";
export { RowGateway } from "./rows";
export { getDb } from "./dbAccess";
export { getRowGateway } from "./rowGatewayAccess";

/**
 * Shared application database facade over the Prisma singleton. The web
 * process is pure request/response (decision Q10): time-driven work (the
 * poller, reconciler, job sweeps) lives in the dedicated worker process
 * (`npm run worker`, `worker/main.ts`) — importing `db` starts nothing.
 */
export const db = processSingleton("db", () => new Database(prisma));
