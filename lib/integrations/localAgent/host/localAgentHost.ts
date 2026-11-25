import "server-only";

import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { AgentHostExitError, AgentRunLookupError } from "../../../engine/ports/agentErrors";
import { UpstreamError } from "../../../errors";
import type { AgentRunResult, ModelSelection } from "../../cursorSdk";
import type { StreamCallbacks } from "../../utils/sdkMessageDispatch";
import { buildAgentHostEnv } from "./agentHostEnv";
import { parseAgentHostChildMessage } from "./agentHostMessages";
import { AGENT_HOST_MESSAGE_KINDS } from "./constants/agentHostMessageKinds";
import type { LocalAgentHostOptions, LocalAgentHostRunInput } from "./types/localAgentHostTypes";
import type {
  AgentHostChildMessage,
  AgentHostEvent,
  AgentHostParentMessage,
} from "./types/agentHostProtocol";

/** How the stream of one hosted run settles. */
type HostStreamOutcome =
  | { ok: true; result: AgentRunResult }
  | { ok: false; error: unknown };

/** One forked child process and its run state. */
interface HostedRun {
  child: ChildProcess;
  agentId: string;
  runId: string;
  /** events that arrived before `streamRun` attached — start and stream are
   *  separate AgentPort calls, and the child can run ahead of the stream. */
  buffered: AgentHostEvent[];
  consumer: StreamCallbacks | null;
  /** a result/error/exit arrived before `streamRun` attached */
  pendingOutcome: HostStreamOutcome | null;
  /** one-shot: a result, error or exit already settled this run's stream */
  settledStream: boolean;
  settle: ((result: AgentRunResult) => void) | null;
  fail: ((error: unknown) => void) | null;
  resolveStart: ((started: { agentId: string; runId: string }) => void) | null;
  rejectStart: ((error: unknown) => void) | null;
  killTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Local agent host (docs/local-agents-in-worker-plan.md): forks ONE child
 * process (`worker/agentHost/main.ts`, run under tsx) per local agent run, so
 * the agent loop — and every shell it spawns — runs in a scrubbed environment
 * instead of inheriting the DevFlow server's NODE_ENV and secrets.
 *
 * The parent owns the run handle map exactly like the in-process runtime did:
 * `hasActiveRun` is the in-memory fast-path, a restart means the handle is
 * gone, and recovery probes the SDK's persisted local store via
 * `inspectSession` — unchanged semantics, the runs just live one IPC hop away.
 * The child dies with this process (its `disconnect` handler cancels and
 * exits), so no orphaned agent keeps editing files.
 *
 * Process-bound (live child handles) — pinned via the process-services
 * container by `lib/integrations/localAgent/agent.ts`.
 */
export class LocalAgentHost {
  private static readonly KILL_GRACE_MS = 5_000;

  private readonly runs = new Map<string, HostedRun>();

  constructor(
    private readonly options: LocalAgentHostOptions = LocalAgentHost.defaultOptions(),
  ) {}

  private static defaultOptions(): LocalAgentHostOptions {
    return {
      // the web and worker processes both run from the repo root
      childModulePath: path.resolve(process.cwd(), "worker/agentHost/main.ts"),
      tsconfigPath: path.resolve(process.cwd(), "worker/tsconfig.json"),
      killGraceMs: LocalAgentHost.KILL_GRACE_MS,
    };
  }

  /** Fork the child for one run, send `start`, resolve on `started`. */
  createRun(input: LocalAgentHostRunInput): Promise<{ agentId: string; runId: string }> {
    // Record-typed first so the ProcessEnv cast below is a plain overlap (the
    // scrub deliberately drops NODE_ENV, which Next's augmentation requires)
    const childEnv: Record<string, string> = {
      ...buildAgentHostEnv(process.env, input.env),
      TSX_TSCONFIG_PATH: this.options.tsconfigPath,
    };
    const child = fork(this.options.childModulePath, [], {
      execArgv: ["--import", "tsx"],
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const run: HostedRun = {
      child,
      agentId: "",
      runId: "",
      buffered: [],
      consumer: null,
      pendingOutcome: null,
      settledStream: false,
      settle: null,
      fail: null,
      resolveStart: null,
      rejectStart: null,
      killTimer: null,
    };
    const started = new Promise<{ agentId: string; runId: string }>((resolveStart, rejectStart) => {
      run.resolveStart = resolveStart;
      run.rejectStart = rejectStart;
    });
    child.on("message", (raw: unknown) => this.handleChildMessage(run, raw));
    child.on("exit", (code, signal) => this.handleChildExit(run, code, signal));
    child.on("error", (err: Error) => this.handleChildExit(run, null, null, err.message));
    child.send(LocalAgentHost.startMessage(input));
    return started;
  }

  /** Stream a run to completion, replaying events buffered before attach. */
  async streamRun(
    runId: string,
    cb: StreamCallbacks = {},
  ): Promise<{ result: AgentRunResult; agentId: string }> {
    const run = this.runs.get(runId);
    if (!run) throw new AgentRunLookupError(`unknown run ${runId} (server restarted?)`, runId);
    try {
      return await new Promise<{ result: AgentRunResult; agentId: string }>((resolve, reject) => {
        run.settle = (result) => resolve({ result, agentId: run.agentId });
        run.fail = reject;
        for (const event of run.buffered) LocalAgentHost.dispatchEvent(cb, event);
        run.buffered = [];
        run.consumer = cb;
        if (run.pendingOutcome) {
          const outcome = run.pendingOutcome;
          run.pendingOutcome = null;
          LocalAgentHost.applyOutcome(run, outcome);
        }
      });
    } finally {
      // mirror the in-process runtime: the handle is dropped once the stream
      // settles — the child has already exited or is exiting
      this.releaseRun(runId);
    }
  }

  /** Ask the child to cancel; SIGTERM it if it doesn't exit within the grace period. */
  async cancelRun(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run) return false;
    const delivered = run.child.send({ kind: AGENT_HOST_MESSAGE_KINDS.CANCEL });
    this.clearKillTimer(run);
    run.killTimer = setTimeout(() => run.child.kill("SIGTERM"), this.options.killGraceMs);
    return delivered;
  }

  /** True when this process still owns the given in-flight run. */
  hasActiveRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  /** Drop the handle and kill the child (idempotent; leak guard when start() never streams). */
  releaseRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    this.clearKillTimer(run);
    // a settled run's child is exiting on its own — SIGTERM only live runs
    if (!run.settledStream) run.child.kill("SIGTERM");
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private static startMessage(input: LocalAgentHostRunInput): AgentHostParentMessage {
    return {
      kind: AGENT_HOST_MESSAGE_KINDS.START,
      apiKey: input.apiKey,
      cwd: input.cwd,
      prompt: input.prompt,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.model ? { model: input.model satisfies ModelSelection } : {}),
      sandbox: input.sandbox,
      force: input.force,
      ...(input.resumeAgentId ? { resumeAgentId: input.resumeAgentId } : {}),
      ...(input.settingSources?.length ? { settingSources: input.settingSources } : {}),
    };
  }

