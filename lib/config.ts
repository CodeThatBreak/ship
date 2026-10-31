import "server-only";

import crypto from "node:crypto";
import path from "path";
import { fileURLToPath } from "node:url";

/** Repository root (parent of `lib/`), stable regardless of `process.cwd()`. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Application configuration, sourced from environment variables.
 *
 * Integration credentials (GitLab / Jira / Cursor) are managed from
 * Settings → Integrations and stored in the DB — the environment only
 * carries infrastructure config (db / workspace), GitLab webhook auth env
 * (`GITLAB_WEBHOOK_SECRET`, optional `GITLAB_WEBHOOK_ALLOW_UNSIGNED`), and
 * `DEVFLOW_SECRETS_KEY` (32-byte base64url master key for at-rest encryption).
 * Values are read lazily via methods so tests and long-running processes always
 * see the current environment.
 */

class SecretsConfig {
  /**
   * 32-byte AES key. Set `DEVFLOW_SECRETS_KEY` (base64url) in production.
   * In non-production, a deterministic dev key is derived from the DB path.
   */
  masterKeyBytes(): Buffer {
    const fromEnv = AppConfig.env("DEVFLOW_SECRETS_KEY");
    if (fromEnv) {
      const decoded = Buffer.from(fromEnv, "base64url");
      if (decoded.length === 32) return decoded;
      throw new Error("DEVFLOW_SECRETS_KEY must decode to exactly 32 bytes (base64url)");
    }
    if (process.env.NODE_ENV === "production") {
      if (process.env.NEXT_PHASE === "phase-production-build") {
        return crypto.scryptSync("devflow-next-build", "devflow-at-rest", 32);
      }
      throw new Error("DEVFLOW_SECRETS_KEY is required in production");
    }
    const dbPath = new DatabaseConfig().path();
    return crypto.scryptSync(`devflow-dev:${dbPath}`, "devflow-at-rest", 32);
  }
}

class CursorConfig {
  readonly baseUrl = "https://api.cursor.com";
}

let gitLabWebhookStartupWarned = false;

class GitLabConfig {
  /** Shared secret GitLab sends as `X-Gitlab-Token` on `/api/webhooks/gitlab`. */
  webhookSecret(): string {
    return AppConfig.env("GITLAB_WEBHOOK_SECRET");
  }

  /** Local-dev opt-in when `GITLAB_WEBHOOK_SECRET` is unset (deny by default). */
  webhookAllowUnsigned(): boolean {
    return AppConfig.env("GITLAB_WEBHOOK_ALLOW_UNSIGNED") === "1";
  }

  /** Log once when GitLab webhook auth is misconfigured or explicitly relaxed. */
  logStartupWarnings(): void {
    if (gitLabWebhookStartupWarned) return;
    gitLabWebhookStartupWarned = true;
    const secret = this.webhookSecret();
    const allowUnsigned = this.webhookAllowUnsigned();
    if (!secret && !allowUnsigned) {
      console.warn(
        "[devflow] GITLAB_WEBHOOK_SECRET is unset — POST /api/webhooks/gitlab is rejected. " +
          "Set GITLAB_WEBHOOK_SECRET or GITLAB_WEBHOOK_ALLOW_UNSIGNED=1 for unsigned local dev.",
      );
    }
    if (allowUnsigned) {
      console.warn(
        "[devflow] GITLAB_WEBHOOK_ALLOW_UNSIGNED=1 — accepting unsigned GitLab webhook deliveries.",
      );
    }
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
  readonly secrets = new SecretsConfig();

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
