import "server-only";

import { UsageTracker } from "./usageTracker/usageTracker";

/**
 * Shared usage tracker (decision Q9 — plain module const): usage/cost
 * capture is stateless or DB-fenced, so per-module-graph copies cannot
 * disagree (the `engineParts` precedent). The UsageTracker class lives in
 * `usageTracker/usageTracker.ts` — class files are pure (classFilePurity
 * arch test); this module keeps the pin so the import surface is unchanged.
 */
export const usageTracker = new UsageTracker();
