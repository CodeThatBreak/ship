// ── types (shared by the settings sub-routes and loaders) ───────────────────

export type Repo = {
  id: string; name: string; cloud_url: string; local_path: string | null;
  default_branch: string; local_path_exists?: boolean;
  install_command?: string | null;
  skip_install?: number;
  sync_paths?: string | null;
  shared_dirs?: string | null;
  setup_command?: string | null;
  worktree_timeout_ms?: number | null;
};
export type HostInstanceRow = { id: string; name: string | null; baseUrl: string; tokenMasked: string };
export type GitHost = { kind: string; label: string; configured: boolean; instances: HostInstanceRow[] };
/** One selectable execution mode a harness offers (e.g. cloud / local for Cursor). */
export type HarnessMode = { value: string; label: string; configured: boolean };
/** An agent harness (runner) and the execution modes it offers. */
export type Harness = { key: string; label: string; modes: HarnessMode[] };
export type Settings = {
  harnesses?: Harness[];
  default_harness: string;
  default_execution_mode: string;
  default_model: string;
  local_agent: { force: boolean; sandbox: boolean; timeout_ms: number };
  secrets?: string[];
  http_allowlist?: string[];
  status: {
    cursorApiKeySet: boolean;
    localAgentConfigured: boolean;
    gitHosts: Record<string, boolean>;
    taskProviders: Record<string, boolean>;
  };
};
