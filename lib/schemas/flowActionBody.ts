import "server-only";

import { z } from "zod";
import { FLOW_ACTION } from "@/constants/flow";

const planStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().optional(),
  files: z.array(z.string()).optional(),
  branch: z.string().nullable().optional(),
});

const promptFields = {
  prompt: z.string().optional(),
  model: z.string().optional(),
  promptIsBody: z.boolean().optional(),
};

const splitUnitFields = {
  unitKey: z.string().min(1),
  consumerNodeKey: z.string().min(1).optional(),
};

export const flowActionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal(FLOW_ACTION.APPROVE_PLAN),
    executionOverride: z.enum(["whole", "steps"]).optional(),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.UPDATE_PLAN_STEPS),
    steps: z.array(planStepSchema),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.SET_PLAN_STEP),
    stepId: z.string().min(1),
    status: z.enum(["pending", "done"]),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.APPROVE_BUILD),
    branch: z.string().optional(),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.PIPELINE),
    ...promptFields,
    pipelineId: z.coerce.number().optional(),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.RESOLVE),
    ...promptFields,
  }),
  z.object({
    action: z.literal(FLOW_ACTION.REVIEW),
    ...promptFields,
  }),
  z.object({
    action: z.literal(FLOW_ACTION.RETRY),
    nodeKey: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.CANCEL),
    nodeKey: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.RUN_NODE),
    nodeKey: z.string().min(1),
    prompt: z.string().optional(),
    model: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.APPROVE_NODE),
    nodeKey: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.SET_NODE_CONFIG),
    nodeKey: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.CHOOSE_NODE),
    nodeKey: z.string().min(1),
    chosen: z.array(z.string()),
    rationale: z.string().optional(),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.APPROVE_FANOUT_STEP),
    stepId: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.RETRY_FANOUT_STEP),
    stepId: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.SKIP_FANOUT_STEP),
    stepId: z.string().min(1),
  }),
  z.object({
    action: z.literal(FLOW_ACTION.SKIP_SPLIT_UNIT),
    ...splitUnitFields,
  }),
  z.object({
    action: z.literal(FLOW_ACTION.RETRY_SPLIT_UNIT),
    ...splitUnitFields,
  }),
  z.object({
    action: z.literal(FLOW_ACTION.APPROVE_SPLIT_UNIT),
    ...splitUnitFields,
  }),
  z.object({
    action: z.literal(FLOW_ACTION.CANCEL_SPLIT_UNIT),
    ...splitUnitFields,
  }),
]);

export type FlowActionBody = z.infer<typeof flowActionBodySchema>;
