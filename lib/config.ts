import "server-only";

import path from "path";
import { fileURLToPath } from "node:url";

/** Repository root (parent of `lib/`), stable regardless of `process.cwd()`. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Application configuration, sourced from environment variables.
 *
 * Integration credentials (GitLab / Jira / Cursor) are managed from
 * Settings → Integrations and stored in the DB — the environment only
 * carries infrastructure config (db / workspace), the optional
 * GITLAB_WEBHOOK_SECRET, and the optional DEFAULT_MODEL fallback.
 * Values are read lazily via methods so tests and
 * long-running processes always see the current environment.
 */

class CursorConfig {
  readonly baseUrl = "https://api.cursor.com";
}

class GitLabConfig {
  /** Optional shared-secret check for /api/webhooks/gitlab (unset = accept all). */
  webhookSecret(): string {
    return AppConfig.env("GITLAB_WEBHOOK_SECRET");
  }
}

class DatabaseConfig {
  /** Demo/dev DB — the default (and only sanctioned) target for seed scripts. */
  demoPath(): string {
    return path.resolve(
      AppConfig.root,
      AppConfig.env("DATABASE_PATH", "./data/devflow.db")
    );
  }

  /**
   * Application DB path. In production (`next start`) this defaults to a
   * dedicated file so seeded demo data can never leak into the production
   * database; DATABASE_PATH overrides in every environment.
   */
  path(): string {
    if (!AppConfig.env("DATABASE_PATH") && process.env.NODE_ENV === "production") {
      return path.resolve(AppConfig.root, "./data/devflow.prod.db");
    }
    return this.demoPath();
  }

  /** Canonical DDL file (resolved from the repo root, not `process.cwd()`). */
  schemaSqlPath(): string {
    return path.resolve(AppConfig.root, "lib/db/schema.sql");
  }
}

class WorkspaceConfig {
  dir(): string {
    // expand a leading `~` — path.resolve would otherwise treat it as a
    // literal directory name (e.g. `.env`'s `WORKSPACE_DIR=~/…` would put
    // worktrees inside the repo tree, where setup correctly refuses them)
    const raw = AppConfig.env("WORKSPACE_DIR", "./workspaces");
    const expanded = raw.startsWith("~") ? path.join(process.env.HOME ?? "", raw.slice(1)) : raw;
    return path.resolve(AppConfig.root, expanded);
  }
}

export class AppConfig {
  private static readonly rootDir = REPO_ROOT;

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

  /**
   * Last-resort default agent model (the `DEFAULT_MODEL` env var).
   * Vendor-neutral: applies to whichever harness executes the run; per-run
   * selection and the `default_model` setting override it.
   */
  defaultModel(): string {
    return AppConfig.env("DEFAULT_MODEL");
  }
}

/** Shared application configuration. */
export const config = new AppConfig();
