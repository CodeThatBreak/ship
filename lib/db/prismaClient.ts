import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config";
import { processSingleton } from "../singleton";

/**
 * The application PrismaClient — the ONLY surviving `processSingleton`
 * (decision Q9). Prisma's connection pool must be one-per-process and survive
 * `next dev` HMR; every other service is constructor-injected from the
 * composition root (`lib/composition/container.ts`). The arch test
 * `tests/architecture/noProcessSingletonOutsideDb.test.ts` enforces this.
 */
export const prisma = processSingleton("prisma", () => {
  const adapter = new PrismaPg({ connectionString: config.db.url() });
  return new PrismaClient({ adapter });
});
