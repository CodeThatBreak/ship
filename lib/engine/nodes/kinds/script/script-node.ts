import "server-only";

import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agent-port";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../../shared";
import { templateStore } from "../../../templates/template-store";
import { ScriptDefSchema, type ScriptDef } from "../../declarative-schemas";
import { parseDeclarativeRunConfig } from "../../shared/declarative-run-config";
import { validateJsonSchema } from "../agent/json-schema-lite";
import { worktreeManager } from "../../../runtime/worktree-lifecycle";
import { workspaceForFlow } from "../../../../git/local";

/**
 * The declarative local-script node (§4.5): one runtime class per
 * `node_templates` row with kind='script'.
 *
 * Audience is individual devs running DevFlow locally — scripts run with the
 * user's own trust, exactly like `npm run`. Execution is via **execa**
 * (promise API, zombie cleanup, cross-platform) — deliberately not a sandbox.
 * Contract:
 *
 *  - the node's mapped input JSON arrives on stdin AND as `DEVFLOW_INPUT`
 *  - the script writes `$DEVFLOW_OUTPUT` (a file path), or its LAST stdout
 *    line must be the output JSON — for node scripts, a top-level `return`
 *    value is emitted as the output JSON (when defined)
 *  - the output is validated against the declared `output_schema` (when set)
 *    and must be a JSON object (downstream maps address
 *    `nodes.<key>.output.<field>`)
 *  - `timeout_ms` kills the process, non-zero exit fails the node with stderr
 *  - env is allowlisted: PATH/HOME + the declared names + the DevFlow wiring
 */
