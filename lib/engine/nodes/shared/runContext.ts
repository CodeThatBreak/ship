import "server-only";

import { FlowContextHelper } from "./runContext/flowContextHelper";

/**
 * Process pin for the flow-context helper (decision Q9). The
 * FlowContextHelper class lives in `runContext/` (its types in
 * `runContext/types/flowContext.ts`); this module keeps the pin so the
 * import surface (`flowCtxHelper`) is unchanged. Stateless — class files
 * are pure (classFilePurity arch test), so the instance is pinned here.
 */
export const flowCtxHelper = new FlowContextHelper();
