import "server-only";

import type { Database } from "./database";

/**
 * Lazy resolution slot so modules that must not import `lib/db/app` (the
 * integration singletons' lazy proxies, `lib/engine/templates/nodeConfig.ts`)
 * can reach the shared `Database` without forcing its construction or
 * creating an import cycle. {@link bindDatabase} is called from the
 * `Database` constructor; the instance itself is a plain module const in
 * `lib/db/app.ts` (decision Q9 — no process pinning needed, the facade is
 * stateless).
 */
const DATABASE_SLOT = Symbol.for("devflow.database");

const store = (): Record<PropertyKey, unknown> =>
  globalThis as Record<PropertyKey, unknown>;

/** Called from {@link Database}'s constructor so config helpers can resolve the singleton without importing `lib/db/index`. */
export const bindDatabase = (instance: Database): void => {
  store()[DATABASE_SLOT] = instance;
};

export const getDb = (): Database => {
  const database = store()[DATABASE_SLOT] as Database | undefined;
  if (!database) {
    throw new Error("Database is not initialized — import @/lib/db before use");
  }
  return database;
};
