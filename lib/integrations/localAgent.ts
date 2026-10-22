import { spawn, execFile, type ChildProcess } from "child_process";
import fs from "fs";
import readline from "readline";
import { promisify } from "util";
import { config } from "../config";
import { db } from "../db";
import { processSingleton } from "../singleton";
import type { CursorRunResult } from "./cursor";

const exec = promisify(execFile);

export interface LocalAgentInput {
  prompt: string;
  workspace: string; // local repo path
  mode?: "agent" | "plan";
  model?: string;
  branch?: string; // best-effort checkout before starting
  sessionId?: string; // resume a previous local session (follow-ups)
  cwd?: string; // Phase 3C: worktree override (defaults to workspace)
}

export interface LocalEvent {
  kind: "assistant" | "thinking" | "tool" | "status";
  text?: string;
  name?: string;
  status?: string;
  args?: any;
  callId?: string;
  result?: string;
}

/**
 * Token usage for a local run. ACP does not surface token counts (verified
 * against cursor-agent 2026.10.18: `session/prompt` returns only a
 * stopReason), so only durationMs/model are populated. Fields stay optional
 * so consumers can keep one code path with cloud runs.
 */
export interface LocalUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  model?: string;
  raw?: any;
}

export interface LocalRunResult {
  result: CursorRunResult;
  sessionId: string | null;
  usage: LocalUsage | null;
}

export interface LocalSessionInspection {
  /** the last turn finished (ends with assistant text, no dangling tool calls) */
  completed: boolean;
  /** assistant text from the last turn ("" when the turn never produced any) */
  text: string;
}

/**
 * One spawned `cursor-agent acp` process speaking JSON-RPC 2.0 over
 * newline-delimited stdio. Owns the request/response plumbing, the event
 * listener fan-out, and the process lifecycle.
 */
class AcpConnection {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private stderr = "";

  constructor(
    readonly proc: ChildProcess,
    private readonly onNotification: (msg: any) => void,
  ) {
    proc.on("error", (e) =>
      this.failAll(new Error(`spawn failed: ${e.message}`)),
    );
    proc.stderr!.on("data", (c) => (this.stderr += c.toString()));
    readline.createInterface({ input: proc.stdout! }).on("line", (line) => {
      if (!line.trim()) return;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // non-protocol noise on stdout
      }
      // response to one of our requests
      if (
        msg.id != null &&
        msg.method === undefined &&
        (msg.result !== undefined || msg.error !== undefined)
      ) {
        const w = this.pending.get(msg.id);
        if (w) {
          this.pending.delete(msg.id);
          if (msg.error)
            w.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else w.resolve(msg.result);
        }
        return;
      }
      try {
        this.onNotification(msg);
      } catch {
        /* never let a handler error kill the parser */
      }
    });
  }

  get stderrText(): string {
    return this.stderr;
  }

  private write(msg: any): void {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  request<T = any>(method: string, params: any): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  respond(id: number | string, result: any): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  replyError(id: number | string, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code: -32601, message } });
  }

  /** Fire-and-forget JSON-RPC notification. */
  notify(method: string, params: any): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  endStdin(): void {
    try {
      this.proc.stdin!.end();
    } catch {
      /* ignore */
    }
  }

  killAfter(ms: number): void {
    setTimeout(() => {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, ms).unref();
  }
}

/**
 * A live local agent run: the ACP session, buffered events, listeners, and
 * the promise of a final result.
 */
class LocalRunHandle {
  readonly events: LocalEvent[] = [];
  readonly listeners = new Set<() => void>();
  readonly done: Promise<LocalRunResult>;
  sessionId?: string;

  private settle!: (value: LocalRunResult) => void;
  private settleErr!: (err: Error) => void;
  private settled = false;
  private watchdog: NodeJS.Timeout;

