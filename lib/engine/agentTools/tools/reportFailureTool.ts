import "server-only";

import type { Database } from "../../../db/database";
import { EVENT_KIND } from "../../constants/vocabulary";
import { AGENT_TOOL, AGENT_TOOL_DESCRIPTORS } from "../constants/agentTools";
import type { AgentToolAuth, AgentToolCall, AgentToolExecutor } from "../types/tools";
import type { TransitionAuthority } from "../../runtime/transitions/nodeTransitions";
import { ConflictError } from "../../../errors";
import { RunSupersededError } from "../../errors/runSupersededError";

/**
 * `report_failure` (step 08, Invariant 10) — all agent kinds: the bounded
 * self-failure. The running agent fails its OWN node with its reason instead
 * of hallucinating success; the terminal goes through the transition
 * authority's declared `agentReportedFailure` row (actor "agent"), never a
 * raw status write. Bounded: one call per attempt — a second one is a 409
 * (checked off the durable event trail, so it survives restarts).
 */
export class ReportFailureTool implements AgentToolExecutor {
  readonly name = AGENT_TOOL.REPORT_FAILURE;
  readonly description = AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.REPORT_FAILURE].description;

  constructor(
    private readonly transitions: TransitionAuthority,
    private readonly database: Database,
  ) {}

  async execute(auth: AgentToolAuth, call: AgentToolCall): Promise<unknown> {
    const reason = call.reason ?? "";
    const already = await this.database.get<{ id: string }>(
      `SELECT id FROM events WHERE node_id=$1 AND type=$2 AND data->>'attemptId'=$3 LIMIT 1`,
      auth.nodeId,
      EVENT_KIND.AGENT_REPORTED_FAILURE,
      auth.attemptId,
    );
    if (already) {
      throw new ConflictError(`${AGENT_TOOL.REPORT_FAILURE} was already called for this attempt`);
    }
    try {
      await this.transitions.transitionFenced({
        flowId: auth.flowId,
        nodeKey: auth.nodeKey,
        nodeId: auth.nodeId,
        attemptId: auth.attemptId,
        key: "agentReportedFailure",
      });
    } catch (e: unknown) {
      // the attempt lost the node between auth and the terminal write — the
      // same 409 a second report would get, not a bare 500
      if (e instanceof RunSupersededError) {
        throw new ConflictError(`node ${auth.nodeKey} is no longer owned by this attempt`);
      }
      throw e;
    }
    await this.database.emitEvent(
      auth.flowId,
      auth.nodeId,
      EVENT_KIND.AGENT_REPORTED_FAILURE,
      `agent reported failure: ${reason}`,
      {
        nodeKey: auth.nodeKey,
        attemptId: auth.attemptId,
        runId: auth.runRowId,
        reason,
        ...(call.detail != null ? { detail: call.detail } : {}),
      },
    );
    return { reported: true };
  }
}
