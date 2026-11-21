import { FLOW_ACTION } from "@/constants/flow";
import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { flowActionBodySchema, type FlowActionBody } from "@/lib/schemas/flowActionBody";
import { NextResponse } from "next/server";
import { flowEngine } from "../../../../../lib/engine/flowEngine";
import { diffRefresh } from "../../../../../lib/engine/flow/diffRefresh";
import { splitManager } from "../../../../../lib/engine/runtime/split/splitManager";
import type { TriggerResult } from "../../../../../lib/engine/runtime/triggers/types/triggerGateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dispatchAction = async (flowId: string, body: FlowActionBody): Promise<TriggerResult | undefined> => {
  switch (body.action) {
    case FLOW_ACTION.APPROVE_PLAN:
      return flowEngine.approvals.approvePlan(flowId, body.executionOverride);
    case FLOW_ACTION.UPDATE_PLAN_STEPS:
      await flowEngine.planStepEdits.updatePlanSteps(flowId, body.steps);
      return undefined;
    case FLOW_ACTION.SET_PLAN_STEP:
      await flowEngine.planStepEdits.setPlanStepStatus(flowId, body.stepId, body.status);
      return undefined;
    case FLOW_ACTION.APPROVE_BUILD:
      return flowEngine.approveBuild(flowId, body.branch);
    case FLOW_ACTION.PIPELINE:
      return flowEngine.chain.triggerPipelineGate(flowId, body.pipelineId, body.model);
    case FLOW_ACTION.RESOLVE:
      return flowEngine.chain.triggerResolve(flowId, body.model);
    case FLOW_ACTION.REVIEW:
      return flowEngine.chain.triggerReview(flowId, body.model);
    case FLOW_ACTION.RETRY:
      return flowEngine.retries.retryNode(flowId, body.nodeKey);
    case FLOW_ACTION.CANCEL:
      await flowEngine.cancelNode(flowId, body.nodeKey);
      return undefined;
    case FLOW_ACTION.RUN_NODE:
      return flowEngine.runNodeManual(flowId, body.nodeKey, {
        prompt: body.prompt,
        model: body.model,
        input: body.input,
      });
    case FLOW_ACTION.APPROVE_NODE:
      return flowEngine.approvals.approveNode(flowId, body.nodeKey);
    case FLOW_ACTION.SET_NODE_CONFIG:
      await flowEngine.setNodeConfig(flowId, body.nodeKey, body.config);
      return undefined;
    case FLOW_ACTION.CHOOSE_NODE:
      await flowEngine.approvals.chooseNode(flowId, body.nodeKey, body.chosen, body.rationale);
      return undefined;
    case FLOW_ACTION.APPROVE_FANOUT_STEP:
      await flowEngine.approveFanoutStep(flowId, body.stepId);
      return undefined;
    case FLOW_ACTION.RETRY_FANOUT_STEP:
      await flowEngine.retryFanoutStep(flowId, body.stepId);
      return undefined;
    case FLOW_ACTION.SKIP_FANOUT_STEP:
      await flowEngine.skipFanoutStep(flowId, body.stepId);
      return undefined;
    case FLOW_ACTION.SKIP_SPLIT_UNIT:
      await splitManager.skipUnit(flowId, body.consumerNodeKey, body.unitKey);
      return undefined;
    case FLOW_ACTION.RETRY_SPLIT_UNIT:
      await splitManager.retryUnit(flowId, body.consumerNodeKey, body.unitKey);
      return undefined;
    case FLOW_ACTION.APPROVE_SPLIT_UNIT:
      await splitManager.approveUnit(flowId, body.consumerNodeKey, body.unitKey);
      return undefined;
    case FLOW_ACTION.CANCEL_SPLIT_UNIT:
      await splitManager.cancelUnit(flowId, body.consumerNodeKey, body.unitKey);
      return undefined;
    case FLOW_ACTION.REFRESH_DIFF:
      await diffRefresh.refresh(flowId, body.artifactId);
      return undefined;
    default: {
      const _exhaustive: never = body;
      throw _exhaustive;
    }
  }
};

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, flowActionBodySchema);
    const result = await dispatchAction(id, body);
    // step 06 (Invariant 11): a trigger that lost the atomic claim answers
    // 409 with the typed code — the skip event is already recorded on the
    // flow's feed, so the UI surfaces the skip instead of a generic error
    if (result && !result.started) {
      return NextResponse.json({ code: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
