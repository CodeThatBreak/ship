/**
 * Shared DB-path resolution and flow-delete helpers for seed scripts.
 *
 * Seed scripts write mock data. The production DB (data/devflow.prod.db — the
 * app's default when NODE_ENV=production and DATABASE_PATH is unset, see
 * lib/config.ts) must never be a seed target.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/** Demo/dev DB — the only default seed target (mirrors DatabaseConfig.demoPath default). */
export const DEMO_DB_REL = "./data/devflow.db";

/** Production DB file — mirrors DatabaseConfig.path()'s production default. */
export const PROD_DB_REL = "./data/devflow.prod.db";

/**
 * Flow-owned tables, in FK-safe delete order (children before `flows`).
 * Keep in sync with `FLOW_CHILD_TABLES` in lib/engine/flow-engine.ts
 * (tests/seed-db.test.ts asserts they match).
 */
export const FLOW_CHILD_TABLES = [
  "step_merges",
  "plan_steps",
  "events",
  "messages",
  "runs",
  "artifacts",
  "comments",
  "branches",
  "nodes",
  "hooks",
];

const ALLOW_NON_DEMO_FLAG = "--allow-non-demo-db";

const canonicalPath = (filePath) => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
};

/**
 * Resolve the SQLite file a seed script may write to (DATABASE_PATH override,
 * demo DB by default), enforce the demo DB allowlist, and guard the production
 * DB. Exits non-zero when the target is refused.
 */
export function resolveSeedDb(root, options = {}) {
  const allowNonDemo =
    options.allowNonDemo ??
    (process.argv.includes(ALLOW_NON_DEMO_FLAG) ||
      process.env.SEED_ALLOW_NON_DEMO_DB === "1");

  const file = path.resolve(root, process.env.DATABASE_PATH ?? DEMO_DB_REL);
  const prod = path.resolve(root, PROD_DB_REL);
  const demo = path.resolve(root, DEMO_DB_REL);

  if (canonicalPath(file) === canonicalPath(prod)) {
    console.error(
      `Refusing to seed the production DB (${prod}).\n` +
        `Seed scripts target the demo DB (${demo}) only — mock data must not reach production.`,
    );
    process.exit(1);
  }

  if (!allowNonDemo && canonicalPath(file) !== canonicalPath(demo)) {
    console.error(
      `Refusing to seed ${file}.\n` +
        `Only the demo database (${demo}) is allowed. Set DATABASE_PATH to that path, or pass ${ALLOW_NON_DEMO_FLAG} (dangerous).`,
    );
    process.exit(1);
  }

  console.log(`Seed target database: ${file}`);
  return file;
}

/** Open the seed DB (schema bootstrap + WAL). Logs the resolved target via resolveSeedDb. */
export function openSeedDb(root, options = {}) {
  const dbFile = resolveSeedDb(root, options);
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(fs.readFileSync(path.join(root, "lib/db/schema.sql"), "utf8"));
  return { db, dbFile };
}

export const now = () => new Date().toISOString();
export const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
export const uid = (p = "") =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

/**
 * Delete a flow and its step children (plan fan-out), mirroring FlowEngine.delete().
 * Does not remove worktrees — seed scripts only touch the DB file.
 */
export function deleteFlowCascade(db, flowId) {
  const childIds = db
    .prepare(`SELECT id FROM flows WHERE parent_flow_id=?`)
    .all(flowId)
    .map((r) => r.id);
  db.prepare(`DELETE FROM step_merges WHERE flow_id=? OR parent_flow_id=?`).run(flowId, flowId);
  db.prepare(`DELETE FROM plan_steps WHERE flow_id=?`).run(flowId);
  const ids = [flowId, ...childIds];
  for (const fid of ids) {
    for (const table of FLOW_CHILD_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE flow_id=?`).run(fid);
    }
  }
  db.prepare(`DELETE FROM flows WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
}

/** Remove every flow bound to a demo task, then the task row. */
export function deleteTaskDemoFlows(db, taskId, flowIds) {
  for (const id of flowIds) {
    deleteFlowCascade(db, id);
  }
  db.prepare(`DELETE FROM tasks WHERE id=?`).run(taskId);
}
