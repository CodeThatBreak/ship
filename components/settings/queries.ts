// ── settings shared endpoints ───────────────────────────────────────────────
// One queryOptions factory per query key (docs/coding-patterns.md §4.3).
// Query keys live in constants/query-keys.ts.

import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/queryKeys";
import { fetchJson } from "@/hooks/fetchJson";
import { apiFetch } from "@/hooks/localApiToken";
import { FAILED_ACTION, type FailedAction } from "@/constants/api";
import type { GitHost, Settings } from "@/types/settings";
import type { Repo } from "@/types/repos";

export type ReposQueryData = { repos: Repo[]; serverHome: string };

/** Normalize cached repos query data (supports legacy array-shaped cache entries). */
export const reposFromQueryData = (
  data: ReposQueryData | Repo[] | undefined,
): Repo[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.repos;
};

type GitHostsPayload = { hosts?: GitHost[] };

const loadSettings = (): Promise<Settings> =>
  fetchJson<Settings>("/api/settings");

const loadRepos = async (): Promise<ReposQueryData> => {
  const payload = await fetchJson<{ repos?: Repo[]; server_home?: string }>("/api/repos");
  return {
    repos: payload.repos ?? [],
    serverHome: payload.server_home ?? "",
  };
};

const loadGitHosts = async (): Promise<GitHost[]> => {
  const payload = await fetchJson<GitHostsPayload>("/api/git-hosts");
  return payload.hosts ?? [];
};

export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: loadSettings,
  });

export const reposQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.repos,
    queryFn: loadRepos,
  });

export const gitHostsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.gitHosts,
    queryFn: loadGitHosts,
  });

/** @deprecated Prefer settingsQueryOptions — kept for callers migrating off inline queryFn. */
export const fetchSettings = loadSettings;

/** @deprecated Prefer reposQueryOptions. */
export const fetchRepos = loadRepos;

/** @deprecated Prefer gitHostsQueryOptions. */
export const fetchGitHosts = loadGitHosts;

/** Resilient read for one-off prefills (not a shared query-key owner). */
export async function fetchJsonOr<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

/** Build an Error carrying the server's `error` message (or the action's fallback text). */
export const readError = async (
  res: Response,
  action: FailedAction,
): Promise<Error> => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `${action} (${res.status})`);
};

/** PATCH /api/settings — used for any settings-backed key (e.g. harness). */
export const patchSettings = async (
  patch: Record<string, unknown>,
): Promise<void> => {
  const res = await apiFetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
};
