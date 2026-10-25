"use client";
import {
  createContext, useCallback, useContext, useState, type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { fetchGitHosts, fetchRepos, fetchSettings } from "./queries";

// ── types (shared by the settings sub-routes) ───────────────────────────────

export type Repo = {
  id: string; name: string; cloud_url: string; local_path: string | null;
  default_branch: string; local_path_exists?: boolean;
  // worktree setup policy (Phase 2 columns, Phase 3 forms)
  install_command?: string | null;
  skip_install?: number;
  sync_paths?: string | null;
  shared_dirs?: string | null;
  setup_command?: string | null;
};
export type HostInstanceRow = { id: string; name: string | null; baseUrl: string; tokenMasked: string };
export type GitHost = { kind: string; label: string; configured: boolean; instances: HostInstanceRow[] };
export type PromptTemplate = {
  label: string; description: string; template: string;
  variables: string[]; mode: string;
};
export type Settings = {
  default_execution_mode: string;
  default_model: string;
  resolve_delay_ms: number;
  local_agent: { force: boolean; sandbox: boolean; timeout_ms: number };
  /** "enabled" | "disabled" — per-flow git worktrees for local runs */
  worktree_mode?: string;
  pnpm_virtual_store?: boolean;
  prompt_templates?: Record<string, PromptTemplate>;
  pricing?: Record<string, PricingEntry>;
  pricing_suggested?: Record<string, PricingEntry>;
  /** names of set secrets only (values never leave the server) */
  secrets?: string[];
  http_allowlist?: string[];
  status: { cursorApiKeySet: boolean; cursorApiKeyFromEnv?: boolean; cursorCliAvailable: boolean; gitHosts: Record<string, boolean>; taskProviders: Record<string, boolean> };
};
export type PricingEntry = { input_per_mtok?: number; output_per_mtok?: number; cache_read_per_mtok?: number; cache_write_per_mtok?: number };
export type PricingRow = { key: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

// ── provider ───────────────────────────────────────────────────────────────

type SettingsState = {
  settings: Settings | null;
  repos: Repo[];
  hosts: GitHost[];
  /** first paint not resolved yet */
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  reload: () => Promise<void>;
  saveSettings: (patch: Record<string, unknown>) => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);

/**
 * Server state (settings / repos / git hosts) is held by TanStack Query — one
 * cache per endpoint, shared across the settings sub-routes. Mutations
 * invalidate the affected key instead of manually resetting three useState
 * buckets.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: fetchSettings });
  const reposQuery = useQuery({ queryKey: queryKeys.repos, queryFn: fetchRepos });
  const hostsQuery = useQuery({ queryKey: queryKeys.gitHosts, queryFn: fetchGitHosts });

  /** refetch every shared settings query (same contract as the old manual fetches) */
  const reload = useCallback(async () => {
    await Promise.all(
      [queryKeys.settings, queryKeys.repos, queryKeys.gitHosts].map(
        (key) => queryClient.refetchQueries({ queryKey: key }),
      ),
    );
  }, [queryClient]);

  const saveSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    [queryClient],
  );

  const loading = settingsQuery.isPending || reposQuery.isPending || hostsQuery.isPending;

  return (
    <SettingsContext.Provider
      value={{
        settings: settingsQuery.data ?? null,
        repos: reposQuery.data ?? [],
        hosts: hostsQuery.data ?? [],
        loading,
        error,
        setError,
        reload,
        saveSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
