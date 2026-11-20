import "server-only";

import { z } from "zod";
import { AGENT_TOOL } from "../constants/agentTools";

/**
 * The agent-tools request body (step 08): a discriminated union on `tool` —
 * the boundary validation the route hands to the service. Payloads are the
 * engine-owned shapes, so the schemas live with the feature (§12).
 */
export const agentToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal(AGENT_TOOL.READ_FLOW_STATE) }),
  z.object({
    tool: z.literal(AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS),
    stepIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    tool: z.literal(AGENT_TOOL.REPORT_FAILURE),
    reason: z.string().min(1).max(2000),
    detail: z.string().max(8000).optional(),
  }),
]);

export type AgentToolCallPayload = z.infer<typeof agentToolCallSchema>;
