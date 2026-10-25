// ── settings shared endpoints ───────────────────────────────────────────────
// Resilient fetch helpers for the three endpoints the settings area depends
// on (/api/settings, /api/repos, /api/git-hosts) plus the shared readError
// mapper. Query keys live in constants/query-keys.ts.

import { FAILED_ACTION, type FailedAction } from "@/constants/api";
import type { GitHost, Repo, Settings } from "./context";

/** fetch + parse JSON, falling back on any transport/HTTP error instead of throwing. */
export async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

type SettingsPayload = { repos?: Repo[] };
type GitHostsPayload = { hosts?: GitHost[] };

export function fetchSettings(): Promise<Settings | null> {
  return fetchJson<Settings | null>("/api/settings", null);
}
export function fetchRepos(): Promise<Repo[]> {
  return fetchJson<SettingsPayload>("/api/repos", {}).then((j) => j.repos ?? []);
}
export function fetchGitHosts(): Promise<GitHost[]> {
  return fetchJson<GitHostsPayload>("/api/git-hosts", {}).then((j) => j.hosts ?? []);
}

/** Build an Error carrying the server's `error` message (or the action's fallback text). */
export async function readError(res: Response, action: FailedAction): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `${action} (${res.status})`);
}

/** PATCH /api/settings — used for any settings-backed key (e.g. harness). */
export async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
}
