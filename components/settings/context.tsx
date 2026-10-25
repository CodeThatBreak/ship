"use client";
import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from "react";

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
  status: { cursorApiKeySet: boolean; cursorCliAvailable: boolean; gitHosts: Record<string, boolean>; taskProviders: Record<string, boolean> };
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
  saveSettings: (patch: any) => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [hosts, setHosts] = useState<GitHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, r, g] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/repos").then((r) => r.json()),
      fetch("/api/git-hosts").then((r) => r.json()),
    ]);
    setSettings(s);
    setRepos(r.repos ?? []);
    setHosts(g.hosts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const saveSettings = useCallback(async (patch: any) => {
    await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await reload();
  }, [reload]);

  return (
    <SettingsContext.Provider value={{ settings, repos, hosts, loading, error, setError, reload, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
