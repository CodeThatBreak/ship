import { FLOW_ACTION } from "@/constants/flow";
import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { flowActionBodySchema, type FlowActionBody } from "@/lib/schemas/flowActionBody";
import { NextResponse } from "next/server";
import { flowEngine } from "../../../../../lib/engine/flowEngine";
import type { TriggerResult } from "../../../../../lib/engine/runtime/triggers/types/triggerGateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dispatchAction = async (flowId: string, body: FlowActionBody): Promise<TriggerResult | undefined> => {
  switch (body.action) {
    case FLOW_ACTION.APPROVE_PLAN:
      return flowEngine.approvePlan(flowId, body.executionOverride);
    case FLOW_ACTION.UPDATE_PLAN_STEPS:
      await flowEngine.updatePlanSteps(flowId, body.steps);
      return undefined;
    case FLOW_ACTION.SET_PLAN_STEP:
      await flowEngine.setPlanStepStatus(flowId, body.stepId, body.status);
      return undefined;
    case FLOW_ACTION.APPROVE_BUILD:
      return flowEngine.approveBuild(flowId, body.branch);
    case FLOW_ACTION.PIPELINE:
      return flowEngine.triggerPipelineGate(flowId, body.pipelineId, body.model);
    case FLOW_ACTION.RESOLVE:
      return flowEngine.triggerResolve(flowId, body.model);
    case FLOW_ACTION.REVIEW:
      return flowEngine.triggerReview(flowId, body.model);
    case FLOW_ACTION.RETRY:
      return flowEngine.retryNode(flowId, body.nodeKey);
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
      return flowEngine.approveNode(flowId, body.nodeKey);
    case FLOW_ACTION.SET_NODE_CONFIG:
      await flowEngine.setNodeConfig(flowId, body.nodeKey, body.config);
      return undefined;
    case FLOW_ACTION.CHOOSE_NODE:
      await flowEngine.chooseNode(flowId, body.nodeKey, body.chosen, body.rationale);
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
      await flowEngine.skipSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      return undefined;
    case FLOW_ACTION.RETRY_SPLIT_UNIT:
      await flowEngine.retrySplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      return undefined;
    case FLOW_ACTION.APPROVE_SPLIT_UNIT:
      await flowEngine.approveSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      return undefined;
    case FLOW_ACTION.CANCEL_SPLIT_UNIT:
      await flowEngine.cancelSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
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
