import { exec, execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  COMMON_CACHE_DIRS,
  DEFAULT_SETUP_TIMEOUT_MS,
  DEFAULT_SYNC_GLOBS,
  depPolicies,
  type DepPolicy,
  type DepStrategy,
  type RepoDepOverrides,
} from "./dep-policy";
import { containsPath, samePath } from "./worktrees";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 10;
const COPY_TIMEOUT_MS = 120_000;

export interface WorktreeSetupInput {
  /** the hub: the developer's real checkout (source of deps, config, caches) */
  hubPath: string;
  /** the flow's git worktree (setup target) */
  worktreePath: string;
  /** the resolved dependency-setup policy (dep-policy.ts) */
  policy: DepPolicy;
  /** untracked-config globs synced hub → worktree (copied, NEVER symlinked) */
  syncGlobs?: string[];
  /** per-repo `shared_dirs`: symlinked hub → worktree BEFORE setup */
  sharedDirs?: string[];
  /** warm caches copied from the hub when present (default: COMMON_CACHE_DIRS) */
  cacheDirs?: string[];
  /** per-repo `setup_command` escape valve — always runs after the strategy */
  setupCommand?: string | null;
  /** progress callback (the engine maps it to lifecycle events) */
  onEvent?: (message: string) => void;
}

export interface WorktreeSetupResult {
  /** false = non-fatal: the caller surfaces `error` to the agent's prompt */
  ok: boolean;
  error?: string;
  /** human-readable summary of what ran (lifecycle events) */
  actions: string[];
}

/** One advisory check line of a setup dry-run (the repo form's "Test setup"). */
export interface SetupDryRunCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface WorktreeSetupDryRunResult {
  /** false = at least one check failed (the detail carries the reason) */
  ok: boolean;
  checks: SetupDryRunCheck[];
}

export interface WorktreeSetupDryRunInput {
  /** the hub: the developer's real checkout the policy resolves against */
  hubPath: string;
  /** the same overrides shape the engine maps from the repo row */
  overrides?: RepoDepOverrides | null;
}

/** Ambient facts every step needs (resolved once by WorktreeSetup.run). */
interface SetupContext {
  hub: string;
  wt: string;
  emit: (message: string) => void;
}

/**
 * One ordered step of worktree setup. A step either completes (returns
 * human-readable actions) or throws — the executor turns a throw into the
 * non-fatal `{ ok: false, error }` result (never thrown past the engine).
 */
abstract class SetupStep {
  protected constructor(
    protected readonly ctx: SetupContext
  ) {}

  abstract readonly label: string;
  abstract run(): Promise<string[]>;
}

/**
 * Per-repo `shared_dirs` — the ONE sanctioned symlink surface, created BEFORE
 * setup so tools find them ready. Relative links (no absolute-path leaks),
 * never over an existing worktree path (tracked files are never shadowed).
 */
class SharedDirsStep extends SetupStep {
  readonly label = "shared dirs";
  constructor(
    ctx: SetupContext,
    private readonly specs: string[]
  ) {
    super(ctx);
  }

  async run(): Promise<string[]> {
    const actions: string[] = [];
    for (const spec of this.specs) {
      const src = path.join(this.ctx.hub, spec);
      const dst = path.join(this.ctx.wt, spec);
      if (!fs.lstatSync(src).isDirectory()) {
        throw new Error("shared_dirs entries must be directories in the hub");
      }
      if (fs.existsSync(dst)) continue; // existing (tracked or prior) — never shadow
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.symlinkSync(path.relative(path.dirname(dst), src), dst, "dir");
      actions.push(`linked shared dir ${spec} → hub`);
      this.ctx.emit(`linked shared dir ${spec} from the hub`);
    }
    return actions;
  }
}

/**
 * Untracked-config sync — copy, never symlink (agents must not be able to
 * mutate real hub files through a link). copyFileSync dereferences, so even a
 * hub-side .env symlink lands as plain content.
 */
class ConfigSyncStep extends SetupStep {
  readonly label = "config sync";
  constructor(
    ctx: SetupContext,
    private readonly globs: string[]
  ) {
    super(ctx);
  }

