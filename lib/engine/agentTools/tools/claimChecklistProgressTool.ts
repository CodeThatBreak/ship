import "server-only";

import { EVENT_KIND } from "../../constants/vocabulary";
import { AGENT_API_COMPLETED_BY, AGENT_TOOL, AGENT_TOOL_DESCRIPTORS } from "../constants/agentTools";
import type { AgentToolAuth, AgentToolCall, AgentToolExecutor } from "../types/tools";
import type { PlanStepStore } from "../../runtime/planStepStore";
import type { Database } from "../../../db/database";
import { ValidationError } from "../../../errors";

/**
 * `claim_checklist_progress` (step 08, Invariant 10) — build/step-build only:
 * the authoritative build-progress path. The agent claims the plan-step ids
 * it fully completed; claims are idempotent per step id (an already-done
 * step is skipped, not an error) and unknown ids are rejected loudly — a
 * hallucinated id must never silently vanish.
 */
export class ClaimChecklistProgressTool implements AgentToolExecutor {
  readonly name = AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS;
  readonly description = AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS].description;

  constructor(
    private readonly planSteps: PlanStepStore,
    private readonly database: Database,
  ) {}

  async execute(auth: AgentToolAuth, call: AgentToolCall): Promise<unknown> {
    const refs = call.stepIds ?? [];
    const rows = await this.planSteps.list(auth.flowId);
    const unknown = refs.filter((ref) => !rows.some((s) => s.id === ref || s.metaId === ref));
    if (unknown.length > 0) {
      throw new ValidationError(`unknown plan step id(s): ${unknown.join(", ")}`);
    }
    const matches = (s: { id: string; metaId: string | null }): boolean =>
      (s.metaId != null && refs.includes(s.metaId)) || refs.includes(s.id);
    const claimed: string[] = [];
    for (const step of rows.filter((s) => s.status !== "done" && matches(s))) {
      const applied = await this.planSteps.setStatus(auth.flowId, step.id, "done", AGENT_API_COMPLETED_BY);
      if (applied) claimed.push(step.metaId ?? step.id);
    }
    if (claimed.length > 0) {
      await this.database.emitEvent(
        auth.flowId,
        auth.nodeId,
        EVENT_KIND.LIFECYCLE,
        `agent claimed ${claimed.length} plan step${claimed.length > 1 ? "s" : ""} via the progress API: ${claimed.join("; ")}`,
        { nodeKey: auth.nodeKey, attemptId: auth.attemptId, steps: claimed },
      );
    }
    return {
      claimed,
      alreadyDone: refs.filter((ref) => !claimed.includes(ref)),
    };
  }
}
