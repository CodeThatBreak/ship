/**
 * Bootstrap the production DB: schema only, zero rows — no mock data.
 *
 * (Built-in flow templates are seeded by the app's idempotent migration on
 * first connection — see Database.connection()/seedTemplates in lib/db.)
 *
 * Usage: npm run db:init:prod   (idempotent — safe to re-run)
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROD_DB_REL } from "./lib/seed-db.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = path.resolve(root, PROD_DB_REL);

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((t) => t.name);
console.log(`Production DB ready: ${dbFile}`);
console.log(`Schema tables: ${tables.join(", ")}`);
