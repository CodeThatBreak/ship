/**
 * Shared DB-path resolution for seed scripts.
 *
 * Seed scripts write mock data. The production DB (data/devflow.prod.db — the
 * app's default when NODE_ENV=production, see lib/config.ts) must never be a
 * seed target, so resolveSeedDb aborts when pointed at it.
 */
import path from "path";

/** Production DB file — mirrors DatabaseConfig.path()'s production default. */
export const PROD_DB_REL = "./data/devflow.prod.db";

/**
 * Resolve the SQLite file a seed script may write to (DATABASE_PATH override,
 * demo DB by default) and guard the production DB. Exits non-zero when the
 * target is the production DB.
 */
export function resolveSeedDb(root) {
  const file = path.resolve(root, process.env.DATABASE_PATH ?? "./data/devflow.db");
  const prod = path.resolve(root, PROD_DB_REL);
  if (file === prod) {
    console.error(
      `Refusing to seed the production DB (${prod}).\n` +
      `Seed scripts target the demo DB (${path.resolve(root, "./data/devflow.db")}) only — mock data must not reach production.`
    );
    process.exit(1);
  }
  return file;
}
