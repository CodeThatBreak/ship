import { NextResponse } from "next/server";
import { z } from "zod";
import { flowEngine } from "../../../../../lib/engine/flow-engine";
import type { PlanStepInput } from "../../../../../lib/engine/runtime/plan-step-store";

export const dynamic = "force-dynamic";

/**
 * The parsed action-route request body, typed to the engine's action
 * signatures. Request JSON is trusted-but-typed here (one boundary cast, no
 * per-field validation) — the thin-route/format work and real Zod validation
 * at this seam is a documented backend follow-up (docs/phase0-baseline.md).
 */
type ActionBody = {
  action?: string;
  prompt?: string;
  decompose?: boolean;
  model?: string;
  promptIsBody?: boolean;
  feedback?: string;
  branchRef?: string;
  fresh?: boolean;
  contextBlocks?: string[];
  executionOverride?: "whole" | "steps";
  steps?: PlanStepInput[];
  stepId?: string;
  status?: "pending" | "done";
  branch?: string;
  pipelineId?: number;
  nodeKey?: string;
  input?: Record<string, unknown>;
  config?: Record<string, unknown>;
  chosen?: string[];
  rationale?: string;
  // split per-unit actions (agent-node split plan §3)
  unitKey?: string;
  consumerNodeKey?: string;
};

const ACTIONS: Record<string, (flowId: string, body: ActionBody) => void | Promise<void>> = {
  start_plan: (id, b) => flowEngine.startPlan(id, b.prompt, b.decompose, b.model, b.promptIsBody),
  refine_plan: (id, b) => flowEngine.refinePlan(id, b.feedback ?? "", b.prompt, b.model, b.promptIsBody, b.branchRef, b.fresh, b.contextBlocks),
  approve_plan: (id, b) => flowEngine.approvePlan(id, b?.executionOverride),
  update_plan_steps: (id, b) => flowEngine.updatePlanSteps(id, b.steps ?? []),
  set_plan_step: (id, b) => {
    const stepId = requireString(b.stepId, "stepId");
    const status = requireString(b.status, "status");
    if (status !== "pending" && status !== "done") throw new Error("status is pending|done");
    flowEngine.setPlanStepStatus(id, stepId, status);
  },
  approve_build: (id, b) => flowEngine.approveBuild(id, b.branch),
  pipeline: (id, b) => flowEngine.triggerPipelineGate(id, b.pipelineId, b.prompt, b.model, b.promptIsBody),
  resolve: (id, b) => flowEngine.triggerResolve(id, b.prompt, b.model, b.promptIsBody),
  review: (id, b) => flowEngine.triggerReview(id, b.prompt, b.model, b.promptIsBody),
  retry: (id, b) => flowEngine.retryNode(id, requireString(b.nodeKey, "nodeKey")),
  cancel: (id, b) => flowEngine.cancelNode(id, requireString(b.nodeKey, "nodeKey")),
  // Phase 2: generic template-driven node actions (declarative nodes)
  run_node: (id, b) => flowEngine.runNodeManual(id, requireString(b.nodeKey, "nodeKey"), { prompt: b.prompt, model: b.model, input: b.input }),
  approve_node: (id, b) => flowEngine.approveNode(id, requireString(b.nodeKey, "nodeKey")),
  set_node_config: (id, b) => flowEngine.setNodeConfig(id, requireString(b.nodeKey, "nodeKey"), b.config ?? {}),
  // Phase 3: decision branch picks (manual source / approval override)
  choose_node: (id, b) => flowEngine.chooseNode(id, requireString(b.nodeKey, "nodeKey"), b.chosen ?? [], b.rationale),
  // plan fan-out (Phase 1): parent-panel step-card actions (approve/retry/skip a child)
  approve_fanout_step: (id, b) => flowEngine.approveFanoutStep(id, requireString(b.stepId, "stepId")),
  retry_fanout_step: (id, b) => flowEngine.retryFanoutStep(id, requireString(b.stepId, "stepId")),
  skip_fanout_step: (id, b) => flowEngine.skipFanoutStep(id, requireString(b.stepId, "stepId")),
  // split runtime (agent-node split plan §3): per-unit actions, addressed by
  // unit key (+ optional consumer node key), Zod-validated at this boundary
  // (§3.4 — the legacy actions above predate the rule and stay as they are)
  skip_split_unit: async (id, b) => {
    const body = parseSplitUnitBody(b);
    await flowEngine.skipSplitUnit(id, body.unitKey, body.consumerNodeKey);
  },
  retry_split_unit: (id, b) => {
    const body = parseSplitUnitBody(b);
    flowEngine.retrySplitUnit(id, body.unitKey, body.consumerNodeKey);
  },
  approve_split_unit: (id, b) => {
    const body = parseSplitUnitBody(b);
    flowEngine.approveSplitUnit(id, body.unitKey, body.consumerNodeKey);
  },
  cancel_split_unit: async (id, b) => {
    const body = parseSplitUnitBody(b);
    await flowEngine.cancelSplitUnit(id, body.unitKey, body.consumerNodeKey);
  },
};

/**
 * Required body field — the action queue's ids are the engine's keys.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} required`);
  return value;
}

/**
 * The split per-unit actions' body — Zod-validated at this boundary (§3.4;
 * new actions validate, the legacy ones above predate the rule). Addressed
 * by `unitKey`, with the consumer node key optional (it resolves through the
 * split linkage when omitted).
 */
const splitUnitBody = z.object({
  unitKey: z.string().min(1, "unitKey required"),
  consumerNodeKey: z.string().min(1).optional(),
});

function parseSplitUnitBody(b: ActionBody): z.infer<typeof splitUnitBody> {
  const r = splitUnitBody.safeParse(b);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`invalid split unit body${issue ? ` — ${issue.path.join(".") || "body"}: ${issue.message}` : ""}`);
  }
  return r.data;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as ActionBody;
  const actionName = typeof body.action === "string" ? body.action : "";
  const fn = actionName ? ACTIONS[actionName] : undefined;
  if (!fn) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    await fn(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
