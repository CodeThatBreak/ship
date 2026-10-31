import "server-only";

import type { Database } from "./database";

let database: Database | undefined;

/** Called from {@link Database}'s constructor so config helpers can resolve the singleton without importing `lib/db/index`. */
export const bindDatabase = (instance: Database): void => {
  database = instance;
};

export const getDb = (): Database => {
  if (!database) {
    throw new Error("Database is not initialized — import @/lib/db before use");
  }
  return database;
};
