import "server-only";

import type { FlowCtx } from "../nodes/shared/nodeSharedExports";
import { branchStore } from "../nodes/kinds/build/branchStore";
import { db } from "../../db/app";
import type { BranchStatus } from "../../db/constants/rowStatuses";

/**
 * The flow context map (§3 input mapping): the single variable universe every
 * JSONata expression and `{{...}}` template evaluates against.
 *
 *   task    the starting task — generic keys (key, summary, description,
 *           status, …, url, type) + the provider's `fields` JSON spread over
 *           them (fields keys override/augment; jira writes `fields.prd` /
 *           `fields.figma_urls`)
 *   repo    { cloud_url, local_path }
 *   flow    { mr_url, mr_branch, mr_iid }
 *   branches { <name>: { mr_iid, mr_url, status } } — the flow's branch rows
 *   trigger { payload }            — the payload that started the flow
 *   nodes   { <node_key>: { output } }
   input   { unit }               — split children (agent-node split plan §2.1):
                                    the own unit rides {{input.unit.*}}
 *
 * `secrets` is deliberately NOT part of the map: secret values only resolve
 * inside http node config interpolation, at execution time, and never persist
 * into rows, inputs, or events.
 */
export interface FlowContextMap extends Record<string, unknown> {
  task: Record<string, unknown>;
  repo: Record<string, unknown>;
  flow: Record<string, unknown>;
  branches: Record<string, { mr_iid: number | null; mr_url: string; status: BranchStatus }>;
  trigger: { payload: unknown };
  nodes: Record<string, { output: unknown }>;
  /** plan fan-out step children (Phase 1): the plan context, the own step and
   *  the sibling summaries — plain-empty on ordinary flows (no payload). */
  plan?: Record<string, unknown>;
  step?: Record<string, unknown>;
  siblings?: Record<string, unknown>[];
  /** split runtime children (agent-node split plan §2.1): the own unit —
   *  `{{input.unit.*}}` renders the item data; plain-empty on ordinary
   *  flows (no split payload). */
  input?: { unit: Record<string, unknown> };
}

export async function buildFlowContext(ctx: FlowCtx): Promise<FlowContextMap> {
  const nodes: Record<string, { output: unknown }> = {};
  const rowsOut = await db.prisma.node.findMany({
    where: { flowId: ctx.flow.id },
    select: { nodeKey: true, output: true },
  });
  for (const r of rowsOut) {
    // db.all is the raw row — the output column is a JSON TEXT blob
    nodes[r.nodeKey] = { output: parseJsonObject(r.output) };
  }
  const branches: FlowContextMap["branches"] = {};
  for (const b of await branchStore.list(ctx.flow.id)) {
    branches[b.name] = { mr_iid: b.mrIid, mr_url: b.mrUrl ?? "", status: b.status };
  }
  let payload: unknown = ctx.flow.triggerPayload ?? null;
  if (typeof payload === "string") payload = parseJsonObject(payload);
  // plan fan-out step children: the trigger payload carries {plan, step,
  // siblings} — alias them at the top level so child templates render the
  // documented step variables ({{plan}}, {{step.id}}, {{siblings}}) with the
  // existing renderers. Ordinary flows (no step payload) resolve empty strings.
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const step = (p.step && typeof p.step === "object" ? p.step : {}) as Record<string, unknown>;
  const planPart = (p.plan && typeof p.plan === "object" ? p.plan : {}) as Record<string, unknown>;
  const siblings = Array.isArray(p.siblings) ? (p.siblings as Record<string, unknown>[]) : [];
  // split runtime children: the trigger payload carries {parentNodeKey, unit} —
  // the unit is aliased at the top level so child templates render the
  // documented split variables ({{input.unit.key}}, {{input.unit.item.*}}).
  // Ordinary flows (no split payload) resolve an empty unit.
  const unit = (p.unit && typeof p.unit === "object" ? p.unit : {}) as Record<string, unknown>;
  return {
    task: taskContextOf(ctx),
    repo: {
      cloud_url: ctx.repo?.cloudUrl ?? ctx.flow.repoUrl ?? "",
      local_path: ctx.repo?.localPath ?? "",
    },
    flow: {
      mr_url: ctx.flow.mrUrl ?? "",
      mr_branch: ctx.flow.mrBranch ?? "",
      mr_iid: ctx.flow.mrIid,
    },
    branches,
    trigger: { payload },
    nodes,
    plan: planPart,
    step,
    siblings,
    input: { unit },
  };
}

/**
 * The `{{task.*}}` universe for one flow: the generic keys every provider
 * fills (including `url`, the external deep link, and `type`, the provider
 * kind) plus the provider's `fields` JSON spread over them (fields keys win —
 * a provider may both augment and override; e.g. jira's `prd` / `figma_urls`
 * hydrate from its `fields` payload).
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
    url: t.externalUrl ?? "",
    type: t.type ?? "",
    ...fields,
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
