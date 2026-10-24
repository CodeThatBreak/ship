import type { FlowCtx } from "./nodes/base";
import { db } from "../db";
import { templateStore } from "./templates";

/**
 * The flow context map (§3 input mapping): the single variable universe every
 * JSONata expression and `{{...}}` template evaluates against.
 *
 *   task    the starting task — common columns + the provider's `fields` JSON
 *           spread over them (fields keys override/augment; jira writes
 *           `fields.prd` / `fields.figma_urls`)
 *   ticket  the SAME object (legacy alias, {{ticket.*}} — deprecated; the
 *           first build per flow that still references it emits a breadcrumb)
 *   repo    { cloud_url, local_path }
 *   flow    { mr_url, mr_branch }
 *   trigger { payload }            — the payload that started the flow
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
  const task = taskContextOf(ctx);
  warnTicketAliasOnce(ctx);
  return {
    task,
    ticket: task, // legacy alias — same object, dropped when {{ticket.*}} retires (Phase 4)
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

/**
 * The `{{task.*}}` universe for one flow: the shared common columns plus the
 * provider's `fields` JSON spread over them (fields keys win — a provider may
 * both augment and override). `prd` / `figma_urls` hydrate through the Task
 * transform, which prefers `fields.*` and falls back to the legacy shared
 * columns for rows synced before the fields column existed.
 */
function taskContextOf(ctx: FlowCtx): Record<string, unknown> {
  const t = ctx.task;
  const fields = t.fields && typeof t.fields === "object" ? t.fields : {};
  return {
    key: t.key,
    summary: t.summary,
    description: t.description ?? "",
    status: t.status ?? "",
    priority: t.priority ?? "",
    issue_type: t.issueType ?? "",
    repo_url: t.repoUrl ?? "",
    parent_key: t.parentKey ?? "",
    prd: t.prdText ?? "",
    figma_urls: t.figmaUrls ?? [],
    ...fields,
  };
}

// ── {{ticket.*}} deprecation breadcrumb ──────────────────────────────────────

/** Flow ids whose alias breadcrumb was already written (one event per flow). */
const ticketAliasWarned = new Set<string>();
/** Set once per process — the console keeps one quiet line, not one per build. */
let ticketAliasLogged = false;

/**
 * Old YAML templates still reference `{{ticket.*}}` — the alias keeps them
 * working. When a flow's snapshot (its node configs + input maps, including
 * the underlying catalog definitions) still contains such refs, write a
 * one-time breadcrumb event into the flow's feed so the migration to
 * `{{task.*}}` is visible before the alias retires (Phase 4).
 */
function warnTicketAliasOnce(ctx: FlowCtx): void {
  if (ticketAliasWarned.has(ctx.flow.id)) return;
  const g = templateStore.graphForFlow(ctx.flow.id);
  if (!g) return;
  const usesTicket = g.nodes.some((n) =>
    refsTicket(JSON.stringify(n.config ?? {})) || refsTicket(JSON.stringify(n.inputMap ?? {}))
  );
  if (usesTicket) {
    db.emitEvent(
      ctx.flow.id, null, "deprecation",
      `{{ticket.*}} is deprecated — it resolves the same task object as {{task.*}}; ` +
      `switch this template's refs to {{task.*}} before the alias retires`
    );
    if (!ticketAliasLogged) {
      ticketAliasLogged = true;
      console.warn("[flow-context] {{ticket.*}} refs detected — deprecated alias of {{task.*}} (retires in Phase 4)");
    }
  }
  ticketAliasWarned.add(ctx.flow.id);
}

function refsTicket(raw: string): boolean {
  return /\{\{\s*ticket[.}\s]/.test(raw);
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