  constructor(
    readonly connection: AcpConnection,
    timeoutMs: number,
    private readonly timeoutMinutes: number,
  ) {
    this.done = new Promise<LocalRunResult>((res, rej) => {
      this.settle = res;
      this.settleErr = rej;
    });
    this.watchdog = setTimeout(() => {
      this.fail(
        new Error(
          `local cursor-agent run timed out after ${this.timeoutMinutes}min`,
        ),
      );
    }, timeoutMs);
  }

  push(e: LocalEvent): void {
    this.events.push(e);
    this.listeners.forEach((l) => l());
  }

  finish(value: LocalRunResult): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.watchdog);
    this.push({ kind: "status", status: "FINISHED" });
    this.settle(value);
    this.connection.endStdin();
    this.connection.killAfter(3000);
  }

  fail(err: Error): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.watchdog);
    this.connection.failAll(err);
    this.push({ kind: "status", status: "ERROR" });
    try {
      this.connection.proc.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    this.settleErr(err);
  }
}

/**
 * Local agent integration: spawns and supervises `cursor-agent` CLI runs
 * speaking ACP (Agent Client Protocol), plus CLI discovery (models, version).
 *
 * In-process run handles are keyed by run id — the engine is single-process,
 * so a server restart drops them and reconcile takes over via persisted ACP
 * sessions.
 */
export class LocalAgentService {
  /** Known model ids, used when the CLI isn't available to list them. */
  static readonly FALLBACK_MODELS = ["composer-2.5", "auto"];

  /** How often a live run refreshes its DB heartbeat. */
  static readonly HEARTBEAT_MS = 15_000;

  private handles = new Map<string, LocalRunHandle>();
  /** runId → heartbeat interval (cleared when the run settles). */
  private heartbeats = new Map<string, NodeJS.Timeout>();

  /** True if this server process still owns the given local run (false after restart). */
  hasActiveRun(runId: string): boolean {
    return this.handles.has(runId);
  }