  async run(): Promise<string[]> {
    const copied: string[] = [];
    for (const rel of depPolicies.expandSyncPaths(this.ctx.hub, this.globs)) {
      const src = path.join(this.ctx.hub, rel);
      const dst = path.join(this.ctx.wt, rel);
      if (fs.existsSync(dst)) continue; // never clobber checked-out tracked files
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.lstatSync(src).isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, dereference: true });
      } else {
        fs.copyFileSync(src, dst);
      }
      copied.push(rel);
    }
    if (copied.length) {
      this.ctx.emit(`synced ${copied.length} untracked config path(s) from the hub`);
    }
    return copied.length ? [`synced config: ${copied.join(", ")}`] : [];
  }
}

/**
 * Warm-build caches copied from the hub when present. Best-effort by design:
 * a miss or a failed copy never fails setup.
 */
class CacheCopyStep extends SetupStep {
  readonly label = "warm caches";
  constructor(
    ctx: SetupContext,
    private readonly dirs: string[]
  ) {
    super(ctx);
  }

  async run(): Promise<string[]> {
    const actions: string[] = [];
    for (const dir of this.dirs) {
      const src = path.join(this.ctx.hub, dir);
      const dst = path.join(this.ctx.wt, dir);
      if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
      try {
        await copyDirCoW(src, dst);
        actions.push(`copied cache ${dir} from the hub`);
        this.ctx.emit(`copied cache ${dir} from the hub`);
      } catch (e: unknown) {
        this.ctx.emit(`cache ${dir} not copied: ${message(e)}`);
      }
    }
    return actions;
  }
}

/**
 * The dependency-setup strategy — polymorphic runners instead of if-chains.
 * `DepPolicyStep` looks the runner up in the strategy table below.
 */
abstract class DepStrategyRunner {
  constructor(protected readonly policy: DepPolicy) {}
  abstract run(hub: string, wt: string, emit: (m: string) => void): Promise<string[]>;
}

/** `none`: nothing to materialize. */
class NoneStrategy extends DepStrategyRunner {
  async run(): Promise<string[]> {
    return this.policy.source === "no recognized manifest+lockfile"
      ? [] // nothing recognizable — stay silent (non-JS repos don't need a note)
      : ["no dependency setup required"];
  }
}

/** `command` / `install` / `store-install`: one shell command in the worktree. */
class CommandStrategy extends DepStrategyRunner {
  async run(_hub: string, wt: string, emit: (m: string) => void): Promise<string[]> {
    if (!this.policy.command) throw new Error(`${this.policy.strategy} policy without a command`);
    emit(`running: ${this.policy.command}`);
    await runCommand(this.policy.command, wt, this.policy.timeoutMs);
    return [`ran: ${this.policy.command}`];
  }
}

/**
 * `clone`: copy dep dirs hub → worktree (instant CoW when the fs allows). The
 * gate is proven HERE, not assumed: hub dep dirs must exist and hub/worktree
 * lockfile hashes must match — a stale copy would ship unshippable resolution,
 * so the recorded frozen-install fallback is the honest path.
 */
class CloneStrategy extends DepStrategyRunner {
  async run(hub: string, wt: string, emit: (m: string) => void): Promise<string[]> {
    const gate = this.gate(hub, wt);
    if (!gate.usable) {
      if (!this.policy.fallback) {
        throw new Error(`${gate.reason} and no fallback configured`);
      }
      emit(`${gate.reason} — falling back to: ${this.policy.fallback.command ?? this.policy.fallback.strategy}`);
      return await depStrategyRunners.run(this.policy.fallback, hub, wt, emit);
    }
    const actions: string[] = [];
    for (const dir of this.policy.depDirs ?? []) {
      const dst = path.join(wt, dir);
      if (fs.existsSync(dst)) {
        actions.push(`${dir} already present in the worktree`);
        continue;
      }
      emit(`copying ${dir} from the hub`);
      await copyDirCoW(path.join(hub, dir), dst);
      actions.push(`copied ${dir} from the hub`);
    }
    return actions;
  }