  private handleChildMessage(run: HostedRun, raw: unknown): void {
    let msg: AgentHostChildMessage;
    try {
      msg = parseAgentHostChildMessage(raw);
    } catch (e) {
      // protocol violation — fail the run and kill the broken child
      this.failRun(run, e);
      run.child.kill("SIGTERM");
      return;
    }
    switch (msg.kind) {
      case AGENT_HOST_MESSAGE_KINDS.STARTED:
        run.agentId = msg.agentId;
        run.runId = msg.runId;
        this.runs.set(msg.runId, run);
        run.resolveStart?.({ agentId: msg.agentId, runId: msg.runId });
        break;
      case AGENT_HOST_MESSAGE_KINDS.EVENT:
        if (run.consumer) LocalAgentHost.dispatchEvent(run.consumer, msg.event);
        else run.buffered.push(msg.event);
        break;
      case AGENT_HOST_MESSAGE_KINDS.RESULT:
        this.settleStream(run, { ok: true, result: msg.result });
        break;
      case AGENT_HOST_MESSAGE_KINDS.ERROR:
        // before `started` it rejects createRun; after it, streamRun
        this.failRun(run, new UpstreamError(msg.message));
        break;
    }
  }

  private handleChildExit(
    run: HostedRun,
    code: number | null,
    signal: string | null,
    reason?: string,
  ): void {
    if (reason) console.error(`[local-agent-host] child process error: ${reason}`);
    if (run.runId && this.runs.get(run.runId) === run) {
      if (run.pendingOutcome || run.settledStream) return; // stream not attached yet / already settled
      this.settleStream(run, {
        ok: false,
        error: new AgentHostExitError(run.runId, code, signal),
      });
      return;
    }
    run.rejectStart?.(new AgentHostExitError(run.runId || null, code, signal));
  }

  private failRun(run: HostedRun, error: unknown): void {
    if (!run.runId) {
      run.rejectStart?.(error);
      return;
    }
    this.settleStream(run, { ok: false, error });
  }

  /** One-shot settlement of the run's stream — applied live or parked until `streamRun` attaches. */
  private settleStream(run: HostedRun, outcome: HostStreamOutcome): void {
    if (run.settledStream) return;
    run.settledStream = true;
    this.clearKillTimer(run);
    if (run.settle) {
      LocalAgentHost.applyOutcome(run, outcome);
    } else {
      run.pendingOutcome = outcome;
    }
  }

  private static applyOutcome(run: HostedRun, outcome: HostStreamOutcome): void {
    const settle = run.settle;
    const fail = run.fail;
    run.settle = null;
    run.fail = null;
    if (outcome.ok) settle?.(outcome.result);
    else fail?.(outcome.error);
  }

  private static dispatchEvent(cb: StreamCallbacks, event: AgentHostEvent): void {
    switch (event.type) {
      case "status":
        cb.onStatus?.(event.status);
        break;
      case "assistant":
        cb.onAssistant?.(event.text);
        break;
      case "thinking":
        cb.onThinking?.(event.text);
        break;
      case "tool":
        cb.onTool?.(event.name, event.status, event.args, event.callId, {
          result: event.result,
          truncated: event.truncated,
        });
        break;
    }
  }

  private clearKillTimer(run: HostedRun): void {
    if (run.killTimer) {
      clearTimeout(run.killTimer);
      run.killTimer = null;
    }
  }
}
