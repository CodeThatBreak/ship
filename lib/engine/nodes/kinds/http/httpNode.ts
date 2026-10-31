import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import { TemplateRenderer, type FlowCtx, type RunOutcome } from "../../shared/nodeSharedExports";
import { DeclarativeNode } from "../../shared/declarativeNode";
import { buildFlowContext } from "../../../context/flowVariables";
import { evalJsonata } from "@/lib/jsonata/eval";
import { HttpDefSchema, type HttpDef } from "../../declarativeSchemas";
import { allowlistResponseHeaders, capSerializedPayload } from "../../shared/payloadDigest";
import { secretStore } from "../../../secretStore";
import { settingsService } from "@/lib/settings/settingsService";
import { guardedRequest } from "../../../../net/ssrfGuard";

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
export class HttpTemplateNode extends DeclarativeNode<HttpDef> {
  readonly promptKeys = [] as const;
  readonly order = 1002;
  override readonly retryable = true;

  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  /** default response contract — `response_map` may reshape the output */
  readonly outputSchema = z.looseObject({}) as unknown as z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  override readonly configFields = [
    { key: "url", label: "URL", type: "string" as const, help: "{{vars}} and {{secrets.NAME}} allowed" },
    {
      key: "method", label: "Method", type: "select" as const,
      options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => ({ value: m, label: m })),
    },
    { key: "headers", label: "Headers", type: "json" as const, help: "JSON object of header name → value" },
    { key: "body", label: "Body", type: "text" as const, help: "Sent as-is ({{...}} interpolated) — set the Content-Type header for JSON" },
    { key: "timeout_ms", label: "Timeout (ms)", type: "number" as const },
    { key: "response_map", label: "Response map", type: "text" as const, help: "Optional JSONata over {status, ok, body, headers} — must yield an object stored as the node output" },
  ];

  declare readonly def: HttpDef;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super(tmpl, instanceKey, HttpDefSchema.parse(tmpl.config ?? {}), "http");
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
    this.markRunning(ctx, { ...rawInput, mapped: true });
    return this.executeStep(ctx, rawInput, cfg);
  }

  /** Restart recovery: a completed run's response cannot be re-materialized — fail for retry. */
  async recover(_ctx: FlowCtx, _node: NodeRow, result: AgentRunResult, _note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    return false;
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
      const secrets = secretStore.all();
      const renderOpts = {
        label: this.label,
        resolveSecret: (name: string) => secrets[name],
      };
      const url = TemplateRenderer.renderUrl(cfg.url, vars, renderOpts);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.headers ?? {})) {
        const rendered = TemplateRenderer.render(typeof v === "string" ? v : JSON.stringify(v), vars, renderOpts);
        if (/[\r\n]/.test(rendered)) {
          throw new Error(`${this.label}: header "${k}" value must not contain CR or LF`);
        }
        headers[k] = rendered;
      }
      const body = cfg.body == null ? null : TemplateRenderer.render(cfg.body, vars, renderOpts);

      const res = await guardedRequest({
        url,
        method: cfg.method,
        headers,
        body,
        timeoutMs: cfg.timeout_ms > 0 ? cfg.timeout_ms : 30_000,
        allowlist: settingsService.httpAllowlist(),
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
      const defaultOutput = {
        status: res.status,
        ok: res.ok,
        body: capSerializedPayload(parsedBody),
        headers: allowlistResponseHeaders(res.headers),
      };
      const output = await this.mapResponse(cfg, defaultOutput);

      this.support.emitLifecycle(ctx.flow.id, node.id,
        `${this.label}: ${cfg.method} → ${res.status}${res.ok ? "" : " (not ok)"}`,
        { url: secretStore.redact(url) });

      return this.applyOutcome(ctx, this.finish(ctx, rawInput, output, res, defaultOutput));
    } catch (e: unknown) {
      const msg = this.renderErr(e instanceof Error ? e.message : String(e));
      return this.applyOutcome(ctx, {
        status: "failed",
        output: {},
        event: `${this.label} failed`,
        eventData: { error: msg },
        reply: msg,
      });
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

  private renderErr(msg: string): string {
    return secretStore.redact(msg);
  }
}

import { declarativeKindRegistry } from "../../declarativeRegistry";
import type { NodeDefinition } from "../../shared/nodeDefinition";

declarativeKindRegistry.register("http", HttpDefSchema, (row, inst) =>
  new HttpTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>);

/** Artifact digest capping oversized bodies (headers + a body summary). */
function safeDigest(o: Record<string, unknown>): Record<string, unknown> {
  return {
    status: o.status,
    ok: o.ok,
    body: capSerializedPayload(o.body),
    headers: allowlistResponseHeaders(o.headers as Record<string, string> | undefined),
  };
}
