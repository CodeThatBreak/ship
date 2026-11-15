import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Test database (Postgres, dockerized — vitest globalSetup migrates it).
 * The globalSetup assigns `DATABASE_URL` itself; per-file state cleanup is
 * `truncateAll` in a `beforeAll`.
 */
export const assignDatabaseUrl = (url: string): void => {
  process.env.DATABASE_URL = url;
};

/** Resolve the test database URL (TEST_DATABASE_URL overrides the docker default). */
export const testDatabaseUrl = (): string =>
  (
    process.env.TEST_DATABASE_URL ??
    "postgresql://devflow:devflow@localhost:5432/devflow_test"
  ).trim();

/** Point the process at the default test database. */
export const assignTestDatabase = (): void => {
  assignDatabaseUrl(testDatabaseUrl());
};

/**
 * Reset the test DB between test files: truncate every table and re-seed the
 * built-in templates. Call from each DB-touching test file's `beforeAll`
 * (the `db` import must happen first so the facade exists).
 */
export const resetTestDatabase = async (): Promise<void> => {
  const { prisma } = await import("@/lib/db/prismaClient");
  await truncateAll(prisma);
  const { TemplateSeeder } = await import("@/lib/db/templateSeeder");
  await new TemplateSeeder().seed(prisma);
};

/**
 * Push the current Prisma schema into the test database (idempotent).
 * Used by vitest `globalSetup`.
 */
export const migrateTestDatabase = (): void => {
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      path.join(repoRoot, "prisma7.config.ts"),
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    },
  );
};

const TRUNCATABLE_TABLES = [
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
  "hook_deliveries",
  "flows",
  "flow_template_edges",
  "flow_template_nodes",
  "node_templates",
  "flow_templates",
  "worktree_removals",
  "settings",
  "gitlab_instances",
  "jira_instances",
  "repos",
  "tasks",
] as const;

/**
 * Truncate every table between test files (fast — one statement, no
 * per-file database provisioning). Keeps `prisma migrate deploy` output.
 */
export const truncateAll = async (prisma: PrismaClient): Promise<void> => {
  const tables = TRUNCATABLE_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
  );
};


