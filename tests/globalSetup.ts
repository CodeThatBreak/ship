import { migrateTestDatabase } from "./helpers/testDatabase";

/**
 * Vitest globalSetup: push the Prisma schema into the dockerized test
 * database once per run. Per-file cleanup is `truncateAll`
 * (tests/helpers/testDatabase.ts) — fast, no per-file provisioning.
 */
export default function globalSetup(): void {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgresql://devflow:devflow@localhost:5432/devflow_test";
  migrateTestDatabase();
}
