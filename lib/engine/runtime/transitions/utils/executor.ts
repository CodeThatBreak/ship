import "server-only";

import type { Database, QueryExecutor } from "../../../../db/database";

/**
 * The Database-shaped view over an optional transaction client: inside a
 * caller transaction the raw executor speaks (`$executeRawUnsafe` /
 * `$queryRawUnsafe`); outside, the global pool passes through. Lets the
 * authority's conditional UPDATEs join a caller's completion transaction
 * (step 06, Invariant 7) without duplicating statement bodies.
 */
export const executorFor = (
  database: Database,
  tx?: QueryExecutor,
): Pick<Database, "run" | "get" | "all"> => {
  if (!tx) return database;
  return {
    run: (sql: string, ...args: unknown[]) => tx.$executeRawUnsafe(sql, ...args),
    get: async <T>(sql: string, ...args: unknown[]) => (await tx.$queryRawUnsafe<T[]>(sql, ...args))[0],
    all: <T>(sql: string, ...args: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...args),
  };
};
