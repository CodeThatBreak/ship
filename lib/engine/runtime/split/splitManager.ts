import "server-only";

import { SplitManager } from "./splitManager/splitManager";

/**
 * Shared split runtime manager pin — bound to the flow engine by
 * flowEngine.ts at load. The SplitManager class lives in `splitManager/`;
 * this module keeps the pin so the import surface (`splitManager`) is
 * unchanged. Constructor-injected linkage (the `SplitLinkIndex` seam) so a
 * future `split_units` table swap never ripples into the runtime. The bound
 * engine reference is the only in-memory field — every unit's state derives
 * from `flows` rows, so per-module-graph copies cannot disagree. Class files
 * are pure (classFilePurity arch test), so the instance is pinned here.
 */
export const splitManager = new SplitManager();
