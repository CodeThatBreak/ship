import "server-only";

import { SubflowManager } from "./subflowManager/subflowManager";

/**
 * Shared subflow runtime manager pin — bound to the flow engine by
 * flowEngine.ts at load. The SubflowManager class lives in
 * `subflowManager/`; this module keeps the pin so the import surface
 * (`subflowFlows`) is unchanged. The bound engine reference is the only
 * in-memory field besides the expander's attempt tokens — every linkage
 * derives from `flows` rows, so per-module-graph copies cannot disagree.
 * Class files are pure (classFilePurity arch test), so the instance is
 * pinned here.
 */
export const subflowFlows = new SubflowManager();