  private gate(hub: string, wt: string): { usable: boolean; reason: string } {
    for (const dir of this.policy.depDirs ?? []) {
      if (!fs.existsSync(path.join(hub, dir))) {
        return { usable: false, reason: `hub has no ${dir}` };
      }
    }
    const lockfile = this.policy.lockfile;
    if (!lockfile) return { usable: true, reason: "" };
    const hubHash = depPolicies.hashFile(path.join(hub, lockfile));
    const wtHash = depPolicies.hashFile(path.join(wt, lockfile));
    if (!hubHash) return { usable: false, reason: `hub ${lockfile} unreadable` };
    if (!wtHash) return { usable: false, reason: `worktree ${lockfile} missing` };
    return hubHash !== wtHash
      ? { usable: false, reason: `hub and worktree ${lockfile} differ` }
      : { usable: true, reason: "" };
  }
}

/** The strategy table: strategy name → runner class (extend, don't branch). */
class DepStrategyTable {
  private readonly runners: Record<DepStrategy, new (policy: DepPolicy) => DepStrategyRunner> = {
    none: NoneStrategy,
    command: CommandStrategy,
    install: CommandStrategy,
    "store-install": CommandStrategy,
    clone: CloneStrategy,
  };

  /** Execute a policy through its runner (clone fallbacks recurse through here). */
  async run(policy: DepPolicy, hub: string, wt: string, emit: (m: string) => void): Promise<string[]> {
    const Runner = this.runners[policy.strategy];
    if (!Runner) throw new Error(`no runner for dep strategy ${policy.strategy}`);
    return await new Runner(policy).run(hub, wt, emit);
  }
}

const depStrategyRunners = new DepStrategyTable();

/** The dep-policy step: executes the resolved strategy. */
class DepPolicyStep extends SetupStep {
  readonly label = "deps";
  constructor(
    ctx: SetupContext,
    private readonly policy: DepPolicy
  ) {
    super(ctx);
  }

  async run(): Promise<string[]> {
    return await depStrategyRunners.run(this.policy, this.ctx.hub, this.ctx.wt, this.ctx.emit);
  }
}

/**
 * Per-repo `setup_command` — the explicit escape valve (Orca's scripts.setup
 * analog). Always runs last, for every strategy.
 */
class SetupCommandStep extends SetupStep {
  readonly label = "setup command";
  constructor(
    ctx: SetupContext,
    private readonly command: string
  ) {
    super(ctx);
  }

  async run(): Promise<string[]> {
    this.ctx.emit(`running setup command: ${this.command}`);
    await runCommand(this.command, this.ctx.wt, DEFAULT_SETUP_TIMEOUT_MS);
    return [`ran setup: ${this.command}`];
  }
}

/**
 * The worktree setup executor — PURE layer (no db/engine imports; plain
 * inputs/outputs). The engine's worktree manager resolves the policy and
 * passes it here; progress flows back via the `onEvent` callback.
 *
 * Ordered pipeline (every step time-bounded, every failure non-fatal):
 *  1. symlink per-repo `shared_dirs` (BEFORE setup)
 *  2. copy (never symlink) untracked-config globs from the hub
 *  3. warm-cache copy (best-effort)
 *  4. the dep strategy
 *  5. the per-repo `setup_command`
 *
 * The agent's run prompt gets one line on failure and can self-repair.
 */
