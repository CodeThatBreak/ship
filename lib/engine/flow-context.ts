import type { FlowCtx } from "./nodes/base";
import { db } from "../db";

/**
 * The flow context map (§3 input mapping): the single variable universe every
 * JSONata expression and `{{...}}` template evaluates against.
 *
 *   task    { key, summary, description, prd }   — `ticket` is the same
 *                                                  object (legacy alias, {{ticket.*}})
 *   repo    { cloud_url, local_path }
 *   flow    { mr_url, mr_branch }
 *   trigger { payload }            — the payload that started the flow (Phase 4 webhook / simulated)
 *   nodes   { <node_key>: { output } }
 *
 * `secrets` is deliberately NOT part of the map: secret values only resolve
 * inside http node config interpolation, at execution time, and never persist
 * into rows, inputs, or events.
 */
export interface FlowContextMap extends Record<string, unknown> {
  task: Record<string, unknown>;
  /** deprecated alias of `task` (same object) — keeps old {{ticket.*}} templates working */
  ticket: Record<string, unknown>;
  repo: Record<string, unknown>;
  flow: Record<string, unknown>;
  trigger: { payload: unknown };
  nodes: Record<string, { output: unknown }>;
}

export function buildFlowContext(ctx: FlowCtx): FlowContextMap {
  const nodes: Record<string, { output: unknown }> = {};
  const rowsOut = db.all<{ node_key: string; output: unknown }>(
    `SELECT node_key, output FROM nodes WHERE flow_id=?`, ctx.flow.id
  );
  for (const r of rowsOut) {
    // db.all is the raw row — the output column is a JSON TEXT blob
    nodes[r.node_key] = { output: parseJsonObject(r.output) };
  }
  let payload: unknown = ctx.flow.trigger_payload ?? null;
  if (typeof payload === "string") payload = parseJsonObject(payload);
  const task = {
    key: ctx.task.key,
    summary: ctx.task.summary,
    description: ctx.task.description ?? "",
    prd: ctx.task.prdText ?? "",
  };
  return {
    task,
    ticket: task, // legacy alias — same object, dropped when {{ticket.*}} retires
    repo: {
      cloud_url: ctx.repo?.cloud_url ?? ctx.flow.repo_url ?? "",
      local_path: ctx.repo?.local_path ?? "",
    },
    flow: {
      mr_url: ctx.flow.mr_url ?? "",
      mr_branch: ctx.flow.mr_branch ?? "",
    },
    trigger: { payload },
    nodes,
  };
}

/** Defensive JSON-object parse for raw TEXT columns ({} when absent/invalid). */
function parseJsonObject(raw: unknown): unknown {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
