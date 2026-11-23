/**
 * Shared helpers for the seed scripts — Postgres/Prisma era (step 01).
 *
 * Seed scripts write mock data against the demo database. The production
 * database (`devflow_prod`) must never be a seed target, so every seed target
 * is resolved through `resolveSeedUrl`/`openSeedPrisma` (AGENTS.md §1).
 *
 * These are plain Node scripts — no TS compile step, no lib/ imports (lib/ is
 * server-only). `@prisma/client` is imported directly and instantiated with an
 * explicit connectionString so `.env`'s DATABASE_URL can never leak the wrong
 * database into a seed run.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";

// ── target vocabulary (mirrors lib/config.ts DatabaseConfig) ─────────────────

/** Demo/dev database — the sanctioned default seed target. */
export const DEMO_DB_NAME = "devflow";

/** Test database — disposable, truncated by the test harness; allowed for dev. */
export const TEST_DB_NAME = "devflow_test";

/** Production database — never a seed/migration target. */
export const PROD_DB_NAME = "devflow_prod";

/** Demo/dev URL — mirrors DatabaseConfig.demoUrl()'s default. */
export const DEFAULT_DEMO_URL = "postgresql://devflow:devflow@localhost:5432/devflow";

const ALLOW_NON_DEMO_FLAG = "--allow-non-demo-db";

/**
 * Parse the database name out of a Postgres connection string. Falls back to a
 * regex for strings that `new URL` refuses (special chars in credentials).
 */
export function databaseNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("?")[0]);
  } catch {
    const match = /\/([^/?]+)(?:\?.*)?$/.exec(url);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

/**
 * Resolve + guard the seed target URL (DATABASE_URL override, demo DB default).
 * Refuses anything but the demo/dev databases; `devflow_prod` is refused even
 * with the override flag. Exits non-zero when the target is refused.
 */
export function resolveSeedUrl(options = {}) {
  const allowNonDemo =
    options.allowNonDemo ??
    (process.argv.includes(ALLOW_NON_DEMO_FLAG) || process.env.SEED_ALLOW_NON_DEMO_DB === "1");

  const url = (options.url ?? process.env.DATABASE_URL ?? DEFAULT_DEMO_URL).trim();
  const name = databaseNameFromUrl(url);

  if (!name) {
    console.error(`Refusing to seed: cannot parse a database name out of ${url}.`);
    process.exit(1);
  }
  if (name === PROD_DB_NAME) {
    console.error(
      `Refusing to seed the production database (${PROD_DB_NAME}).\n` +
        `Seed scripts target the demo database (${DEMO_DB_NAME}) only — mock data must not reach production.`,
    );
    process.exit(1);
  }
  if (!allowNonDemo && name !== DEMO_DB_NAME && name !== TEST_DB_NAME) {
    console.error(
      `Refusing to seed database "${name}".\n` +
        `Only the demo database (${DEMO_DB_NAME}) or the disposable test database (${TEST_DB_NAME}) is allowed.\n` +
        `Point DATABASE_URL there, or pass ${ALLOW_NON_DEMO_FLAG} (dangerous).`,
    );
    process.exit(1);
  }

  console.log(`Seed target database: ${name}`);
  return { url, databaseName: name };
}

/**
 * Open the seed PrismaClient against the resolved demo target. The connection
 * string is passed explicitly so .env's DATABASE_URL is never picked up
 * behind our back.
 */
export function openSeedPrisma(options = {}) {
  const { url, databaseName } = resolveSeedUrl(options);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return { prisma, url, databaseName };
}

export const now = () => new Date();
export const minsAgo = (m) => new Date(Date.now() - m * 60_000);
export const uid = (p = "") =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ── flow deletion (mirrors FlowEngine.delete / FLOW_CHILD_TABLES) ────────────

/**
 * Delete a flow and its owned rows, mirroring FlowEngine.delete() — children
 * before `flows`, FK-safe. Does not remove worktrees — seed scripts only touch
 * the database.
 */
export async function deleteFlowCascadePg(prisma, flowId) {
  const ids = [flowId];
  const hookIds = (
    await prisma.hook.findMany({ where: { flowId: { in: ids } }, select: { id: true } })
  ).map((h) => h.id);

  await prisma.$transaction([
    prisma.planStep.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.event.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.message.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.run.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.artifact.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.comment.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.branch.deleteMany({ where: { flowId: { in: ids } } }),
    prisma.node.deleteMany({ where: { flowId: { in: ids } } }),
    ...(hookIds.length
      ? [prisma.hookDelivery.deleteMany({ where: { hookId: { in: hookIds } } })]
      : []),
    prisma.hook.deleteMany({ where: { OR: [{ flowId: { in: ids } }, { id: { in: hookIds } }] } }),
    prisma.flow.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return ids;
}

/** Remove every flow bound to a demo task (plus explicit flow ids), then the task row. */
export async function deleteTaskDemoFlows(prisma, taskId, flowIds) {
  const ids = new Set(flowIds);
  for (const f of await prisma.flow.findMany({ where: { taskId }, select: { id: true } })) {
    ids.add(f.id);
  }
  for (const id of ids) {
    await deleteFlowCascadePg(prisma, id);
  }
  await prisma.task.deleteMany({ where: { id: taskId } });
}

// ── legacy sqlite helpers (tests/seedDb.test.ts contract) ────────────────────
// Kept only for the characterization test, which exercises the guard semantics
// and the flow-cascade delete against a scratch better-sqlite3 file. Removed
// together with better-sqlite3 at the end of the overhaul.

/**
 * Flow-owned tables, in FK-safe delete order (children before `flows`).
 * Keep in sync with `FLOW_CHILD_TABLES` in lib/engine/flow-engine.ts
 * (tests/seedDb.test.ts asserts they match).
 */
export const FLOW_CHILD_TABLES = [
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

/** Demo/dev DB file — legacy sqlite default (pre step-01). */
export const DEMO_DB_REL = "./data/devflow.db";

/** Production DB file — legacy sqlite default (pre step-01). */
export const PROD_DB_REL = "./data/devflow.prod.db";

const canonicalPath = (filePath) => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
};

/**
 * Legacy sqlite seed-target resolution (DATABASE_PATH file semantics) — used
 * by tests/seedDb.test.ts to pin the guard behavior. Prisma seeds go through
 * `resolveSeedUrl` above.
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

/**
 * Delete a flow and its owned rows, mirroring FlowEngine.delete().
 * Legacy sqlite version (tests/seedDb.test.ts contract) — seed scripts use
 * `deleteFlowCascadePg`.
 */
export function deleteFlowCascade(db, flowId) {
  db.prepare(`DELETE FROM plan_steps WHERE flow_id=?`).run(flowId);
  const ids = [flowId];
  for (const fid of ids) {
    for (const table of FLOW_CHILD_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE flow_id=?`).run(fid);
    }
  }
  db.prepare(`DELETE FROM flows WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
}
