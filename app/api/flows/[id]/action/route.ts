import { NextResponse } from "next/server";
import { flowEngine } from "../../../../../lib/engine/flow";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, (flowId: string, body: any) => void | Promise<void>> = {
  start_plan: (id, b) => flowEngine.startPlan(id, b.prompt, b.decompose, b.model, b.promptIsBody, b.complex),
  refine_plan: (id, b) => flowEngine.refinePlan(id, b.feedback ?? "", b.prompt, b.model, b.promptIsBody, b.complex, b.branchRef, b.fresh, b.contextBlocks),
  approve_plan: (id) => flowEngine.approvePlan(id),
  update_plan_steps: (id, b) => flowEngine.updatePlanSteps(id, b.steps ?? []),
  set_plan_step: (id, b) => flowEngine.setPlanStepStatus(id, b.stepId, b.status),
  approve_build: (id, b) => flowEngine.approveBuild(id, b.branch),
  pipeline: (id, b) => flowEngine.triggerPipelineGate(id, b.pipelineId, b.prompt, b.model, b.promptIsBody),
  resolve: (id, b) => flowEngine.triggerResolve(id, b.prompt, b.model, b.promptIsBody),
  review: (id, b) => flowEngine.triggerReview(id, b.prompt, b.model, b.promptIsBody),
  retry: (id, b) => flowEngine.retryNode(id, b.nodeKey),
  cancel: (id, b) => flowEngine.cancelNode(id, b.nodeKey),
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const fn = ACTIONS[body.action];
  if (!fn) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    await fn(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
