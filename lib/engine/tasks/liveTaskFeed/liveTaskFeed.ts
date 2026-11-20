import "server-only";

import { TtlCache } from "@/lib/cache";
import type { TaskProviderRegistry } from "../registry/taskProviderRegistry";
import type {
  LiveTask,
  LiveTaskFilters,
  ResolvedLiveTaskFilters,
} from "../types/taskProvider";
import { CACHE_TTL_MS } from "./constants/liveTaskFeedCache";
import { cacheKey } from "./utils/cacheKey";
import type { LiveTaskFeedResult } from "./types/liveTaskFeed";

/** Live task feed over the registered task providers (§1): fetches provider tasks with filters behind a TTL cache, reporting cache age/meta honestly. Read-only — never writes tasks, never invents a provider. */
export class LiveTaskFeed {
  private readonly cache = new TtlCache<LiveTask[]>(CACHE_TTL_MS);

  constructor(private readonly registry: TaskProviderRegistry) {}

  async fetch(
    kind: string | undefined,
    filters: LiveTaskFilters,
    opts: { fresh: boolean },
  ): Promise<LiveTaskFeedResult> {
    const provider = kind ? this.registry.maybe(kind) : this.registry.first();
    if (!provider) {
      return { ok: false, status: 500, error: "no task providers registered" };
    }
    if (!(await provider.configured())) {
      return {
        ok: true,
        tasks: [],
        meta: {
          configured: false,
          provider: provider.kind,
          label: provider.label,
          cached: false,
          ageSeconds: 0,
          ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        },
      };
    }

    const resolved: ResolvedLiveTaskFilters = {
      assignee: filters.assignee ?? "me",
      statusCategory: filters.statusCategory ?? "",
      text: filters.text ?? "",
    };
    const key = cacheKey(provider.kind, resolved);
    const hit = opts.fresh ? undefined : this.cache.entry(key);
    if (hit && !hit.stale) {
      return {
        ok: true,
        tasks: hit.value,
        meta: {
          configured: true,
          provider: provider.kind,
          label: provider.label,
          cached: true,
          ageSeconds: this.cache.ageSeconds(key),
          ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        },
      };
    }

    try {
      const tasks = await provider.liveFetch(filters);
      this.cache.set(key, tasks);
      return {
        ok: true,
        tasks,
        meta: {
          configured: true,
          provider: provider.kind,
          label: provider.label,
          cached: false,
          ageSeconds: 0,
          ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        },
      };
    } catch (err) {
      if (hit) {
        return {
          ok: true,
          tasks: hit.value,
          meta: {
            configured: true,
            provider: provider.kind,
            label: provider.label,
            cached: true,
            stale: true,
            ageSeconds: this.cache.ageSeconds(key),
            ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
      return {
        ok: false,
        status: 502,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
