import { NextResponse } from "next/server";
import { TtlCache } from "../../../../lib/cache";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";
import type {
  LiveTask,
  LiveTaskFilters,
} from "../../../../lib/engine/tasks/task-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Runtime task feed for the tasks table — fetched straight from the provider
 * (never stored). The table's predefined filters (assignee, status bucket,
 * text search, provider kind) come in as query params; results are cached
 * in-process for 60s so filter changes / polling don't hammer the source API.
 * `?fresh=1` bypasses the cache (the table's refresh button).
 *
 * Per-filter-set cache entries: `kind:assignee|statusCategory|text`.
 */
const CACHE_TTL_MS = 60_000;
const cache = new TtlCache<LiveTask[]>(CACHE_TTL_MS);

function cacheKey(kind: string, f: Required<Omit<LiveTaskFilters, never>>): string {
  return [kind, f.assignee, f.statusCategory, f.text.toLowerCase()].join("|");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters: LiveTaskFilters = {
    assignee: url.searchParams.get("assignee") === "any" ? "any" : "me",
    statusCategory: (url.searchParams.get("statusCategory") ?? "").slice(0, 40) || undefined,
    text: (url.searchParams.get("text") ?? "").slice(0, 200) || undefined,
  };
  const fresh = url.searchParams.get("fresh") === "1";
  const kind = url.searchParams.get("kind") ?? undefined;

  const provider = kind ? taskRegistry.maybe(kind) : taskRegistry.first();
  if (!provider) {
    return NextResponse.json(
      { error: "no task providers registered" },
      { status: 500 },
    );
  }
  if (!provider.configured()) {
    return NextResponse.json({
      tasks: [],
      configured: false,
      provider: provider.kind,
      label: provider.label,
      cached: false,
      ageSeconds: 0,
    });
  }

  const key = cacheKey(provider.kind, {
    assignee: filters.assignee ?? "me",
    statusCategory: filters.statusCategory ?? "",
    text: filters.text ?? "",
  });
  const hit = fresh ? undefined : cache.entry(key);
  if (hit && !hit.stale) {
    return NextResponse.json({
      tasks: hit.value,
      configured: true,
      provider: provider.kind,
      label: provider.label,
      cached: true,
      ageSeconds: cache.ageSeconds(key),
      ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
    });
  }

  try {
    const tasks = await provider.liveFetch(filters);
    cache.set(key, tasks);
    return NextResponse.json({
      tasks,
      configured: true,
      provider: provider.kind,
      label: provider.label,
      cached: false,
      ageSeconds: 0,
      ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
    });
  } catch (err) {
    // serve stale on failure rather than blanking the table
    if (hit) {
      return NextResponse.json({
        tasks: hit.value,
        configured: true,
        provider: provider.kind,
        label: provider.label,
        cached: true,
        stale: true,
        ageSeconds: cache.ageSeconds(key),
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
