import "server-only";

import type { AgentToolName } from "../constants/agentTools";

export type { AgentToolName };

/**
 * A tool a node kind's running agent may call (step 08, Invariant 10): the
 * name (the closed `AGENT_TOOL` vocabulary) and the description rendered
 * into the prompt's "Tools available" block. Node kinds declare the tools
 * they get via `NodeDefinition.agentTools()`; the AgentToolService enforces
 * the allowlist per call.
 */
export interface ToolDescriptor {
  name: AgentToolName;
  description: string;
}

/**
 * The authenticated call context the service resolves before any tool runs:
 * the attempt that still owns the node, and the run row whose capability
 * token authenticated the request.
 */
export interface AgentToolAuth {
  flowId: string;
  nodeKey: string;
  nodeId: string;
  attemptId: string;
  /** the startup run row id (audit attribution) */
  runRowId: string;
  /** the node row's def key (the declarative/template def key, not the instance key) */
  defKey: string;
}

/** The request the tools endpoint dispatches: name + its validated payload. */
export interface AgentToolCall {
  tool: AgentToolName;
  /** claim_checklist_progress — the plan-step ids (row ids or meta ids) */
  stepIds?: string[];
  /** report_failure */
  reason?: string;
  detail?: string;
}

/**
 * One agent tool: its prompt-facing descriptor plus the executor the
 * AgentToolService dispatches to after auth + capability gating. `execute`
 * receives the validated call — implementers narrow on `call.tool`.
 */
export interface AgentToolExecutor {
  readonly name: AgentToolName;
  readonly description: string;
  execute(auth: AgentToolAuth, call: AgentToolCall): Promise<unknown>;
}
