import "server-only";

import { pinnedProcessService } from "@/lib/composition/processServices";
import { LiveTaskFeed } from "./liveTaskFeed/liveTaskFeed";
import { taskRegistry } from "./registry";

/**
 * Shared live-task feed pin. Process-pinned via the process-services
 * container (decision Q9): the `TtlCache` holds EXTERNAL-provider fetch
 * results (not DB rows) and backs the stale-on-error fallback —
 * per-module-graph copies would double-fetch the provider and disagree
 * about `cached`/`stale`/age metadata shown to the user. The LiveTaskFeed
 * class lives in `liveTaskFeed/`; this module keeps the pin so the import
 * surface (`liveTaskFeed`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const liveTaskFeed = pinnedProcessService(
  "liveTaskFeed",
  () => new LiveTaskFeed(taskRegistry),
);