  /** True when `pid` is a live process on this machine (EPERM = alive, not ours). */
  static pidAlive(pid: number | null | undefined): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e?.code === "EPERM";
    }
  }

  /**
   * Attach DB-backed liveness to a freshly started run: stamp the owner pid +
   * heartbeat now, then keep the heartbeat fresh until the run settles. The
   * heartbeat also touches the node row so reconcile's start-grace window
   * never expires mid-run. Reconcile trusts this instead of the in-memory
   * handle map, which is per-module-graph under next dev.
   */
  private trackRunLiveness(runId: string, nodeId: string): void {
    const beat = () => {
      const now = db.now();
      db.run(
        `UPDATE runs SET owner_pid=?, last_heartbeat_at=? WHERE cursor_run_id=? AND status='running'`,
        process.pid,
        now,
        runId,
      );
      db.run(
        `UPDATE nodes SET updated_at=? WHERE id=? AND status='running'`,
        now,
        nodeId,
      );
    };
    beat();
    const timer = setInterval(beat, LocalAgentService.HEARTBEAT_MS);
    timer.unref?.();
    this.heartbeats.set(runId, timer);
  }

  private stopRunLiveness(runId: string): void {
    const t = this.heartbeats.get(runId);
    if (t) clearInterval(t);
    this.heartbeats.delete(runId);
  }

  /**
   * Stop an in-process local run: asks the agent to cancel the turn gracefully
   * (session/cancel), then SIGKILLs the process. The run's `done` promise
   * rejects, so any executor awaiting it marks its node failed (retryable).
   * No-op after restart (handle gone) — reconcile handles orphaned nodes.
   */
  cancelRun(runId: string): boolean {
    const h = this.handles.get(runId);
    if (!h) return false;
    try {
      if (h.sessionId)
        h.connection.notify("session/cancel", { sessionId: h.sessionId });
    } catch {
      /* pipe already gone */
    }
    try {
      h.connection.proc.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    return true;
  }

  defaults() {
    return {
      force: db.getSetting<boolean>("local_agent.force", true),
      sandbox: db.getSetting<boolean>("local_agent.sandbox", false),
      timeoutMs: db.getSetting<number>(
        "local_agent.timeout_ms",
        30 * 60 * 1000,
      ),
    };
  }

  async cliAvailable(): Promise<boolean> {
    try {
      await exec("cursor-agent", ["--version"], { maxBuffer: 1024 * 1024 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List models available to the local cursor-agent CLI (`cursor-agent models`).
   * Output lines look like `<model-id> - <description>` (plus a header line).
   * Returns null when the CLI is missing/errors — callers fall back to FALLBACK_MODELS.
   */
  async listModels(): Promise<string[] | null> {
    try {
      const { stdout } = await exec("cursor-agent", ["models"], {
        maxBuffer: 1024 * 1024,
        timeout: 15000,
      });
      const models: string[] = [];
      for (const raw of stdout.split("\n")) {
        const line = raw.trim();
        if (!line || line.toLowerCase().startsWith("available")) continue;
        const id = line.split(" - ")[0].trim();
        if (id) models.push(id);
      }
      return models.length ? models : null;
    } catch {
      return null;
    }
  }

  /**
   * Env for spawned cursor-agent processes: forwards CURSOR_API_KEY when set
   * (API-key auth instead of an interactive `agent login`). Explicit so the
   * key reaches the CLI even if the server env changes after startup.
   */
  private spawnEnv(): NodeJS.ProcessEnv {
    const key = config.cursor.apiKey();
    return key ? { ...process.env, CURSOR_API_KEY: key } : process.env;
  }

  /**
   * Authenticate the ACP connection. With CURSOR_API_KEY the CLI is already
   * authenticated at spawn time, so the cursor_login round-trip is skipped;
   * without it, fall back to the user's existing `agent login` (best-effort).
   */
  private async authenticate(connection: AcpConnection): Promise<void> {
    if (config.cursor.apiKey()) return; // API key auth handled at spawn
    await connection
      .request("authenticate", { methodId: "cursor_login" })
      .catch(() => {});
  }

  /** Best-effort: make sure the workspace is on the requested branch. */
  private async ensureBranch(workspace: string, branch: string): Promise<void> {
    const git = ["-C", workspace];
    await exec("git", [...git, "fetch", "origin", branch], {
      maxBuffer: 10 << 20,
    }).catch(() => {});
    const { stdout: cur } = await exec("git", [
      ...git,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    if (cur.trim() === branch) return;
    await exec("git", [...git, "checkout", branch], {
      maxBuffer: 10 << 20,
    }).catch(async () => {
      await exec(
        "git",
        [...git, "checkout", "-b", branch, `origin/${branch}`],
        { maxBuffer: 10 << 20 },
      );
    });
  }

  /**
   * Resolve a bare model id ("composer-2.5") to the exact parameterized ACP
   * model id ("composer-2.5[fast=true]") advertised in session/new.
   * Only needed in "variants" picker mode (older cursor-agent, or one that
   * ignores the parameterizedModelPicker capability): there session/set_model
   * rejects anything that isn't an exact advertised variant id.
   * Falls back to the input unchanged when no match is found (forward compat:
   * the agent may accept new bare ids we don't know about).
   */
  private resolveModelId(requested: string, advertised: string[]): string {
    const exact = advertised.find((id) => id === requested);
    if (exact) return exact;
    // "auto" is the bare name of the default entry, advertised as "default[]"
    if (requested === "auto") {
      const def = advertised.find((id) => id.startsWith("default"));
      if (def) return def;
    }
    const prefix = advertised.find((id) => id.startsWith(requested + "["));
    if (prefix) return prefix;
    return requested;
  }

  /**
   * Split a model spec into base id and bracket parameter overrides:
   * "composer-2.5[fast=false]" → { base: "composer-2.5", params: [{id:"fast",value:"false"}] }.
   */
  private parseModelSpec(raw: string): { base: string; params: { id: string; value: string }[] } {
    const m = raw.trim().match(/^([^[]+?)\s*(?:\[(.*)\])?$/);
    const base = (m?.[1] ?? raw).trim();
    const params = (m?.[2] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((kv) => {
        const eq = kv.indexOf("=");
        if (eq < 0) return { id: kv.trim(), value: "" };
        return { id: kv.slice(0, eq).trim(), value: kv.slice(eq + 1).trim() };
      })
      .filter((p) => p.id);
    return { base, params };
  }

  /** Pick the approval option matching local_agent.force semantics (always vs once). */
  private pickPermissionOption(options: any[], force: boolean): string {
    const ids = options.map((o) => String(o?.optionId ?? o?.id ?? ""));
    const find = (re: RegExp) => ids.find((id) => re.test(id));
    return (
      (force
        ? (find(/allow.*always/i) ?? find(/allow/i))
        : (find(/allow.*once/i) ?? find(/allow/i))) ??
      ids[0] ??
      (force ? "allow-always" : "allow-once")
    );
  }

  /** Extract a human-readable tool result from a tool_call_update payload. */
  private toolResultOf(u: any): string | undefined {
    const raw = u?.rawOutput ?? u?.output;
    if (raw != null) return typeof raw === "string" ? raw : JSON.stringify(raw);
    if (Array.isArray(u?.content)) {
      const text = u.content
        .map((p: any) => p?.text ?? "")
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
    return undefined;
  }

  /**
   * Spawn a local cursor-agent run speaking ACP.
   *
   * Performs the handshake (initialize → authenticate → session/new|session/load
   * → set_mode/set_model) and sends session/prompt before returning, so the
   * returned agentId is the real ACP session id. Consume events and the final
   * result via streamRun(runId, callbacks).
   */
  async createRun(
    input: LocalAgentInput & { nodeId?: string },
  ): Promise<{ agentId: string; runId: string; nodeId?: string }> {
    if (!fs.existsSync(input.workspace)) {
      throw new Error(
        `Local path for this repo does not exist: ${input.workspace}. Fix it on the Settings page.`,
      );
    }
    const opts = this.defaults();
    if (input.branch && input.mode !== "plan") {
      await this.ensureBranch(input.workspace, input.branch).catch(() => {});
    }

    const runCwd = input.cwd ?? input.workspace;
    // ACP has no sandbox toggle of its own; --sandbox is a root CLI flag and
    // applies to the acp subcommand (same as --api-key in Cursor's docs).
    const args = ["--sandbox", opts.sandbox ? "enabled" : "disabled", "acp"];

    // ── run state ────────────────────────────────────────────────────────
    let sessionId: string | null = input.sessionId ?? null;
    let msgText = ""; // accumulated agent_message_chunk deltas for THIS turn
    let planText: string | null = null; // cursor/create_plan payload (plan mode)
    let replaying = false; // swallow history replayed by session/load
    let promptStartedAt = 0;
    let modelUsed: string | undefined;
    // ACP model ids are parameterized (e.g. "composer-2.5[fast=true]", "default[]")
    // while the app stores bare ids from `cursor-agent models` ("composer-2.5").
    // session/new advertises the exact ids the agent will accept.
    let availableModelIds: string[] = [];
    const toolKinds = new Map<string, string>(); // toolCallId → kind (updates only carry title on refinement)

    let handle!: LocalRunHandle;
    const connection = new AcpConnection(
      spawn("cursor-agent", args, { cwd: runCwd, env: this.spawnEnv() }),
      (msg) => {
        if (msg.method === "session/update") {
          const u = msg.params?.update;
          if (!u || replaying) return;
          switch (u.sessionUpdate) {
            case "agent_message_chunk": {
              const t = u.content?.type === "text" ? u.content.text : undefined;
              if (t) {
                msgText += t;
                handle.push({ kind: "assistant", text: t });
              }
              break;
            }
            case "agent_thought_chunk": {
              const t = u.content?.type === "text" ? u.content.text : undefined;
              if (t) handle.push({ kind: "thinking", text: t });
              break;
            }
            case "tool_call":
              // start of a tool call; stable toolCallId pairs all later updates
              if (u.toolCallId && u.kind) toolKinds.set(u.toolCallId, u.kind);
              handle.push({
                kind: "tool",
                name: u.title ?? u.kind ?? "tool",
                status: u.status ?? "pending",
                args:
                  u.rawInput && Object.keys(u.rawInput).length
                    ? u.rawInput
                    : undefined,
                callId: u.toolCallId,
              });
              break;
            case "tool_call_update":
              handle.push({
                kind: "tool",
                name: u.title ?? toolKinds.get(u.toolCallId) ?? "tool",
                status: u.status ?? "updated",
                args:
                  u.rawInput && Object.keys(u.rawInput).length
                    ? u.rawInput
                    : undefined,
                callId: u.toolCallId,
                result: this.toolResultOf(u),
              });
              break;
            default:
              // user_message_chunk, session_info_update, available_commands_update, plan — not feed-worthy
              break;
          }
          return;
        }

        if (msg.method === "session/request_permission") {
          // headless: auto-approve per local_agent.force (blocking if unanswered)
          const optionId = this.pickPermissionOption(
            msg.params?.options ?? [],
            opts.force,
          );
          connection.respond(msg.id, {
            outcome: { outcome: "selected", optionId },
          });
          return;
        }

        // agent → client blocking requests (Cursor extension methods)
        if (msg.id != null && msg.method) {
          if (msg.method === "cursor/ask_question") {
            connection.respond(msg.id, {
              outcome: { outcome: "skipped", reason: "headless run" },
            });
          } else if (msg.method === "cursor/create_plan") {
            // plan mode: the full plan arrives here; keep it for the run result
            if (typeof msg.params?.plan === "string" && msg.params.plan) {
              planText = msg.params.plan;
              handle.push({ kind: "assistant", text: msg.params.plan });
            }
            connection.respond(msg.id, { outcome: { outcome: "accepted" } });
          } else if (msg.method === "cursor/update_todos") {
            connection.respond(msg.id, {
              outcome: { outcome: "accepted", todos: msg.params?.todos ?? [] },
            });
          } else if (msg.method === "cursor/task") {
            connection.respond(msg.id, { outcome: { outcome: "completed" } });
          } else {
            // fs/terminal/etc. — we advertised no such capabilities
            connection.replyError(
              msg.id,
              `${msg.method} not supported by this client`,
            );
          }
        }
        // other notifications (cursor/task, cursor/generate_image, …): display-only, ignore
      },
    );

    handle = new LocalRunHandle(
      connection,
      opts.timeoutMs,
      Math.round(opts.timeoutMs / 60000),
    );
    connection.proc.on("close", (code) => {
      handle.fail(
        new Error(
          `cursor-agent exited unexpectedly (code ${code ?? "?"})${connection.stderrText ? `: ${connection.stderrText.slice(0, 800)}` : ""}`,
        ),
      );
    });

    // ── handshake + prompt ───────────────────────────────────────────────
    try {
      await connection.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          // Opt into the parameterized model picker: models are addressed by
          // bare id ("composer-2.5") and their parameters ("fast", "effort", …)
          // become individually settable via session/set_config_option.
          // Without it the agent runs in "variants" mode and only accepts
          // exact pre-baked variant ids ("composer-2.5[fast=true]").
          _meta: { parameterizedModelPicker: true },
        } as any,
        clientInfo: { name: "devflow", version: "0.1.0" },
      });
      await this.authenticate(connection);

      if (input.sessionId) {
        // follow-up: resume the prior conversation. The agent replays history as
        // session/update notifications — swallow them so old events don't get
        // double-persisted into this run's feed.
        replaying = true;
        let loaded: any;
        try {
          loaded = await connection.request("session/load", {
            sessionId: input.sessionId,
            cwd: runCwd,
            mcpServers: [],
          });
        } finally {
          replaying = false;
        }
        sessionId = input.sessionId;
        modelUsed = loaded?.models?.currentModelId;
        availableModelIds = (loaded?.models?.availableModels ?? [])
          .map((m: any) => String(m?.modelId ?? ""))
          .filter(Boolean);
      } else {
        const s: any = await connection.request("session/new", {
          cwd: runCwd,
          mcpServers: [],
        });
        sessionId = s.sessionId;
        modelUsed = s?.models?.currentModelId;
        availableModelIds = (s?.models?.availableModels ?? [])
          .map((m: any) => String(m?.modelId ?? ""))
          .filter(Boolean);
      }
      handle.sessionId = sessionId ?? undefined;

      if (input.mode) {
        await connection
          .request("session/set_mode", { sessionId, modeId: input.mode })
          .catch(() => {});
      }
      const model = input.model ?? config.cursor.defaultModel();
      if (model) {
        const spec = this.parseModelSpec(model);
        // Parameterized mode advertises bare ids; variants mode advertises
        // pre-baked "id[params]" strings. Detect which one the agent speaks.
        const variantsMode = availableModelIds.some((id) => id.includes("["));
        let modelId = spec.base;
        if (variantsMode) {
          if (spec.params.length) {
            throw new Error(
              `model parameters ("${model}") are not supported by this cursor-agent version — upgrade cursor-agent or use a bare model id`,
            );
          }
          modelId = this.resolveModelId(spec.base, availableModelIds);
        } else if (spec.base === "auto") {
          modelId = "default"; // parameterized mode names the auto entry "default"
        }
        await connection
          .request("session/set_model", { sessionId, modelId })
          .catch((e: Error) => {
            throw new Error(
              `cursor-agent rejected model "${model}" (as "${modelId}"): ${e.message}`,
            );
          });
        // Bracket parameter overrides, e.g. composer-2.5[fast=false]:
        // set each parameter individually (parameterized mode only).
        for (const p of spec.params) {
          await connection
            .request("session/set_config_option", {
              sessionId,
              configId: p.id,
              value: p.value,
            })
            .catch((e: Error) => {
              throw new Error(
                `cursor-agent rejected model parameter "${p.id}=${p.value}" ("${model}"): ${e.message}`,
              );
            });
        }
        // Report the requested spec as-is: pricing keys and the UI display use it.
        modelUsed = model;
      } else if (modelUsed?.startsWith("default")) {
        modelUsed = "auto"; // ACP's "default"/"default[]" entry, shown as "auto" elsewhere
      }

      promptStartedAt = Date.now();
      connection
        .request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: input.prompt }],
        })
        .then(
          () => {
            const durationMs = Date.now() - promptStartedAt;
            const text =
              (planText && planText.length > msgText.length
                ? planText
                : msgText) || "(no result text)";
            handle.finish({
              result: { status: "FINISHED", text, durationMs },
              sessionId,
              usage: { durationMs, model: modelUsed },
            });
          },
          (e: Error) =>
            handle.fail(new Error(`session/prompt failed: ${e.message}`)),
        );
    } catch (e: any) {
      handle.fail(
        new Error(`cursor-agent ACP handshake failed: ${e?.message ?? e}`),
      );
      throw e;
    }

    const runId = `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.handles.set(runId, handle);
    if (input.nodeId) this.trackRunLiveness(runId, input.nodeId);
    return { agentId: sessionId ?? runId, runId, nodeId: input.nodeId };
  }

  /**
   * Re-attach to a previous ACP session read-only and reconstruct its last turn
   * from the history replay that session/load emits. Used by reconcile after a
   * server restart: the run's process is gone, but the CLI persists sessions, so
   * this is the ground truth for whether the orphaned turn actually finished —
   * far more reliable than inferring from git state (which says nothing for
   * read-only nodes like plan/review). Returns null when the session can't be
   * loaded (unknown id, CLI error, timeout) — callers should fail the node.
   */
  async inspectSession(
    sessionId: string,
    workspace: string,
    timeoutMs = 90_000,
  ): Promise<LocalSessionInspection | null> {
    if (!fs.existsSync(workspace)) return null;

    // replay reconstruction of the last turn
    let text = "";
    let sawAgentMessage = false;
    let lastWasAgentMessage = false;
    const openToolCalls = new Set<string>();

    return new Promise<LocalSessionInspection | null>((resolve) => {
      let connection!: AcpConnection;
      const timer = setTimeout(() => finish(null), timeoutMs);
      const finish = (v: LocalSessionInspection | null) => {
        clearTimeout(timer);
        connection.endStdin();
        connection.killAfter(2000);
        resolve(v);
      };

      connection = new AcpConnection(
        spawn("cursor-agent", ["acp"], {
          cwd: workspace,
          env: this.spawnEnv(),
        }),
        (msg) => {
          if (msg.method === "session/update") {
            const u = msg.params?.update;
            switch (u?.sessionUpdate) {
              case "user_message_chunk":
                // a newer prompt starts — reset reconstruction to this last turn
                text = "";
                sawAgentMessage = false;
                lastWasAgentMessage = false;
                openToolCalls.clear();
                break;
              case "agent_message_chunk":
                if (u.content?.type === "text" && u.content.text)
                  text += u.content.text;
                sawAgentMessage = true;
                lastWasAgentMessage = true;
                break;
              case "agent_thought_chunk":
                lastWasAgentMessage = false;
                break;
              case "tool_call":
                if (u.toolCallId) openToolCalls.add(u.toolCallId);
                lastWasAgentMessage = false;
                break;
              case "tool_call_update": {
                const s = String(u.status ?? "");
                if (u.toolCallId && /complete|fail|error|finish/i.test(s))
                  openToolCalls.delete(u.toolCallId);
                lastWasAgentMessage = false;
                break;
              }
            }
            return;
          }
          // Read-only inspection must never answer agent requests: if the session
          // is still live in another process, replying here could abort its
          // in-flight turn. Leave requests unanswered and let the timeout end us.
        },
      );

      (async () => {
        try {
          await connection.request("initialize", {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: "devflow", version: "0.1.0" },
          });
          await this.authenticate(connection);
          await connection.request("session/load", {
            sessionId,
            cwd: workspace,
            mcpServers: [],
          });
          finish({
            completed:
              sawAgentMessage &&
              lastWasAgentMessage &&
              openToolCalls.size === 0,
            text,
          });
        } catch {
          finish(null);
        }
      })();
    });
  }

  /** Stream events of a local run to completion (mirrors CursorClient.streamRun). */
  async streamRun(
    runId: string,
    cb: {
      onStatus?: (s: string) => void;
      onAssistant?: (text: string) => void;
      onThinking?: (text: string) => void;
      onTool?: (
        name: string,
        status: string,
        args?: any,
        callId?: string,
        extra?: any,
      ) => void;
    } = {},
  ): Promise<LocalRunResult> {
    const h = this.handles.get(runId);
    if (!h) throw new Error(`unknown local run ${runId} (server restarted?)`);
    cb.onStatus?.("RUNNING");
    let cursor = 0;
    const drain = () => {
      while (cursor < h.events.length) {
        const e = h.events[cursor++];
        if (e.kind === "assistant") cb.onAssistant?.(e.text ?? "");
        else if (e.kind === "thinking") cb.onThinking?.(e.text ?? "");
        else if (e.kind === "tool") {
          cb.onTool?.(
            e.name ?? "tool",
            e.status ?? "started",
            e.args,
            e.callId,
            { result: e.result },
          );
        } else if (e.kind === "status" && e.status !== "ENDED")
          cb.onStatus?.(e.status ?? "");
      }
    };
    const pump = new Promise<void>((resolve) => {
      const listener = () => drain();
      h.listeners.add(listener);
      h.done.finally(() => {
        h.listeners.delete(listener);
        resolve();
      });
    });
    drain();
    try {
      const out = await h.done;
      await pump;
      drain();
      return out;
    } finally {
      this.handles.delete(runId);
      this.stopRunLiveness(runId);
    }
  }
}

export const localAgent = processSingleton(
  "localAgent",
  () => new LocalAgentService(),
);
