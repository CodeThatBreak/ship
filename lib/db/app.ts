import "server-only";

import { processSingleton } from "../singleton";
import { prisma } from "./prismaClient";
import { Database } from "./database";

export type { Repo } from "./rows";
export { Database, DatabaseMigrationError } from "./database";
export { RowGateway } from "./rows";
export { getDb } from "./dbAccess";
export { getRowGateway } from "./rowGatewayAccess";

const ensureBackgroundWorkers = (): void => {
  processSingleton("background-workers", () => {
    void import("../engine/runtime/flowPoller").then(({ flowPoller }) => {
      void flowPoller.start();
    });
    return true;
  });
};

const shouldStartBackgroundWorkers = (): boolean =>
  process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";

/**
 * Shared application database facade over the Prisma singleton. (The lazy
 * background-workers side effect dies with `instrumentation.ts` in the step
 * that lands the worker process — decision Q10.)
 */
export const db = processSingleton("db", () => {
  if (shouldStartBackgroundWorkers()) {
    ensureBackgroundWorkers();
  }
  return new Database(prisma);
});
