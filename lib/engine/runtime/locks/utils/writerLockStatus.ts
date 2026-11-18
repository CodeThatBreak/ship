import "server-only";

import type { PrismaClient } from "@prisma/client";
import { PROCESS_LOCK_KEY } from "../constants/processLockKey";

/**
 * Whether ANY process holds the writer advisory lock right now — read from
 * `pg_locks`, so it is shared truth across processes (the web process's
 * `/api/health` answers for the worker). Never acquires anything.
 */
export const writerLockHeld = async (prisma: PrismaClient): Promise<boolean> => {
  const rows = await prisma.$queryRaw<{ granted: boolean }[]>
    `SELECT granted FROM pg_locks WHERE locktype='advisory' AND objid=${PROCESS_LOCK_KEY}`;
  return rows.length > 0;
};
