import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agent-port";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../../shared";
import { templateStore } from "../../../templates/template-store";
import { buildFlowContext } from "../../../context/flow-variables";
import { evalJsonata } from "@/lib/jsonata";
import { HttpDefSchema, type HttpDef } from "../../declarative-schemas";
import { getSecrets, redactSecrets, httpAllowlist } from "../../../secrets";
import { guardedRequest } from "../../../../net/ssrf-guard";

/**
 * The declarative outbound-HTTP node (§4.4): one runtime class per
 * `node_templates` row with kind='http'.
 *
 * `url` / `headers` / `body` render `{{vars}}` (flow context) and
 * `{{secrets.NAME}}` (settings store) at execution time — secret values never
 * persist into rows, inputs, or emitted events. Every hop goes through the
 * SSRF guard (scheme allowlist, hostname allowlist, pinned public IPs,
 * redirect re-validation). Output contract is fixed
 * `{status, ok, body, headers}`, shaped by the optional JSONata `response_map`.
 */
export class HttpTemplateNode extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label: string;
  readonly promptKeys = [] as const;
  readonly order = 1002;
  readonly retryable = true;

  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  /** default response contract — `response_map` may reshape the output */
  readonly outputSchema = z.looseObject({}) as unknown as z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  readonly configFields = [
    { key: "url", label: "URL", type: "string" as const, help: "{{vars}} and {{secrets.NAME}} allowed" },
    {
      key: "method", label: "Method", type: "select" as const,
      options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => ({ value: m, label: m })),
    },
    { key: "headers", label: "Headers", type: "text" as const, help: "JSON object of header name → value" },
    { key: "body", label: "Body", type: "text" as const, help: "Sent as-is ({{...}} interpolated) — set the Content-Type header for JSON" },
    { key: "timeout_ms", label: "Timeout (ms)", type: "number" as const },
    { key: "response_map", label: "Response map", type: "text" as const, help: "Optional JSONata over {status, ok, body, headers} — must yield an object stored as the node output" },
  ];

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: HttpDef;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super();
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = HttpDefSchema.parse(tmpl.config ?? {});
    this.description = tmpl.description ?? undefined;
  }

  /** Display description from the node catalog entry. */
  description?: string;

  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  /** The default http contract — response_map may reshape it at run time. */
  override outputContract(): unknown {
    return {
      type: "object",
      description: "Default contract — response_map may reshape it",
      properties: {
        status: { type: "number" },
        ok: { type: "boolean" },
        body: {},
        headers: { type: "object" },
      },
    };
  }

  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);
    const node = this.node(ctx);
    this.support.setNode(node.id, { status: "running", input: JSON.stringify({ ...rawInput, mapped: true }) });
    return this.executeStep(ctx, rawInput, cfg);
  }

  /** Restart recovery: a completed run's response cannot be re-materialized — fail for retry. */
  async recover(_ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    this.support.setNode(node.id, { status: "failed" });
    this.support.emitLifecycle(node.flow_id, node.id,
      `${this.key} call finished while disconnected (${note}) — retry the node to re-issue it (calls are not re-run automatically)`);
    return true;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async executeStep(ctx: FlowCtx, rawInput: Record<string, unknown>, cfg: HttpDef): Promise<RunOutcome> {
    const node = this.node(ctx);
    try {
      if (!cfg.url?.trim()) {
        throw new Error(`${this.label}: no URL configured — set one in the template editor`);
      }
      // the inherited run input is template-addressable: {{input.<field>}}
      // refs the previous node's output (the node declares no input contract)
      const inherited = { ...(rawInput ?? {}) };
      delete inherited.prompt;
      delete inherited.model;
      const vars = { ...buildFlowContext(ctx), input: inherited };
      const url = this.interpolate(cfg.url, vars);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.headers ?? {})) {
        headers[k] = this.interpolate(typeof v === "string" ? v : JSON.stringify(v), vars);
      }
      const body = cfg.body == null ? null : this.interpolate(cfg.body, vars);

      const res = await guardedRequest({
        url,
        method: cfg.method,
        headers,
        body,
        timeoutMs: cfg.timeout_ms > 0 ? cfg.timeout_ms : 30_000,
        allowlist: httpAllowlist(),
      });

      // parse the body: JSON when the content type says so, text otherwise
      const contentType = res.headers["content-type"] ?? "";
      let parsedBody: unknown = res.body;
      if (contentType.includes("json")) {
        try {
          parsedBody = JSON.parse(res.body);
        } catch {
          /* keep as text */
        }
      }
      const defaultOutput = { status: res.status, ok: res.ok, body: parsedBody, headers: res.headers };
      const output = await this.mapResponse(cfg, defaultOutput);

      this.support.emitLifecycle(ctx.flow.id, node.id,
        `${this.label}: ${cfg.method} → ${res.status}${res.ok ? "" : " (not ok)"}`,
        { url: redactSecrets(url) });

      return this.applyOutcome(ctx, this.finish(ctx, rawInput, output, res, defaultOutput));
    } catch (e: unknown) {
      const msg = this.renderErr(e instanceof Error ? e.message : String(e));
      // immediate failure state — the engine's bg() wrapper would ALSO emit an
      // untagged error; mark + emit here so retries and the feed stay accurate
      this.support.setNode(node.id, { status: "failed" });
      this.support.emit(ctx.flow.id, node.id, "error", msg);
      return { status: "failed", output: {}, event: `${this.label} failed`, eventData: { error: msg }, reply: msg };
    }
  }

  /**
   * The fixed output contract, reshaped by `response_map` (JSONata over the
   * default response object). A mapped output must itself be an object.
   */
  private async mapResponse(cfg: HttpDef, defaultOutput: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!cfg.response_map?.trim()) return defaultOutput;
    const r = await evalJsonata(cfg.response_map, defaultOutput);
    if (!r.ok) {
      throw new Error(`${this.label}: response_map failed — ${r.error}`);
    }
    if (!r.value || typeof r.value !== "object" || Array.isArray(r.value)) {
      throw new Error(
        `${this.label}: response_map must yield an object for the node output (got ${r.value === undefined ? "no match" : typeof r.value})`);
    }
    return r.value as Record<string, unknown>;
  }

  private finish(
    ctx: FlowCtx,
    rawInput: Record<string, unknown>,
    output: Record<string, unknown>,
    res: { status: number; headers: Record<string, string> },
    defaultOutput: Record<string, unknown>,
  ): RunOutcome {
    const validated = this.outputSchema.parse(output);
    const hold = this.holdsForApproval(ctx);
    const artifactBody = safeDigest(defaultOutput);
    return {
      status: hold ? "awaiting_approval" : "done",
      output: validated as Record<string, unknown>,
      artifact: { kind: "json", content: JSON.stringify(artifactBody, null, 2) },
      event: `${this.label} responded ${res.status}${hold ? " — awaiting approval" : ""}`,
      eventData: { status: res.status },
      reply: "```json\n" + JSON.stringify(artifactBody, null, 2) + "\n```",
    };
  }

  /** `{{vars}}` + `{{secrets.NAME}}` rendering — secrets resolve only here. */
  private interpolate(text: string, vars: Record<string, unknown>): string {
    const secrets = getSecrets();
    return (text ?? "").replace(/\{\{([^{}]+)\}\}/g, (_, raw: string) => {
      const path = raw.trim();
      const m = path.match(/^secrets\.([A-Za-z0-9_]+)$/);
      if (m) {
        const name = m[1];
        const v = secrets[name];
        if (v == null) throw new Error(`${this.label}: secret "${name}" is not set — add it under Settings → secrets`);
        return v;
      }
      const segments = path.split(".");
      let v: unknown = vars;
      for (const seg of segments) {
        if (v == null || typeof v !== "object") {
          v = undefined;
          break;
        }
        v = (v as Record<string, unknown>)[seg];
      }
      if (v == null) return "";
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return JSON.stringify(v);
    });
  }

  private renderErr(msg: string): string {
    return redactSecrets(msg);
  }

  private runConfig(config: Record<string, unknown>): HttpDef {
    const parsed = HttpDefSchema.safeParse(config);
    return parsed.success ? parsed.data : this.def;
  }

  private holdsForApproval(ctx: FlowCtx): boolean {
    const g = templateStore.graphForFlow(ctx.flow.id);
    const spec = g?.byKey.get(this.key);
    return spec?.trigger.type === "approval";
  }
}

/** Artifact digest capping oversized bodies (headers + a body summary). */
function safeDigest(o: Record<string, unknown>): Record<string, unknown> {
  const body = o.body;
  let bodyOut: unknown = body;
  if (typeof body === "string" && body.length > 20_000) bodyOut = `${body.slice(0, 20_000)}… (truncated)`;
  return { ...o, body: bodyOut };
}
