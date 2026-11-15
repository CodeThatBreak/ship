/**
 * Provision + migrate the vitest test database (npm run db:test:setup —
 * mirrors tests/globalSetup.ts, which runs this on every `npm test`):
 * create the test database if missing (local Postgres; docker-compose
 * provisions it via scripts/db/init-test-db.sql), then `prisma migrate
 * deploy` with DATABASE_URL pointed at it.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** Test database URL (TEST_DATABASE_URL overrides — mirrors tests/helpers/testDatabase.ts). */
const testUrl =
  process.env.TEST_DATABASE_URL?.trim() ||
  "postgresql://devflow:devflow@localhost:5432/devflow_test";

const databaseNameFromUrl = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
  } catch {
    return "";
  }
};
const testDb = databaseNameFromUrl(testUrl);
if (!testDb) {
  console.error(`Cannot parse a database name out of ${testUrl} — refusing to run.`);
  process.exit(1);
}

// create the test database only if missing (docker-compose provisions it via
// scripts/db/init-test-db.sql; local Postgres may need it created by hand)
const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDb]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${testDb.replace(/"/g, '""')}"`);
    console.log(`created database ${testDb}`);
  } else {
    console.log(`database ${testDb} already exists`);
  }
} finally {
  await admin.end();
}

execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/prisma/build/index.js"),
    "migrate",
    "deploy",
    "--config",
    path.join(root, "prisma7.config.ts"),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  },
);