export class WorktreeSetup {
  async run(input: WorktreeSetupInput): Promise<WorktreeSetupResult> {
    const actions: string[] = [];
    const emit = input.onEvent ?? (() => {});
    const hub = path.resolve(input.hubPath);
    const wt = path.resolve(input.worktreePath);

    // guards: the copy surface is hub → worktree, never across/nested trees
    if (!fs.existsSync(hub)) return fail(actions, `hub does not exist: ${hub}`);
    if (!fs.existsSync(wt)) return fail(actions, `worktree does not exist: ${wt}`);
    if (samePath(hub, wt)) return fail(actions, "worktree path equals the hub path");
    if (containsPath(wt, hub) || containsPath(hub, wt)) {
      return fail(actions, "hub and worktree must live in separate trees");
    }
    const ctx: SetupContext = { hub, wt, emit };

    let steps: SetupStep[];
    try {
      steps = [
        new SharedDirsStep(ctx, this.sharedDirSpecs(hub, input.sharedDirs)),
        new ConfigSyncStep(ctx, input.syncGlobs?.length ? input.syncGlobs : DEFAULT_SYNC_GLOBS),
        new CacheCopyStep(ctx, input.cacheDirs ?? COMMON_CACHE_DIRS),
        new DepPolicyStep(ctx, input.policy),
      ];
      const setupCommand = input.setupCommand?.trim();
      if (setupCommand) steps.push(new SetupCommandStep(ctx, setupCommand));
    } catch (e: unknown) {
      return fail(actions, message(e));
    }

    for (const step of steps) {
      try {
        actions.push(...(await step.run()));
      } catch (e: unknown) {
        return fail(actions, `${step.label} failed: ${message(e)}`);
      }
    }
    return { ok: true, actions };
  }

  /**
   * Dry-run the setup policy exactly as a fresh worktree would experience it,
   * WITHOUT creating a worktree or touching any state (the repo form's "Test
   * setup" button). Resolution mirrors the engine's setupFlowWorktree: policy
   * from the overrides, sync globs, shared dirs, setup command. Commands are
   * REPORTED, never executed — the result is purely advisory.
   */
  async dryRun(input: WorktreeSetupDryRunInput): Promise<WorktreeSetupDryRunResult> {
    const hub = path.resolve(input.hubPath);
    const overrides = input.overrides ?? {};
    const checks: SetupDryRunCheck[] = [];

    // the hub must be a real git checkout — the source of deps, config, caches
    const hubUsable = fs.existsSync(path.join(hub, ".git"));
    checks.push({
      label: "hub checkout",
      ok: hubUsable,
      detail: hubUsable ? hub : `${hub} is not a git checkout (no .git)`,
    });
    if (!hubUsable) return { ok: false, checks };

    // the dependency strategy: what would materialize deps in a worktree
    const policy = depPolicies.resolve({ hubPath: hub, overrides });
    checks.push({
      label: "dependency strategy",
      ok: true,
      detail:
        `${policy.source} → ${policy.strategy}` +
        (policy.command ? ` — would run: ${policy.command}` : "") +
        (policy.depDirs?.length ? ` — would copy: ${policy.depDirs.join(", ")}` : ""),
    });
    if (policy.strategy === "clone") {
      // the gate's hub-side half; the hub/worktree lockfile match itself can
      // only be verified when a worktree exists, at flow start
      for (const dir of policy.depDirs ?? []) {
        const present = fs.existsSync(path.join(hub, dir));
        checks.push({
          label: `dep dir ${dir}`,
          ok: present,
          detail: present
            ? "present in the hub — copied CoW at flow start"
            : `missing in the hub — a fresh worktree would fall back to ${policy.fallback?.command ?? policy.fallback?.strategy ?? "nothing"}`,
        });
      }
      if (policy.lockfile) {
        const readable = !!depPolicies.hashFile(path.join(hub, policy.lockfile));
        checks.push({
          label: `lockfile ${policy.lockfile}`,
          ok: readable,
          detail: readable
            ? "readable — the hub/worktree hash match is re-verified at flow start"
            : "unreadable — a fresh worktree would fall back to the frozen install",
        });
      }
    }

    // shared_dirs: the one symlink surface (denied/missing entries are config errors)
    const sharedDirs = depPolicies.parsePathList(overrides.shared_dirs);
    if (sharedDirs.length) {
      try {
        const specs = this.sharedDirSpecs(hub, sharedDirs);
        checks.push({
          label: "shared symlinks",
          ok: true,
          detail: specs.length ? `would symlink: ${listCap(specs)}` : "no shared dirs matched",
        });
      } catch (e: unknown) {
        checks.push({ label: "shared symlinks", ok: false, detail: message(e) });
      }
    }

    // untracked-config sync: what the globs would copy from the hub
    const syncGlobs = depPolicies.resolveSyncGlobs(overrides);
    const matched = depPolicies.expandSyncPaths(hub, syncGlobs);
    checks.push({
      label: "config sync",
      ok: true,
      detail: matched.length
        ? `${matched.length} path(s) matched: ${listCap(matched)}`
        : `no paths matched: ${syncGlobs.join(", ")}`,
    });

    // warm caches: which of the common cache dirs exist to copy
    const warm = COMMON_CACHE_DIRS.filter((dir) => fs.existsSync(path.join(hub, dir)));
    checks.push({
      label: "warm caches",
      ok: true,
      detail: warm.length ? `would copy: ${warm.join(", ")}` : "none present (fine)",
    });

    // setup_command: reported, never executed here
    const setupCommand = overrides.setup_command?.trim();
    checks.push({
      label: "setup command",
      ok: true,
      detail: setupCommand ? `would run after the strategy: ${setupCommand}` : "none configured",
    });

    return { ok: checks.every((c) => c.ok), checks };
  }

