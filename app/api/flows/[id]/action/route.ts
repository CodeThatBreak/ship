import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { flowActionBodySchema, type FlowActionBody } from "@/lib/schemas/flow-action-body";
import { NextResponse } from "next/server";
import { flowEngine } from "../../../../../lib/engine/flow-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dispatchAction = async (flowId: string, body: FlowActionBody): Promise<void> => {
  switch (body.action) {
    case "approve_plan":
      flowEngine.approvePlan(flowId, body.executionOverride);
      break;
    case "update_plan_steps":
      flowEngine.updatePlanSteps(flowId, body.steps);
      break;
    case "set_plan_step":
      flowEngine.setPlanStepStatus(flowId, body.stepId, body.status);
      break;
    case "approve_build":
      flowEngine.approveBuild(flowId, body.branch);
      break;
    case "pipeline":
      flowEngine.triggerPipelineGate(
        flowId,
        body.pipelineId,
        body.prompt,
        body.model,
        body.promptIsBody,
      );
      break;
    case "resolve":
      flowEngine.triggerResolve(flowId, body.prompt, body.model, body.promptIsBody);
      break;
    case "review":
      flowEngine.triggerReview(flowId, body.prompt, body.model, body.promptIsBody);
      break;
    case "retry":
      flowEngine.retryNode(flowId, body.nodeKey);
      break;
    case "cancel":
      flowEngine.cancelNode(flowId, body.nodeKey);
      break;
    case "run_node":
      flowEngine.runNodeManual(flowId, body.nodeKey, {
        prompt: body.prompt,
        model: body.model,
        input: body.input,
      });
      break;
    case "approve_node":
      flowEngine.approveNode(flowId, body.nodeKey);
      break;
    case "set_node_config":
      flowEngine.setNodeConfig(flowId, body.nodeKey, body.config);
      break;
    case "choose_node":
      flowEngine.chooseNode(flowId, body.nodeKey, body.chosen, body.rationale);
      break;
    case "approve_fanout_step":
      flowEngine.approveFanoutStep(flowId, body.stepId);
      break;
    case "retry_fanout_step":
      flowEngine.retryFanoutStep(flowId, body.stepId);
      break;
    case "skip_fanout_step":
      flowEngine.skipFanoutStep(flowId, body.stepId);
      break;
    case "skip_split_unit":
      await flowEngine.skipSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case "retry_split_unit":
      flowEngine.retrySplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case "approve_split_unit":
      flowEngine.approveSplitUnit(flowId, body.unitKey, body.consumerNodeKey);
      break;
    case "cancel_split_unit":
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
