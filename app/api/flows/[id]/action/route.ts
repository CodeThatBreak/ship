import { FLOW_ACTION } from "@/constants/flow";
import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { flowActionBodySchema, type FlowActionBody } from "@/lib/schemas/flowActionBody";
import { NextResponse } from "next/server";
import { flowEngine } from "../../../../../lib/engine/flowEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dispatchAction = async (flowId: string, body: FlowActionBody): Promise<void> => {
  switch (body.action) {
    case FLOW_ACTION.APPROVE_PLAN:
      await flowEngine.approvePlan(flowId, body.executionOverride);
      break;
    case FLOW_ACTION.UPDATE_PLAN_STEPS:
      await flowEngine.updatePlanSteps(flowId, body.steps);
      break;
    case FLOW_ACTION.SET_PLAN_STEP:
      await flowEngine.setPlanStepStatus(flowId, body.stepId, body.status);
      break;
    case FLOW_ACTION.APPROVE_BUILD:
      await flowEngine.approveBuild(flowId, body.branch);
      break;
    case FLOW_ACTION.PIPELINE:
      await flowEngine.triggerPipelineGate(flowId, body.pipelineId, body.model);
      break;
    case FLOW_ACTION.RESOLVE:
      await flowEngine.triggerResolve(flowId, body.model);
      break;
    case FLOW_ACTION.REVIEW:
      await flowEngine.triggerReview(flowId, body.model);
      break;
    case FLOW_ACTION.RETRY:
      await flowEngine.retryNode(flowId, body.nodeKey);
      break;
    case FLOW_ACTION.CANCEL:
      await flowEngine.cancelNode(flowId, body.nodeKey);
      break;
    case FLOW_ACTION.RUN_NODE:
      await flowEngine.runNodeManual(flowId, body.nodeKey, {
        prompt: body.prompt,
        model: body.model,
        input: body.input,
      });
      break;
    case FLOW_ACTION.APPROVE_NODE:
      await flowEngine.approveNode(flowId, body.nodeKey);
      break;
    case FLOW_ACTION.SET_NODE_CONFIG:
      await flowEngine.setNodeConfig(flowId, body.nodeKey, body.config);
      break;
    case FLOW_ACTION.CHOOSE_NODE:
      await flowEngine.chooseNode(flowId, body.nodeKey, body.chosen, body.rationale);
      break;
    case FLOW_ACTION.APPROVE_FANOUT_STEP:
      await flowEngine.approveFanoutStep(flowId, body.stepId);
      break;
    case FLOW_ACTION.RETRY_FANOUT_STEP:
      await flowEngine.retryFanoutStep(flowId, body.stepId);
      break;
    case FLOW_ACTION.SKIP_FANOUT_STEP:
      await flowEngine.skipFanoutStep(flowId, body.stepId);
      break;
    case FLOW_ACTION.SKIP_SPLIT_UNIT:
      await flowEngine.skipSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case FLOW_ACTION.RETRY_SPLIT_UNIT:
      await flowEngine.retrySplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case FLOW_ACTION.APPROVE_SPLIT_UNIT:
      await flowEngine.approveSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case FLOW_ACTION.CANCEL_SPLIT_UNIT:
      await flowEngine.cancelSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
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
    await dispatchAction(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
