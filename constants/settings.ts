/** Persisted settings keys (§2.7) — shared by SettingsService and loaders. */
export const SETTINGS_KEYS = {
  CURSOR_API_KEY: "cursor.api_key",
  DEFAULT_HARNESS: "default_harness",
  DEFAULT_EXECUTION_MODE: "default_execution_mode",
  DEFAULT_MODEL: "default_model",
  LOCAL_AGENT_FORCE: "local_agent.force",
  LOCAL_AGENT_SANDBOX: "local_agent.sandbox",
  LOCAL_AGENT_TIMEOUT_MS: "local_agent.timeout_ms",
  SECRETS: "secrets",
  HTTP_ALLOWLIST: "http_allowlist",
} as const;
