import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * The dependency-setup policy layer (pure — no db/engine imports; repo tree
 * in, DepPolicy out). The engine resolves a repo's policy here and hands it
 * to the executor (worktree-setup.ts); adding an ecosystem means adding a
 * rule to the resolver's table, never editing engine/node logic.
 *
 * Resolution order (first hit wins):
 *  1. per-repo overrides — `skip_install` → none, `install_command` → command
 *  2. recognized ecosystem rules (manifest+lockfile pairs)
 *  3. nothing recognizable → none
 */
export type DepStrategy = "clone" | "store-install" | "install" | "command" | "none";

export interface DepPolicy {
  strategy: DepStrategy;
  /** shell command for "command" / "install" / "store-install" (run in the worktree root) */
  command?: string;
  /** bounded execution for the strategy's command (ms) */
  timeoutMs?: number;
  /** "clone": dep directories copied hub → worktree (instant CoW when the fs allows) */
  depDirs?: string[];
  /** "clone": the lockfile whose hub/worktree hashes gate the copy (executor-checked) */
  lockfile?: string;
  /** "clone": executed instead when the hub's dep state can't be trusted for a copy */
  fallback?: DepPolicy;
  /** which rule produced this policy — lifecycle events + dry-run reporting */
  source: string;
}

/** Per-repo overrides (columns on the repos table; all optional). */
export interface RepoDepOverrides {
  install_command?: string | null;
  skip_install?: boolean | number | null;
  setup_command?: string | null;
  sync_paths?: string | null;
  shared_dirs?: string | null;
}

/**
 * Default untracked-config sync: config surfaces the worktree needs but git
 * doesn't carry. Overridable per repo via `sync_paths`.
 */
export const DEFAULT_SYNC_GLOBS = [".env*", "*.rc"];

/** Warm-build caches copied from the hub when present (best-effort; misses fine). */
export const COMMON_CACHE_DIRS = [".turbo", ".nx", ".next", "target", "__pycache__"];

/** Default bounded execution for a dep-setup command (10 min). */
export const DEFAULT_SETUP_TIMEOUT_MS = 600_000;

// ── glob matching (dot-inclusive so `.env*`/`*.rc` reach dotfiles) ──────────

function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += "[\\s\\S]*";
        i++;
        if (g[i + 1] === "/") i++; // "a/**" matches a's children, not "a" itself
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

// directories never walked for config/shared matching
const SKIP_WALK_DIRS = new Set([".git", "node_modules"]);

/**
 * Base class for an ecosystem rule in the strategy table: each rule decides
 * whether it applies to a repo tree and produces the DepPolicy when it does.
 * Subclass + add to `DepPolicyResolver.rules` — no node logic changes.
 */
abstract class EcosystemRule {
  abstract readonly name: string;
  /** Does this rule recognize the repo tree? */
  abstract applies(hubPath: string): boolean;
  /** The policy for a recognized repo. */
  abstract policy(hubPath: string): DepPolicy;
  protected exists(hubPath: string, file: string): boolean {
    return fs.existsSync(path.join(hubPath, file));
  }
}

/**
 * Node package-management rule — one row per lockfile, not the axis of design.
 * A clone policy is produced with the repo's frozen-install fallback; the
 * executor PROVES clone usability at runtime (hub dep dirs present, hub and
 * worktree lockfile hashes match) and falls back otherwise.
 */
class NodeRule extends EcosystemRule {
  readonly name = "node";

  /** One row per package manager: lockfile + reproducible frozen install. */
  private static readonly LOCKFILES: { pm: string; lockfile: string; frozenInstall: (hubPath: string) => string }[] = [
    { pm: "pnpm", lockfile: "pnpm-lock.yaml", frozenInstall: () => "pnpm install --frozen-lockfile" },
    { pm: "npm", lockfile: "package-lock.json", frozenInstall: () => "npm ci" },
    {
      pm: "yarn",
      lockfile: "yarn.lock",
      frozenInstall: (hubPath) =>
        fs.existsSync(path.join(hubPath, ".yarnrc.yml")) ? "yarn install --immutable" : "yarn install --frozen-lockfile",
    },
    { pm: "bun", lockfile: "bun.lock", frozenInstall: () => "bun install --frozen-lockfile" },
    { pm: "bun", lockfile: "bun.lockb", frozenInstall: () => "bun install --frozen-lockfile" },
  ];

