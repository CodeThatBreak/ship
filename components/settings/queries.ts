// ── settings shared endpoints ───────────────────────────────────────────────
// One queryOptions factory per query key (docs/coding-patterns.md §4.3).
// Query keys live in constants/query-keys.ts.

import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchJson } from "@/hooks/fetch-json";
import { FAILED_ACTION, type FailedAction } from "@/constants/api";
import type { GitHost, Repo, Settings } from "./context";

type SettingsPayload = { repos?: Repo[] };
type GitHostsPayload = { hosts?: GitHost[] };

const loadSettings = (): Promise<Settings> =>
  fetchJson<Settings>("/api/settings");

const loadRepos = async (): Promise<Repo[]> => {
  const payload = await fetchJson<SettingsPayload>("/api/repos");
  return payload.repos ?? [];
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
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
};
