import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Temp SQLite file path for an isolated test database (never the dev DB). */
export const createIsolatedDatabasePath = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "test.db");
};

/** Point `lib/config` at a test database before the first `db` import. */
export const assignDatabasePath = (dbPath: string): void => {
  process.env.DATABASE_PATH = dbPath;
};
