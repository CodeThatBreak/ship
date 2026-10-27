import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { flowEngine } from "../../../../../lib/engine/flow";
import { buildFlowContext, type FlowContextMap } from "../../../../../lib/engine/flow-context";
import { evalJsonata } from "../../../../../lib/engine/jsonata-eval";
import { outputFieldsFor } from "../../../../../lib/engine/context-lint";
import { parseStartContract } from "../../../../../lib/engine/nodes/start/contract";
import { nodeRegistry } from "../../../../../lib/engine/nodes/registry";
import { taskRegistry } from "../../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";

/**
 * Expression preview (Phase 5, Tier 3): `{ expr, scope? }` in — the value the
 * expression evaluates to, out. The context is real data when it exists (the
 * template's most recent flow run, built with the engine's own
 * `buildFlowContext`) and a canned sample derived from the template's
 * declared contracts when no run exists — so `= true` under the editor always
 * means something, and the editor labels which it was.
 *
 * Scopes mirror the three JSONata surfaces' run-time contexts:
 *   context   — the flow context map (edge conditions, pass maps, input maps)
 *   response  — an http node's `{status, ok, body, headers}` (response_map)
 *   delivery  — an inbound hook's `{payload, headers}` (the webhook filter)
 *
 * No state is touched: evaluate only.
 */

type PreviewScope = "context" | "response" | "delivery";

/** A declared field's plausible sample value (typed, never a real secret). */
function sampleValue(type: unknown): unknown {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "object":
      return {};
    case "array":
      return [];
    default:
      return "";
  }
}

/**
 * The canned context sample: task fields from the template's declared task
 * provider, and every declared node's sample output from its contract
 * (`outputFieldsFor` — the same source the linter checks against). Free-form
 * outputs sample as an empty object.
 */
function sampleContext(templateId: string): FlowContextMap {
  const tpl = db.get<{ trigger: string | null }>(
    `SELECT trigger FROM flow_templates WHERE id=?`, templateId
  );
  const trigger = (() => {
    try { return tpl?.trigger ? JSON.parse(tpl.trigger) : {}; } catch { return {}; }
  })() as Record<string, unknown>;

  // the {{task.*}} sample — the declared provider's contextFields (unknown
  // provider → the generic keys every provider fills)
  const provider = taskRegistry.maybe(String(trigger.task_type ?? ""));
  const task: Record<string, unknown> = {
    key: "TASK-1",
    summary: "Sample task",
    description: "",
    status: "",
    priority: "",
    issue_type: "",
    repo_url: "",
    parent_key: "",
    url: "",
    type: provider?.kind ?? "",
    ...Object.fromEntries((provider?.contextFields ?? []).map((f) => [f.key, sampleValue(f.type)])),
  };

  // the {{nodes.<key>.output.*}} sample — each node's declared output fields
  const nodes: Record<string, { output: unknown }> = {};
  const nodeRows = db.all<{ node_key: string; node_template_id: string; config: string | null }>(
    `SELECT node_key, node_template_id, config FROM flow_template_nodes WHERE template_id=?`,
    templateId
  );
  for (const r of nodeRows) {
    const nt = db.get<{ kind: string; config: string | null }>(
      `SELECT kind, config FROM node_templates WHERE id=?`, r.node_template_id
    );
    if (!nt) continue;
    let instConfig: unknown = {};
    try { instConfig = r.config ? JSON.parse(r.config) : {}; } catch { /* {} */ }
    let defConfig: unknown = {};
    try { defConfig = nt.config ? JSON.parse(nt.config) : {}; } catch { /* {} */ }
    const merged = { ...(defConfig as Record<string, unknown>), ...(instConfig as Record<string, unknown>) };
    const fields = outputFieldsFor(nt.kind, merged);
    nodes[r.node_key] = {
      output: fields == null
        ? {}
        : Object.fromEntries(fields.map((f) => [f, sampleValue("string")])),
    };
  }

  return {
    task,
    repo: { cloud_url: "https://git.example.com/acme/widgets", local_path: "/workspaces/widgets" },
    flow: { mr_url: "https://git.example.com/acme/widgets/-/merge_requests/42", mr_branch: "sample/branch" },
    trigger: { payload: sampleTriggerPayload(templateId) },
    nodes,
  };
}

/**
 * The delivery scope's canned payload — shaped from the template's start-node
 * contract (what a webhook delivery must satisfy); nothing declared → `{}`.
 */
function sampleTriggerPayload(templateId: string): Record<string, unknown> {
  const entryKey = nodeRegistry.entryKey();
  const row = db.get<{ config: string | null }>(
    `SELECT n.config FROM flow_template_nodes n
     JOIN node_templates t ON t.id = n.node_template_id
     WHERE n.template_id=? AND t.key=?`,
    templateId, entryKey
  );
  if (!row?.config) return {};
  let config: unknown = {};
  try { config = JSON.parse(row.config); } catch { return {}; }
  return Object.fromEntries(
    parseStartContract(config).map((f) => [f.key, f.default !== undefined ? f.default : sampleValue(f.type)]),
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!db.get(`SELECT id FROM flow_templates WHERE id=?`, id)) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null) as null | { expr?: unknown; scope?: unknown };
  const expr = typeof body?.expr === "string" ? body.expr : "";
  // narrow the scope string to the union the branches below switch on
  const scope: PreviewScope =
    body?.scope === "response" || body?.scope === "delivery" ? body.scope : "context";
  if (!expr.trim()) return NextResponse.json({ ok: true, value: undefined, source: "sample" });

  let context: unknown;
  let source: "run" | "sample" = "sample";
  if (scope === "context") {
    // real data when it exists: the template's most recent flow run
    const flow = db.get<{ id: string }>(
      `SELECT id FROM flows WHERE template_id=? ORDER BY updated_at DESC LIMIT 1`, id
    );
    if (flow) {
      try {
        context = buildFlowContext(flowEngine.ctx(flow.id));
        source = "run";
      } catch { /* fall through to the sample */ }
    }
    if (!context) context = sampleContext(id);
  } else if (scope === "response") {
    // an http node's response_map evaluates against the raw response object
    context = {
      status: 200,
      ok: true,
      body: { message: "sample response" },
      headers: { "content-type": "application/json" },
    };
  } else {
    // the webhook filter sees the delivery body and the request headers
    context = {
      payload: sampleTriggerPayload(id),
      headers: { "content-type": "application/json" },
    };
  }

  const r = await evalJsonata(expr, context);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, source });
  return NextResponse.json({ ok: true, value: r.value ?? null, source });
}
