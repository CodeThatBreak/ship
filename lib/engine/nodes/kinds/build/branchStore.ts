import "server-only";

import { BranchStore } from "./branchStore/branchStore";

/**
 * Shared branch store (decision Q9 — plain module const): branch rows are
 * DB-fenced, so per-module-graph copies cannot disagree (the `engineParts`
 * precedent). The BranchStore class lives in `branchStore/branchStore.ts` —
 * class files are pure (classFilePurity arch test); this module keeps the
 * pin so the import surface is unchanged.
 */
export const branchStore = new BranchStore();
