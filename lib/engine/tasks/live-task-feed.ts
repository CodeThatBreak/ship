import "server-only";

import { TtlCache } from "@/lib/cache";
import type { TaskProviderRegistry } from "./registry";
import type {
  LiveTask,
  LiveTaskFilters,
  ResolvedLiveTaskFilters,
} from "./task-provider";

const CACHE_TTL_MS = 60_000;

const cacheKey = (kind: string, f: ResolvedLiveTaskFilters): string =>
  [kind, f.assignee, f.statusCategory, f.text.toLowerCase()].join("|");

export type LiveTaskFeedMeta = {
  configured: boolean;
  provider: string;
  label: string;
  cached: boolean;
  stale?: boolean;
  ageSeconds: number;
  ttlSeconds: number;
  error?: string;
};

export type LiveTaskFeedResult =
  | { ok: true; tasks: LiveTask[]; meta: LiveTaskFeedMeta }
  | { ok: false; status: number; error: string };

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
    if (!provider.configured()) {
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