export class ScriptTemplateNode extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label: string;
  readonly promptKeys = [] as const;
  readonly order = 1003;
  readonly retryable = true;

  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  readonly outputSchema = z.looseObject({}) as unknown as z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  readonly configFields = [
    {
      key: "runtime", label: "Runtime", type: "select" as const,
      options: [
        { value: "shell", label: "shell — POSIX sh (cmd on Windows)" },
        { value: "node", label: "node — Node.js" },
        { value: "python", label: "python — python3" },
      ],
    },
    { key: "script", label: "Script", type: "text" as const,
      help: "stdin gets the mapped input JSON; $DEVFLOW_INPUT holds it too — node scripts may `return` the output object" },
    {
      key: "cwd", label: "Working directory", type: "select" as const,
      help: "Where the script runs",
      options: [
        { value: "repo", label: "repo — the repo's local checkout" },
        { value: "workspace", label: "workspace — the per-flow workspace clone" },
      ],
    },
    { key: "timeout_ms", label: "Timeout (ms)", type: "number" as const },
    { key: "env", label: "Env allowlist (JSON array)", type: "string" as const,
      help: `e.g. ["CI","NODE_ENV"] — always available: PATH, HOME` },
    { key: "output_schema", label: "Output schema", type: "ts_output" as const,
      help: "TS-lite members (same box as the agent node) or a pasted JSON Schema the output JSON must satisfy" },
  ];

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: ScriptDef;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super();
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = ScriptDefSchema.parse(tmpl.config ?? {});
    this.description = tmpl.description ?? undefined;
  }

  /** Display description from the node catalog entry. */
  description?: string;

  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  /** The script's output contract: its declared output schema, or free-form. */
  override outputContract(def: Record<string, unknown> = this.def as unknown as Record<string, unknown>): unknown {
    return def.output_schema && typeof def.output_schema === "object"
      ? def.output_schema
      : { type: "object", description: "Free-form JSON object (declare an output schema to constrain it)" };
  }

  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);
    return this.runScript(ctx, rawInput, cfg);
  }

  /** Restart recovery: a finished run's stdout is not persisted for scripts — retry re-runs it. */
  async recover(_ctx: FlowCtx, _node: NodeRow, result: AgentRunResult, _note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    return false;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async runScript(ctx: FlowCtx, rawInput: Record<string, unknown>, cfg: ScriptDef): Promise<RunOutcome> {
    const node = this.node(ctx);
    if (!cfg.script?.trim()) {
      const msg = `${this.label}: no script configured — set one in the template editor`;
      return this.applyOutcome(ctx, { status: "failed", output: {}, event: msg, reply: msg });
    }

    this.markRunning(ctx, { ...rawInput, mapped: true });

    let cwd: string;
    try {
      cwd = await this.workingDir(ctx, cfg, node.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.applyOutcome(ctx, { status: "failed", output: {}, event: msg, reply: msg });
    }

    const outPath = path.join(os.tmpdir(), `devflow-out-${node.id}-${Date.now()}.json`);
    const inputJson = JSON.stringify(rawInput ?? {});
    const env = this.childEnv(cfg, inputJson, outPath);
    const [bin, args] = this.command(cfg);

    const result = await runProcess(bin, args, {
      input: inputJson,
      timeoutMs: cfg.timeout_ms > 0 ? cfg.timeout_ms : 120_000,
      cwd,
      env,
    });

    this.support.emit(ctx.flow.id, node.id, "log",
      `${this.label}: ${bin} exited ${result.exitCode} (${((result.durationMs ?? 0) / 1000).toFixed(1)}s)${result.timedOut ? " — killed after timeout" : ""}`,
      {
        exitCode: result.exitCode,
        stdout_tail: result.stdout.trim().split("\n").slice(-20).join("\n"),
        stderr_tail: result.stderr.trim().split("\n").slice(-20).join("\n"),
      });

    try {
      if (result.timedOut) {
        throw new Error(`script exceeded the ${cfg.timeout_ms}ms timeout and was killed`);
      }
      if (result.exitCode !== 0) {
        // stderr: the diagnostic (syntax error message, thrown Error, …) sits at
        // the TOP — the tail is framework stack + the Node version banner, which
        // hides the real cause. stdout: keep the tail (output lives there).
        const tail = headLines(result.stderr) || firstLines(result.stdout) || "(no output)";
        throw new Error(`script exited with code ${result.exitCode}\n${tail}`);
      }
      const parsed = this.extractOutput(result.stdout, outPath);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          "the script's output must be a JSON object — the last stdout line is the output JSON, or write it to the $DEVFLOW_OUTPUT file");
      }
      if (cfg.output_schema && typeof cfg.output_schema === "object") {
        validateJsonSchema(cfg.output_schema, parsed, this.label);
      }
      return this.applyOutcome(ctx, this.finish(ctx, parsed as Record<string, unknown>, result.stdout));
    } catch (e: unknown) {
      const msg = `${this.label}: ${e instanceof Error ? e.message : String(e)}`;
      return this.applyOutcome(ctx, {
        status: "failed",
        output: {},
        event: `${this.label} failed`,
        reply: msg,
      });
    } finally {
      rmSync(outPath, { force: true });
    }
  }

  private finish(ctx: FlowCtx, output: Record<string, unknown>, stdout: string): RunOutcome {
    const hold = this.holdsForApproval(ctx);
    return {
      status: hold ? "awaiting_approval" : "done",
      output,
      artifact: { kind: "json", content: JSON.stringify(output, null, 2), meta: { stdout: stdout.slice(0, 20_000) } },
      event: `${this.label} output ready${hold ? " — awaiting approval" : ""}`,
      eventData: { output_format: "json" },
      reply: "```json\n" + JSON.stringify(output, null, 2) + "\n```",
    };
  }

  /** Output resolution: the $DEVFLOW_OUTPUT file first, then the last parseable stdout line. */
  private extractOutput(stdout: string, outPath: string): unknown {
    if (existsSync(outPath)) {
      try {
        return JSON.parse(readFileSync(outPath, "utf8"));
      } catch {
        /* fall through to stdout */
      }
    }
    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      throw new Error("the script produced no output — the last stdout line must be the output JSON (or write the $DEVFLOW_OUTPUT file)");
    }
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* keep walking — logging around the output line is allowed */
      }
    }
    throw new Error("none of the last stdout lines parsed as JSON — the last stdout line must be the output JSON (or write the $DEVFLOW_OUTPUT file)");
  }

  /** The script's working directory: the repo checkout, or the flow workspace clone. */
  private async workingDir(ctx: FlowCtx, cfg: ScriptDef, nodeId: string | null = null): Promise<string> {
    if (cfg.cwd === "workspace") {
      const ws = workspaceForFlow(ctx.flow.id);
      if (ws && existsSync(ws)) return ws;
      // explicitly asked for the flow workspace but no agent step created it
      // yet — ensure it the same way an unpinned agent run does (script-only
      // flows are first-class); when worktrees can't apply, keep the old error
      const branch = ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
      const binding = await worktreeManager.ensureFlowWorktree(ctx, branch, { nodeId });
      if (!binding.dir) return this.legacyWorkspaceError(); // worktrees can't apply (cloud mode)
      return binding.dir;
    }
    const lp = this.ctxHelper.localPath(ctx);
    if (!lp) {
      throw new Error(
        `${this.label} runs with cwd=repo but its repo has no local path configured — register one on the Settings page, or set cwd=workspace`);
    }
    return lp;
  }

  /** Today's pre-ensure behavior, kept for modes where worktrees can't apply (cloud). */
  private legacyWorkspaceError(): never {
    throw new Error(
      `${this.label}: no workspace clone for this flow — set cwd=repo, or run/re-run an agent step first (the workspace exists once the flow clones locally)`);
  }

  /**
   * Allowlisted child env: PATH + HOME always, then the declared names, then
   * the DevFlow wiring (mapped input on stdin AND in $DEVFLOW_INPUT).
   */
  private childEnv(cfg: ScriptDef, inputJson: string, outPath: string): Record<string, string> {
    const declared = (cfg.env ?? []).map((s) => String(s).trim()).filter(Boolean);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    };
    for (const name of declared) {
      if (!(name in env)) {
        const v = process.env[name];
        if (v !== undefined) env[name] = v;
      }
    }
    env.DEVFLOW_INPUT = inputJson;
    env.DEVFLOW_OUTPUT = outPath;
    return env;
  }

  private command(cfg: ScriptDef): [string, string[]] {
    switch (cfg.runtime) {
      case "node":
        // Wrap in an async function so a top-level `return` is legal and its
        // value is emitted as the output JSON (when defined). Scripts that
        // print their output instead are unaffected — `v` is undefined.
        return ["node", ["-e", `async function __devflowMain() {\n${cfg.script}\n}\n` +
          "__devflowMain().then((v) => { if (v !== undefined) console.log(JSON.stringify(v)); })"]];
      case "python":
        return [process.platform === "win32" ? "python" : "python3", ["-c", cfg.script]];
      case "shell":
      default:
        return process.platform === "win32"
          ? ["cmd", ["/d", "/s", "/c", cfg.script]]
          : ["sh", ["-c", cfg.script]];
    }
  }

  private runConfig(config: Record<string, unknown>): ScriptDef {
    return this.parseRunConfig(config) as unknown as ScriptDef;
  }

  override parseRunConfig(config: Record<string, unknown>): Record<string, unknown> {
    return parseDeclarativeRunConfig("script", config, this.label);
  }

  private holdsForApproval(ctx: FlowCtx): boolean {
    const g = templateStore.graphForFlow(ctx.flow.id);
    const spec = g?.byKey.get(this.key);
    return spec?.trigger.type === "approval";
  }
}

