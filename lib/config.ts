import path from "path";

/**
 * Application configuration, sourced from environment variables.
 *
 * Integration credentials (GitLab / Jira / Cursor) are managed from
 * Settings → Integrations and stored in the DB — the environment only
 * carries infrastructure config (db / workspace) plus the optional
 * GITLAB_WEBHOOK_SECRET. Values are read lazily via methods so tests and
 * long-running processes always see the current environment.
 */

class CursorConfig {
  readonly baseUrl = "https://api.cursor.com";

  defaultModel(): string {
    return AppConfig.env("DEFAULT_MODEL");
  }
}

class GitLabConfig {
  /** Optional shared-secret check for /api/webhooks/gitlab (unset = accept all). */
  webhookSecret(): string {
    return AppConfig.env("GITLAB_WEBHOOK_SECRET");
  }
}

class DatabaseConfig {
  path(): string {
    return path.resolve(
      AppConfig.root,
      AppConfig.env("DATABASE_PATH", "./data/devflow.db")
    );
  }
}

class WorkspaceConfig {
  dir(): string {
    return path.resolve(AppConfig.root, AppConfig.env("WORKSPACE_DIR", "./workspaces"));
  }
}

export class AppConfig {
  private static readonly rootDir = process.cwd();

  static get root(): string {
    return AppConfig.rootDir;
  }

  static env(name: string, fallback = ""): string {
    return (process.env[name] ?? fallback).trim();
  }

  readonly cursor = new CursorConfig();
  readonly gitlab = new GitLabConfig();
  readonly db = new DatabaseConfig();
  readonly workspace = new WorkspaceConfig();
}

/** Shared application configuration. */
export const config = new AppConfig();