  /** Denylist: dep trees must NEVER be symlinked into the hub's dep state. */
  private static readonly DENIED_SHARED_DIRS = new Set(["node_modules", ".git"]);

  /**
   * Expand the shared_dirs spec (globs allowed) into hub-relative paths.
   * Plain paths must exist (a typo is a config error, surfaced non-fatally);
   * a glob matching nothing is fine (misses are fine).
   */
  private sharedDirSpecs(hub: string, sharedDirs?: string[]): string[] {
    const out: string[] = [];
    for (const raw of sharedDirs ?? []) {
      for (const spec of depPolicies.parsePathList(raw)) {
        if (WorktreeSetup.DENIED_SHARED_DIRS.has(spec)) {
          throw new Error(`refusing to symlink ${spec} — dep trees must be copied, never linked`);
        }
        if (/[*?]/.test(spec)) {
          out.push(...depPolicies.expandSyncPaths(hub, [spec]));
        } else {
          if (!fs.existsSync(path.join(hub, spec))) {
            throw new Error(`shared dir ${spec} does not exist in the hub`);
          }
          out.push(spec);
        }
      }
    }
    return out;
  }
}

// ── mechanics ───────────────────────────────────────────────────────────────

/** Comma-join capped — dry-run details stay one line, never a dump. */
function listCap(items: string[], max = 10): string {
  return items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} … +${items.length - max} more`;
}

/** Directory copy: instant CoW clone when the fs supports it, plain copy fallback. */
async function copyDirCoW(src: string, dst: string): Promise<void> {
  const flags =
    process.platform === "darwin" ? ["-cR"] : process.platform === "linux" ? ["-aR", "--reflink=auto"] : null;
  if (flags) {
    try {
      await execFileAsync("cp", [...flags, src, dst], { timeout: COPY_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
      return;
    } catch { /* non-clone fs or cp failure — plain copy below */ }
  }
  fs.cpSync(src, dst, { recursive: true, dereference: false });
}

/** Run a shell command in the worktree (time-bounded; never hangs the engine). */
async function runCommand(command: string, cwd: string, timeoutMs?: number): Promise<void> {
  try {
    await execAsync(command, {
      cwd,
      timeout: timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: process.platform === "win32" ? undefined : "/bin/bash",
    });
  } catch (e: unknown) {
    const err = (typeof e === "object" && e !== null ? e : {}) as {
      stderr?: unknown;
      stdout?: unknown;
      message?: unknown;
    };
    const tail = String(err.stderr ?? err.stdout ?? "").trim().slice(-500);
    throw new Error(`${command} (${String(err.message ?? e)})${tail ? ` — ${tail}` : ""}`);
  }
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function fail(actions: string[], error: string): WorktreeSetupResult {
  return { ok: false, error, actions };
}

/** Shared worktree-setup executor (stateless — same pattern as localGit). */
export const worktreeSetup = new WorktreeSetup();