function firstLines(text: string): string {
  const t = (text ?? "").trim();
  return t ? t.split("\n").slice(-4).join("\n") : "";
}

/** The FIRST few lines — for stderr, where the actual diagnostic lives. */
function headLines(text: string): string {
  const t = (text ?? "").trim();
  return t ? t.split("\n").slice(0, 8).join("\n") : "";
}

// ── execa plumbing (dynamic import: execa is ESM-only) ───────────────────────

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs?: number;
  timedOut: boolean;
}

async function runProcess(
  bin: string,
  args: string[],
  opts: { input: string; timeoutMs: number; cwd: string; env: Record<string, string> },
): Promise<ExecResult> {
  const started = Date.now();
  try {
    const { execa } = (await import("execa")) as unknown as {
      execa: (
        file: string,
        args: string[],
        o: Record<string, unknown>,
      ) => Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; failed: boolean }>;
    };
    const res = await execa(bin, args, {
      input: opts.input,
      timeout: opts.timeoutMs,
      cwd: opts.cwd,
      env: opts.env,
      killSignal: "SIGKILL",
      stripFinalNewline: false,
      reject: false,
      windowsHide: true,
    });
    return {
      exitCode: res.exitCode ?? (res.failed ? 1 : 0),
      stdout: String(res.stdout ?? ""),
      stderr: String(res.stderr ?? ""),
      durationMs: Date.now() - started,
      timedOut: Boolean(res.timedOut),
    };
  } catch (e: unknown) {
    // thrown before execution (e.g. binary not found) — execa's promise API
    // with reject:false still throws in that case
    throw new Error(
      `${bin} failed to launch — ensure it is installed and on PATH (${e instanceof Error ? e.message : String(e)})`);
  }
}