  applies(hubPath: string): boolean {
    return this.exists(hubPath, "package.json");
  }

  policy(hubPath: string): DepPolicy {
    const row = NodeRule.LOCKFILES.find((r) => this.exists(hubPath, r.lockfile));
    if (!row) {
      // package.json without a lockfile: no reproducible frozen install —
      // v0 stays out (the agent self-repairs; add a row when a story needs it).
      return { strategy: "none", source: "node:manifest-without-lockfile" };
    }
    return {
      strategy: "clone",
      depDirs: ["node_modules"],
      lockfile: row.lockfile,
      fallback: {
        strategy: "install",
        command: row.frozenInstall(hubPath),
        timeoutMs: DEFAULT_SETUP_TIMEOUT_MS,
        source: `node:${row.pm}:frozen-install`,
      },
      timeoutMs: DEFAULT_SETUP_TIMEOUT_MS,
      source: `node:${row.pm}:clone`,
    };
  }
}

/**
 * Resolves a repo's dependency-setup policy: overrides first, then the
 * ecosystem table, then none. Stateless beyond its rule table — safe to share
 * as a singleton (same pattern as localGit / worktrees).
 */
export class DepPolicyResolver {
  /** The ecosystem table — adding an ecosystem is appending a rule here. */
  private readonly rules: EcosystemRule[] = [
    new NodeRule(),
    // Other ecosystems (Cargo.toml, go.mod, pyproject.toml, …) default to
    // `none` in v0 — the genericity guardrail: the core must work with zero
    // ecosystem rows. Add rules here (never engine/node logic) when their
    // stories land.
  ];

  resolve(input: {
    hubPath: string;
    overrides?: RepoDepOverrides | null;
  }): DepPolicy {
    const overrides = input.overrides ?? {};
    // 1. per-repo overrides win over everything — odd repos are configuration
    if (overrides.skip_install) {
      return { strategy: "none", source: "override:skip_install" };
    }
    const installCommand = overrides.install_command?.trim();
    if (installCommand) {
      return {
        strategy: "command",
        command: installCommand,
        timeoutMs: DEFAULT_SETUP_TIMEOUT_MS,
        source: "override:install_command",
      };
    }
    // 2. recognized ecosystem rules
    for (const rule of this.rules) {
      if (rule.applies(input.hubPath)) return rule.policy(input.hubPath);
    }
    // 3. nothing recognizable
    return { strategy: "none", source: "no recognized manifest+lockfile" };
  }

  // ── path-list / glob helpers (shared with the setup executor) ────────────

  /** Split a free-form path-list field (`sync_paths` / `shared_dirs`). */
  parsePathList(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Effective config-sync globs: the per-repo override, else the defaults. */
  resolveSyncGlobs(overrides?: RepoDepOverrides | null): string[] {
    const parsed = this.parsePathList(overrides?.sync_paths);
    return parsed.length ? parsed : [...DEFAULT_SYNC_GLOBS];
  }

  /**
   * Expand globs against a tree into concrete relative paths (files and
   * directories). Bounded walk: skips .git/node_modules, depth 4, 5000 entries.
   */
  expandSyncPaths(
    treePath: string,
    globs: string[],
    opts: { maxDepth?: number; maxEntries?: number } = {}
  ): string[] {
    const regexes = globs.map(globToRegExp).filter((r) => r.source !== "^$");
    if (!regexes.length) return [];
    const maxDepth = opts.maxDepth ?? 4;
    const maxEntries = opts.maxEntries ?? 5000;
    const out: string[] = [];
    let seen = 0;
    const matches = (rel: string) => regexes.some((re) => re.test(rel));
    const walk = (rel: string, depth: number): void => {
      if (depth > maxDepth || seen > maxEntries) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(treePath, rel || "."), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (++seen > maxEntries) return;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (SKIP_WALK_DIRS.has(e.name)) continue;
        const isDir = e.isDirectory();
        // match before descending — and descend REGARDLESS: a glob with a
        // separator ("config/*.ini") needs non-matching parents walked
        if (matches(r)) out.push(r);
        if (isDir) walk(r, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  /** Lockfile fingerprint used by the executor's clone gate (sha256 of bytes). */
  hashFile(p: string): string | null {
    try {
      return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    } catch {
      return null;
    }
  }
}

/** Shared dep-policy resolver (stateless enough for a module-scoped singleton). */
export const depPolicies = new DepPolicyResolver();
