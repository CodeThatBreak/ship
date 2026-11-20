import "server-only";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config";

/**
 * The application PrismaClient — the ONLY process-pinned service (decision
 * Q9). Prisma's connection pool must be one-per-process and survive `next
 * dev` HMR, so the instance is pinned on `globalThis` inline (the old
 * `processSingleton` helper survives only for the engine half's migration;
 * this module no longer imports it). Every other service is either a plain
 * module const or constructor-injected from the composition roots
 * (`lib/composition/container.ts`, `lib/composition/processServices.ts`);
 * the arch test `tests/architecture/noProcessSingletonOutsideDb.test.ts`
 * enforces the boundary.
 *
 * The session timezone is pinned to UTC: `@prisma/adapter-pg` normalizes
 * timestamptz text by replacing the numeric offset with `+00:00`, so under a
 * non-UTC session zone every raw-query timestamp read would be skewed by the
 * offset while the stored instant stays correct. With the session pinned, the
 * wire format is always `+00`, and JS Dates carry the true instants.
 */

const PRISMA_SLOT = Symbol.for("devflow.singleton.prisma");

const createPrismaClient = (): PrismaClient => {
  const url = new URL(config.db.url());
  url.searchParams.set("options", "-c timezone=UTC");
  const adapter = new PrismaPg({ connectionString: url.toString() });
  return new PrismaClient({ adapter });
};

const globalSlots = globalThis as Record<PropertyKey, unknown>;
if (globalSlots[PRISMA_SLOT] == null) globalSlots[PRISMA_SLOT] = createPrismaClient();

export const prisma = globalSlots[PRISMA_SLOT] as PrismaClient;
