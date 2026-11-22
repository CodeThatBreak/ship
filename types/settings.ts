/** One connected integration instance as returned by the instance endpoints. */
export type InstanceRow = {
  id: string;
  name: string | null;
  baseUrl: string;
  email?: string;
  tokenMasked: string;
};

/** One registered git host and its connected instances (GET /api/git-hosts). */
export type GitHost = {
  kind: string;
  label: string;
  configured: boolean;
  instances: InstanceRow[];
};

/** One selectable execution mode a harness offers (e.g. cloud / local for Cursor). */
export type HarnessMode = { value: string; label: string; configured: boolean };

/** An agent harness (runner) and the execution modes it offers. */
export type Harness = { key: string; label: string; modes: HarnessMode[] };

/** Full settings document — same JSON shape as GET /api/settings. */
export type Settings = {
  harnesses?: Harness[];
  defaultHarness: string;
  defaultExecutionMode: string;
  defaultModel: string;
  localAgent: { force: boolean; sandbox: boolean; timeoutMs: number };
  secrets?: string[];
  httpAllowlist?: string[];
  status: {
    cursorApiKeySet: boolean;
    localAgentConfigured: boolean;
    gitHosts: Record<string, boolean>;
    taskProviders: Record<string, boolean>;
  };
};
