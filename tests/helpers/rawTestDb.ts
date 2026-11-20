import type { PrismaClient } from "@prisma/client";

/**
 * Raw test-seed/verify helpers over the shared test database.
 *
 * Test fixtures and assertions seed and inspect rows with hand-written SQL
 * (test data is exempt from the engine's ORM-first rule); they resolve the
 * shared `Database` lazily so importing this module never constructs the
 * Prisma client before `assignTestDatabase()` has pointed `DATABASE_URL` at
 * the test database. These are the test-side replacements for the deleted
 * `Database.get/all/run` facade methods — engine code never imports them.
 */

const prisma = async (): Promise<PrismaClient> => {
  const { db } = await import("@/lib/db/app");
  return db.prisma;
};

/** Execute a write; returns the affected row count. */
export const testRun = async (sql: string, ...args: unknown[]): Promise<number> =>
  (await prisma()).$executeRawUnsafe(sql, ...args);

/** All rows of a read. */
export const testAll = async <T = unknown>(sql: string, ...args: unknown[]): Promise<T[]> =>
  (await prisma()).$queryRawUnsafe<T[]>(sql, ...args);

/** The first row of a read (undefined when none). */
export const testGet = async <T = unknown>(sql: string, ...args: unknown[]): Promise<T | undefined> =>
  (await testAll<T>(sql, ...args))[0];
