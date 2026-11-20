import "server-only";

import type { ResolvedLiveTaskFilters } from "../../types/taskProvider";

/** Normalized filter tuple → cache key. */
export const cacheKey = (kind: string, f: ResolvedLiveTaskFilters): string =>
  [kind, f.assignee, f.statusCategory, f.text.toLowerCase()].join("|");
