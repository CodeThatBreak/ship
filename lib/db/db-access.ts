import "server-only";

import type { Database } from "./database";

/**
 * Pinned on `globalThis` for the same reason as `processSingleton` (see
 * `lib/singleton.ts`): under `next dev`, module-scope state is per bundle,
 * but the `Database` singleton is process-wide.
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
