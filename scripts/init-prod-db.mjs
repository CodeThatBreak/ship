/**
 * Bootstrap the production database (Postgres, step 01): create `devflow_prod`
 * if missing, then apply the Prisma migrations — schema only, zero rows, no
 * mock data.
 *
 * (Built-in flow templates are seeded by the app's idempotent migration on
 * first connection — see the template seeder in lib/db.)
 *
 * The old sqlite file bootstrap is meaningless in the Postgres era, so this
 * script now only provisions the database and runs `prisma migrate deploy`.
 *
 * Usage: npm run db:init:prod   (idempotent — safe to re-run)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The Prisma CLI and `pg` do not read `.env` on their own; load it so this
// script targets the same Postgres instance (and port) the app does.
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/** Production database URL — mirrors DatabaseConfig.url()'s production default. */
const prodUrl =
  process.env.DATABASE_URL?.trim() ||
  "postgresql://devflow:devflow@localhost:5432/devflow_prod";

const databaseNameFromUrl = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
  } catch {
    return "";
  }
};
const prodDb = databaseNameFromUrl(prodUrl);
if (!prodDb) {
  console.error(`Cannot parse a database name out of ${prodUrl} — refusing to run.`);
  process.exit(1);
}
if (process.env.DATABASE_URL?.trim() && prodDb !== "devflow_prod") {
  console.warn(
    `Warning: DATABASE_URL points at "${prodDb}", not devflow_prod.\n` +
      `  Production init will provision and migrate that database — make sure that is intended.`,
  );
}

// ── create the production database if missing (admin connection → `postgres`) ─
const adminUrl = new URL(prodUrl);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [prodDb]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${prodDb.replace(/"/g, '""')}"`);
    console.log(`created database ${prodDb}`);
  } else {
    console.log(`database ${prodDb} already exists`);
  }
} finally {
  await admin.end();
}

// ── apply the migrations ─────────────────────────────────────────────────────
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
    env: { ...process.env, DATABASE_URL: prodUrl },
  },
);

console.log(`Production DB ready: ${prodUrl.replace(/:[^:@/]+@/, ":***@")}`);
