import "server-only";

import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import { type FlowCtx, type RunOutcome } from "../../shared/nodeSharedExports";
import { DeclarativeNode } from "../../shared/declarativeNode";
import { ScriptDefSchema, type ScriptDef } from "../../schemas/declarativeSchemas";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { OutputContractError } from "../../../errors/outputContractError";
import { worktreeManager } from "../../../runtime/worktreeLifecycle";
import { workspaceForFlow } from "../../../../git/local";
import { firstLines, headLines, runProcess } from "./utils/exec";
import { ScriptRunInput, scriptOutputContract } from "./schema";

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
 *  - the script writes its output JSON to `$DEVFLOW_OUTPUT` (a file path) —
 *    stdout is NOT an output channel; for node scripts, a top-level `return`
 *    value is written to the file (when defined)
 *  - a declared `output_schema` is required to publish: an output-bearing
 *    script without one fails with an output-contract violation; `{}` is
 *    published only when the script produced nothing (downstream maps address
 *    `nodes.<key>.output.<field>`)
 *  - `timeout_ms` kills the process, non-zero exit fails the node with stderr
 *  - env is allowlisted: PATH/HOME + the declared names + the DevFlow wiring
 */
export class ScriptTemplateNode extends DeclarativeNode<ScriptDef> {
  readonly promptKeys = [] as const;
  readonly order = 1003;
  override readonly retryable = true;

  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  /** the REAL output contract — the declared schema converted to Zod, or the
   *  "must be a JSON object" record when none is declared */
  readonly outputSchema: z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  override readonly configFields = [
    {
      key: "runtime", label: "Runtime", type: "select" as const,
      options: [
        { value: "shell", label: "shell — POSIX sh (cmd on Windows)" },
        { value: "node", label: "node — Node.js" },
        { value: "python", label: "python — python3" },
      ],
    },
    { key: "script", label: "Script", type: "text" as const,
      help: "stdin gets the mapped input JSON; $DEVFLOW_INPUT holds it too — write the output JSON to the $DEVFLOW_OUTPUT file (node scripts: a top-level `return` is written there)" },
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
      help: "Required to publish output — the $DEVFLOW_OUTPUT JSON must satisfy it (TS-lite members, same box as the agent node, or a pasted JSON Schema); without a schema the script publishes nothing" },
  ];

  declare readonly def: ScriptDef;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super(tmpl, instanceKey, ScriptDefSchema.parse(tmpl.config ?? {}), "script");
    this.inputSchema = ScriptRunInput;
    // the REAL output contract (step 04): the declarative def cache holds
    // instances, so the JSON-Schema → Zod conversion happens once per instance
    this.outputSchema = scriptOutputContract(this.def.output_schema, this.label);
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

  /** Restart recovery: a finished run's output file is not persisted — the
   * script must re-run (manual, with the reason the trail shows). */
  async recover(_ctx: FlowCtx, _node: NodeRow, result: AgentRunResult, _note: string): Promise<RecoveryResult> {
    void _note;
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the script run ended with ${result.status}` };
    }
    return { kind: "manual", reason: "a finished script run's output is not persisted — retry re-runs the script" };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async runScript(ctx: FlowCtx, rawInput: Record<string, unknown>, cfg: ScriptDef): Promise<RunOutcome> {
    const node = await this.node(ctx);
    if (!cfg.script?.trim()) {
      const msg = `${this.label}: no script configured — set one in the template editor`;
      return await this.applyOutcome(ctx, { status: "failed", output: {}, event: msg, reply: msg });
    }

    await this.markRunning(ctx, { ...rawInput, mapped: true });

    let cwd: string;
    try {
      cwd = await this.workingDir(ctx, cfg, node.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return await this.applyOutcome(ctx, { status: "failed", output: {}, event: msg, reply: msg });
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

    await this.support.emit(ctx.flow.id, node.id, "log",
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
        // hides the real cause. stdout: keep the tail (diagnostics only — the
        // output rides the $DEVFLOW_OUTPUT file).
        const tail = headLines(result.stderr) || firstLines(result.stdout) || "(no output)";
        throw new Error(`script exited with code ${result.exitCode}\n${tail}`);
      }
      // Output resolution: the $DEVFLOW_OUTPUT file ONLY — stdout is not an
      // output channel. A missing or empty file means the script produced
      // NOTHING: publish the empty output (applyOutcome validates it against
      // the contract — a declared schema rejects {} when it requires fields).
      const declaredSchema = cfg.output_schema != null && typeof cfg.output_schema === "object";
      const raw = this.readOutputFile(outPath);
      if (raw == null) {
        return await this.applyOutcome(ctx, await this.finish(ctx, {}, result.stdout));
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // the script produced something invalid — a contract violation, typed
        throw new OutputContractError({
          nodeKey: this.key,
          issues: ["the script's $DEVFLOW_OUTPUT did not contain valid JSON"],
        });
      }
      if (!declaredSchema) {
        // the publishing rule: no declared schema ⇒ nothing is published —
        // even valid output stays unpublished until the author declares one
        throw new OutputContractError({
          nodeKey: this.key,
          issues: ["the script produced output but declares no output_schema — declare one to publish"],
        });
      }
      return await this.applyOutcome(ctx, await this.finish(ctx, parsed as Record<string, unknown>, result.stdout));
    } catch (e: unknown) {
      if (e instanceof OutputContractError) {
        // the typed event first (the trail explains the refusal), then the
        // failed terminal through the one persistence path
        const issues = [...e.issues];
        const message = `${this.label}: ${e.issues[0] ?? "output contract violation"}`;
        await this.support.emit(ctx.flow.id, node.id, EVENT_KIND.OUTPUT_CONTRACT_VIOLATION, message, {
          nodeKey: this.key,
          issues,
        });
        return await this.applyOutcome(ctx, {
          status: "failed",
          output: {},
          event: `${this.label} failed — output contract violation`,
          reply: message,
        });
      }
      const msg = `${this.label}: ${e instanceof Error ? e.message : String(e)}`;
      return await this.applyOutcome(ctx, {
        status: "failed",
        output: {},
        event: `${this.label} failed`,
        reply: msg,
      });
    } finally {
      rmSync(outPath, { force: true });
    }
  }

  private async finish(ctx: FlowCtx, output: Record<string, unknown>, stdout: string): Promise<RunOutcome> {
    const hold = await this.holdsForApproval(ctx);
    return {
      status: hold ? "awaiting_approval" : "done",
      output,
      artifact: { kind: "json", content: JSON.stringify(output, null, 2), meta: { stdout: stdout.slice(0, 20_000) } },
      event: `${this.label} output ready${hold ? " — awaiting approval" : ""}`,
      eventData: { output_format: "json" },
      reply: "```json\n" + JSON.stringify(output, null, 2) + "\n```",
    };
  }

  /** Output resolution: the $DEVFLOW_OUTPUT file ONLY. Returns null when the
   *  file is missing or empty — the script produced nothing. */
  private readOutputFile(outPath: string): string | null {
    if (!existsSync(outPath)) return null;
    const content = readFileSync(outPath, "utf8");
    return content.trim() ? content : null;
  }

  /** The script's working directory: the repo checkout, or the flow workspace clone. */
  private async workingDir(ctx: FlowCtx, cfg: ScriptDef, nodeId: string | null = null): Promise<string> {
    if (cfg.cwd === "workspace") {
      const ws = workspaceForFlow(ctx.flow.id);
      if (ws && existsSync(ws)) return ws;
      // explicitly asked for the flow workspace but no agent step created it
      // yet — ensure it the same way an unpinned agent run does (script-only
      // flows are first-class); when worktrees can't apply, keep the old error
      const branch = ctx.flow.mrBranch ?? this.ctxHelper.buildBranch(ctx);
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
        // Wrap in an async function so a top-level `return` is legal; the
        // returned value IS the output JSON — written to the $DEVFLOW_OUTPUT
        // file (stdout is not an output channel). Scripts that write the file
        // themselves are unaffected; an explicit `return` overwrites it.
        return ["node", ["-e", `async function __devflowMain() {\n${cfg.script}\n}\n` +
          "__devflowMain().then((v) => { const out = process.env.DEVFLOW_OUTPUT; if (v !== undefined && out) require('node:fs').writeFileSync(out, JSON.stringify(v)); })"]];
      case "python":
        return [process.platform === "win32" ? "python" : "python3", ["-c", cfg.script]];
      case "shell":
      default:
        return process.platform === "win32"
          ? ["cmd", ["/d", "/s", "/c", cfg.script]]
          : ["sh", ["-c", cfg.script]];
    }
  }
}

import { declarativeKindRegistry } from "../../declarativeRegistry";
import type { NodeDefinition } from "../../shared/nodeDefinition";

declarativeKindRegistry.register("script", ScriptDefSchema, (row, inst) =>
  new ScriptTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>);
