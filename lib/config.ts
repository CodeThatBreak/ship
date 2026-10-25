import path from "path";

/**
 * Application configuration, sourced from environment variables.
 *
 * Grouped by integration (cursor / jira / gitlab) plus infrastructure
 * (db / workspace). Values are read lazily via methods so tests and
 * long-running processes always see the current environment.
 */

class CursorConfig {
  readonly baseUrl = "https://api.cursor.com";

  apiKey(): string {
    return AppConfig.env("CURSOR_API_KEY");
  }

  defaultModel(): string {
    return AppConfig.env("DEFAULT_MODEL");
  }
}

class JiraConfig {
  baseUrl(): string {
    return AppConfig.env("JIRA_BASE_URL").replace(/\/+$/, "");
  }

  email(): string {
    return AppConfig.env("JIRA_EMAIL");
  }

  token(): string {
    return AppConfig.env("JIRA_API_TOKEN");
  }

  configured(): boolean {
    return Boolean(
      AppConfig.env("JIRA_BASE_URL") &&
        AppConfig.env("JIRA_EMAIL") &&
        AppConfig.env("JIRA_API_TOKEN")
    );
  }
}

class GitLabConfig {
  baseUrl(): string {
    return AppConfig.env("GITLAB_BASE_URL").replace(/\/+$/, "");
  }

  token(): string {
    return AppConfig.env("GITLAB_TOKEN");
  }

  webhookSecret(): string {
    return AppConfig.env("GITLAB_WEBHOOK_SECRET");
  }

  configured(): boolean {
    return Boolean(AppConfig.env("GITLAB_BASE_URL") && AppConfig.env("GITLAB_TOKEN"));
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
  readonly jira = new JiraConfig();
  readonly gitlab = new GitLabConfig();
  readonly db = new DatabaseConfig();
  readonly workspace = new WorkspaceConfig();
}

/** Shared application configuration. */
export const config = new AppConfig();
