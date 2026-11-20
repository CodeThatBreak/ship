import "server-only";

import { BranchNamer } from "./branchNamer/branchNamer";

/**
 * Shared branch namer (decision Q9 — plain module const, stateless): the
 * BranchNamer class lives in `branchNamer/branchNamer.ts` — class files are
 * pure (classFilePurity arch test); this module keeps the pin so the import
 * surface is unchanged.
 */
export const branchNamer = new BranchNamer();
