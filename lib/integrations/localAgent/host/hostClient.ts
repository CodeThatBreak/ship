import "server-only";

import { spawn, type ChildProcess } from "node:child_process";

import { cursorCredentials } from "../../cursor/credentials";
import {
  HOST_CALL_TIMEOUT_MS,
  HOST_ENTRY,
  HOST_TSCONFIG,
  HOST_TSX_BIN,
  REPO_ROOT,
} from "./constants/hostPaths";
import { LocalAgentHostError } from "./hostErrors";
import type { HostMethod, HostOutbound, HostRequestMap, HostStreamEvent } from "./protocol";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onEvent?: (event: HostStreamEvent) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Supervisor for the local-agent host process (client side).
 *
 * The host (`worker/localAgentHost.ts`) owns local agent runs so their shells do
 * not inherit this Next process's `NODE_ENV` — see `protocol.ts` for why that
 * matters. This class owns the child's lifecycle: spawn on first use, JSON-RPC
 * over IPC, one in-flight map keyed by request id, and a shutdown that fails
 * every pending call.
 *
 * Must never: run agent work in-process (that defeats the point), spawn more
 * than one host per web process, or leave a rejected call hanging — every
 * failure path settles its pending entries.
 */
export class LocalAgentHostClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private spawnFailure: Error | null = null;
  /**
   * Run ids this client started and has not released — a synchronous mirror of
   * the host's handles. The reconciler asks {@link hasActiveRun} whether a run
   * is genuinely alive (a yes means leave it alone), so this cannot be a
   * round-trip; a stale entry only delays recovery to the next pass, while a
   * missing one would fail a live run.
   */
  private readonly activeRuns = new Set<string>();

  /** True when the SDK can run at all (API key stored, Node new enough, host up). */
  async available(): Promise<boolean> {
    if (!(await cursorCredentials.isStored())) return false;
    const [maj, min] = process.versions.node.split(".").map((n) => parseInt(n, 10));
    if (!(maj > 22 || (maj === 22 && min >= 13))) return false;
    try {
      return await this.call("available", {});
    } catch {
      return false;
    }
  }

  async start(params: HostRequestMap["start"]["params"]): Promise<HostRequestMap["start"]["result"]> {
    const started = await this.call("start", params);
    this.activeRuns.add(started.runId);
    return started;
  }

  stream(
    runId: string,
    onEvent: (event: HostStreamEvent) => void,
  ): Promise<HostRequestMap["stream"]["result"]> {
    return this.call("stream", { runId }, onEvent).finally(() => {
      // a streamed run is no longer in flight whatever the outcome — the host
      // releases its handle in the same call
      this.activeRuns.delete(runId);
    });
  }

  cancel(runId: string): Promise<boolean> {
    return this.call("cancel", { runId });
  }

  release(runId: string): void {
    this.activeRuns.delete(runId);
    // fire-and-forget: a failed release is a leak guard, never a run failure
    void this.call("release", { runId }).catch(() => {});
  }

  /** Synchronous liveness check for the reconciler (see {@link activeRuns}). */
  hasActiveRun(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  inspect(
    sessionId: string,
    runId: string,
    workspace: string,
  ): Promise<HostRequestMap["inspect"]["result"]> {
    return this.call("inspect", { sessionId, runId, workspace });
  }

  catalog(): Promise<HostRequestMap["catalog"]["result"]> {
    return this.call("catalog", {});
  }

  /** Terminate the host and fail every in-flight call. */
  shutdown(): void {
    const child = this.child;
    this.child = null;
    this.activeRuns.clear();
    this.failAll(new LocalAgentHostError("local agent host shut down"));
    if (child && !child.killed) child.kill("SIGTERM");
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private ensureHost(): ChildProcess {
    if (this.child && !this.child.killed && this.child.connected) return this.child;
    if (this.spawnFailure) throw this.spawnFailure;

    const child = spawn(HOST_TSX_BIN, ["--tsconfig", HOST_TSCONFIG, HOST_ENTRY], {
      cwd: REPO_ROOT,
      // The FULL env: `lib/config.ts` resolves the database URL and the at-rest
      // key from NODE_ENV, so the host must boot with the same mode as this
      // process or it would attach to a different database. The host strips
      // NODE_ENV from its own `process.env` AFTER config resolves — that is
      // what keeps it out of the agent's shell (`worker/localAgentHost.ts`).
      env: process.env,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.child = child;

    child.on("message", (message: unknown) => this.receive(message as HostOutbound));
    child.on("error", (error: Error) => {
      this.spawnFailure = new LocalAgentHostError(`could not start the local agent host: ${error.message}`);
      this.failAll(this.spawnFailure);
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      this.failAll(
        new LocalAgentHostError(
          `local agent host exited (${signal ? `signal ${signal}` : `code ${String(code)}`}) — the run was interrupted`,
        ),
      );
    });
    return child;
  }

  private call<M extends HostMethod>(
    method: M,
    params: HostRequestMap[M]["params"],
    onEvent?: (event: HostStreamEvent) => void,
    timeoutMs: number = HOST_CALL_TIMEOUT_MS,
  ): Promise<HostRequestMap[M]["result"]> {
    let child: ChildProcess;
    try {
      child = this.ensureHost();
    } catch (e: unknown) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const id = this.nextId++;
    const request = { type: "request" as const, id, method, params };
    return new Promise<HostRequestMap[M]["result"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LocalAgentHostError(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent, timer });
      child.send(request, (error?: Error | null) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new LocalAgentHostError(`could not reach the local agent host: ${error.message}`));
      });
    });
  }

  private receive(message: HostOutbound): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === "event") {
      pending.onEvent?.(message.event);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new LocalAgentHostError(message.error));
  }

  private failAll(error: Error): void {
    this.activeRuns.clear();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
