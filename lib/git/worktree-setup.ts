import { exec, execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { worktrees } from "./worktrees";
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

export interface WorktreeSetupProbeResult {
  /** false = the worktree create or the setup failed (see `error`) */
  ok: boolean;
  error?: string;
  /** what the REAL setup did (lifecycle-action strings, in order) */
  actions: string[];
  /** the throwaway worktree (present whenever it got created, even on failure) */
  worktree?: string;
  branch?: string;
  /** set when the post-run cleanup couldn't fully finish (surfaced, not swallowed) */
  cleanup?: string;
  durationMs: number;
}

export interface WorktreeSetupProbeInput {
  /** the hub: the developer's real checkout the probe sets up from */
  hubPath: string;
  /** the same overrides shape the engine maps from the repo row */
  overrides?: RepoDepOverrides | null;
  /** base ref the throwaway branch starts from (the form's default branch) */
  base?: string;
  /** the dir the throwaway worktree is created in (the DevFlow workspace — sweep-compatible) */
  baseDir: string;
  /** `git worktree add` timeout override (ms) for very large checkouts */
  addTimeoutMs?: number;
  /** live progress (each setup step, worktree create and cleanup) — streamed to the form */
  onEvent?: (message: string) => void;
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
   * Probe the setup END-TO-END (the repo form's "Test setup" button): create a
   * real throwaway worktree, run the FULL setup pipeline in it, then remove
   * the worktree and its branch again. Unlike static checks this executes the
   * actual strategy — installs really run, copies/symlinks really happen — so
   * a green result proves the repo's worktree setup works before any flow
   * relies on it. Cleanup runs even on failure and its shortfalls are
   * surfaced, never swallowed; a leftover is picked up by the startup sweep
   * (the probe dir lives in the DevFlow workspace, flow-named entries excepted).
   */
  async probe(input: WorktreeSetupProbeInput): Promise<WorktreeSetupProbeResult> {
    const startedAt = Date.now();
    const hub = path.resolve(input.hubPath);
    const done = (r: Omit<WorktreeSetupProbeResult, "durationMs">): WorktreeSetupProbeResult =>
      ({ ...r, durationMs: Date.now() - startedAt });

    if (!fs.existsSync(path.join(hub, ".git"))) {
      return done({ ok: false, error: `${hub} is not a git checkout (no .git)`, actions: [] });
    }
    const baseDir = input.baseDir ? path.resolve(input.baseDir) : null;
    if (!baseDir) return done({ ok: false, error: "probe workspace dir is not configured", actions: [] });
    // the workspace root may not exist yet on a fresh install — create it (the
    // engine creates it on first flow; creating it here is sweep-compatible)
    fs.mkdirSync(baseDir, { recursive: true });

    const overrides = input.overrides ?? {};
    const policy = depPolicies.resolve({ hubPath: hub, overrides });
    const emit = input.onEvent ?? (() => {});
    const id = `setup-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = path.join(baseDir, id);
    const branch = `devflow/${id}`;
    const actions: string[] = [];

    let created = false;
    let setupError: string | undefined;
    try {
      emit(`creating throwaway worktree ${id} (branch ${branch})…`);
      await worktrees.createWorktree({
        repoPath: hub,
        dir,
        branch,
        base: input.base,
        addTimeoutMs: input.addTimeoutMs,
      });
      created = true;
      actions.push(`created throwaway worktree ${id} (branch ${branch})`);
      emit(actions[0]);
      const setup = await this.run({
        hubPath: hub,
        worktreePath: dir,
        policy,
        syncGlobs: depPolicies.resolveSyncGlobs(overrides),
        sharedDirs: depPolicies.parsePathList(overrides.shared_dirs),
        setupCommand: overrides.setup_command ?? null,
        onEvent: emit,
      });
      actions.push(...setup.actions);
      if (!setup.ok) {
        setupError = setup.error ?? "unknown setup failure";
        emit(`setup failed: ${setupError}`);
      }
    } catch (e: unknown) {
      setupError = created ? `setup threw: ${message(e)}` : `worktree create failed: ${message(e)}`;
      emit(setupError);
    }

    let cleanup: string | undefined;
    if (created) {
      emit("removing throwaway worktree…");
      try {
        const removal = await worktrees.removeWorktree({
          repoPath: hub,
          wtPath: dir,
          home: os.homedir(),
          force: true, // the probe is throwaway; setup output is the report, not the work product
          deleteBranch: true,
          // the probe branch is seconds old and only the setup ran in it —
          // nothing mergeable can live there, so the delete is forced
          forceBranchDelete: true,
        });
        if (!removal.dirGone) {
          cleanup = `worktree ${dir} could not be fully removed — the sweep picks it up later`;
        } else if (removal.branchDeleted === false) {
          cleanup = `branch ${branch} kept (${removal.branchKeptReason ?? "unmerged"})`;
        }
        if (!cleanup) {
          emit("throwaway worktree removed");
        }
      } catch (e: unknown) {
        cleanup = `cleanup failed: ${message(e)} — the sweep picks up ${dir} later`;
      }
      if (cleanup) emit(cleanup);
    }

    return done({
      ok: !setupError,
      error: setupError,
      actions,
      worktree: created ? dir : undefined,
      branch,
      cleanup,
    });
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
