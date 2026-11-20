import "server-only";

import { HookStore } from "./hookStore/hookStore";

/**
 * Shared application hook store pin (stateless — decision Q9: no
 * processSingleton). The HookStore class lives in `hookStore/`; this module
 * keeps the pin so the import surface (`hookStore`) is unchanged. Class
 * files are pure (classFilePurity arch test), so the instance is pinned
 * here.
 */
export const hookStore = new HookStore();
