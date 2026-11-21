import "server-only";

import { EFFECT_VERB } from "../../runtime/effects/constants/effectVerbs";
import type { VerbCtx } from "../../runtime/effects/verbs/types/verbDescriptor";
import { TRIGGER_SOURCE } from "../../runtime/triggers/constants/triggerSources";
import { AGENT_TOOL, AGENT_TOOL_DESCRIPTORS } from "../constants/agentTools";
import type { RunVerb } from "../types/runVerb";
import type { AgentToolAuth, AgentToolCall, AgentToolExecutor } from "../types/tools";

/**
 * `create_change_request` (task 13, design §4.2 — C4/use case 4): the agent
 * ASKS to open the MR. The tool runs the SAME verb the declarative wildcard
 * effects dispatch — through the injected verb-run seam — so the engine, not
 * the agent's prose, authoritatively establishes the change_request fact.
 *
 * Invariants upheld:
 * - Invariant 10: the AgentToolService already authenticated the attempt's
 *   capability token and authorized the call against the node's allowlist
 *   (`def.agentTools()` ∩ the node's declared `agent_tools`) before this
 *   executor runs.
 * - The verb runs under the node's attempt claim (the same discipline verbs
 *   use): the ctx carries the authenticated attempt's identity; the verb
 *   journals the MR-creation sequence through `jobs` (Invariant 7) itself.
 *
 * Must never: create an MR through a parallel path, write node status, or
 * report success for a verb run that returned `false` (another live intent
 * owns the creation — the answer reports exactly what happened).
 */
export class CreateChangeRequestTool implements AgentToolExecutor {
  readonly name = AGENT_TOOL.CREATE_CHANGE_REQUEST;
  readonly description = AGENT_TOOL_DESCRIPTORS[AGENT_TOOL.CREATE_CHANGE_REQUEST].description;

  constructor(private readonly runVerb: RunVerb) {}

  async execute(auth: AgentToolAuth, call: AgentToolCall): Promise<unknown> {
    // the authenticated attempt's identity — the verb's claim discipline is
    // the same one the effect dispatch carries; `status`/`output` are null
    // because no lifecycle fired (this is an agent-initiated request, and the
    // verb reads neither). `UI` is the synchronous-interactive dispatch
    // source the tools endpoint's authenticated call maps to.
    const ctx: VerbCtx = {
      flowId: auth.flowId,
      nodeKey: auth.nodeKey,
      defKey: auth.defKey,
      status: null,
      output: null,
      attemptId: auth.attemptId,
      source: TRIGGER_SOURCE.UI,
      ...(call.branchName != null ? { params: { branchName: call.branchName } } : {}),
    };
    const created = await this.runVerb(EFFECT_VERB.CREATE_CHANGE_REQUEST, ctx);
    return { requested: true, created };
  }
}
