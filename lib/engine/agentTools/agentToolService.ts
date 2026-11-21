import "server-only";

import { db } from "../../db/app";
import { NODE_STATUS } from "../constants/nodeStatus";
import { EVENT_KIND, RUN_STATUS } from "../constants/vocabulary";
import type { AgentToolName } from "./constants/agentTools";
import { AGENT_TOOL } from "./constants/agentTools";
import type { AgentToolAuth, AgentToolCall } from "./types/tools";
import type { AgentToolCallPayload } from "./schemas/agentToolCalls";
import type { ToolRegistry } from "./toolRegistry";
import type { NodeSupport } from "../nodes/shared/nodeSupport";
import type { TransitionAuthority } from "../runtime/transitions/nodeTransitions";
import { capabilityTokensEqual } from "../runtime/transitions/utils/capabilityToken";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../errors";

/**
 * AgentToolService (step 08, Invariant 10) — the ONE door for a running
 * agent's self-repair calls: authenticate (per-attempt capability token →
 * the run row → the node row), authorize (the node kind's `agentTools()`
 * allowlist ∩ the node's declared `agent_tools` — task 13, Invariant 10),
 * dispatch (the ToolRegistry). Transport-agnostic — the REST
 * route is today's adapter; an MCP server can ride the same service later.
 *
 * Must never: authenticate against anything but the attempt's own run row
 * (constant-time compare), dispatch a tool a kind did not declare, or touch
 * a node other than the token's own (the tools receive only this auth).
 */
export class AgentToolService {
  constructor(
    private readonly support: NodeSupport,
    private readonly transitions: TransitionAuthority,
    private readonly registry: ToolRegistry,
  ) {}

  /** Validate one tool call end-to-end. Throws the typed errors the route
   *  maps to HTTP (401 unauthorized / 404 not found / 403 forbidden / 409
   *  conflict / 400 invalid input). */
  async dispatch(params: {
    flowId: string;
    nodeKey: string;
    token: string;
    call: AgentToolCallPayload;
  }): Promise<unknown> {
    const auth = await this.authenticate(params.flowId, params.nodeKey, params.token);
    await this.authorize(auth, params.call.tool);
    const executor = this.registry.executorOf(params.call.tool);
    if (!executor) {
      throw new NotFoundError("agent tool", params.call.tool);
    }
    const result = await executor.execute(auth, this.toCall(params.call));
    await db.emitEvent(auth.flowId, auth.nodeId, EVENT_KIND.TOOL, `${params.call.tool}: ok`, {
      nodeKey: auth.nodeKey,
      attemptId: auth.attemptId,
      runId: auth.runRowId,
    });
    return result;
  }

  /**
   * Token → attempt → node: the presented token must equal — constant-time —
   * the run row's minted token, the run row must still be `running`, its
   * attempt must still own the node (`nodes.attempt_id` match on a
   * `running` node). Every mismatch is the same 401 — no oracle for which
   * check failed.
   */
  private async authenticate(flowId: string, nodeKey: string, token: string): Promise<AgentToolAuth> {
    if (!token) throw new UnauthorizedError("missing agent tool token");
    const node = await this.support.optionalNodeByKey(flowId, nodeKey);
    if (!node) throw new NotFoundError("node", nodeKey);
    if (node.status !== NODE_STATUS.RUNNING || node.attemptId == null) {
      throw new UnauthorizedError("the attempt no longer owns this node");
    }
    const run = await this.runningRunForNode(node.id);
    if (!run || run.attemptId !== node.attemptId || run.apiToken == null) {
      throw new UnauthorizedError("the attempt no longer owns this node");
    }
    if (!capabilityTokensEqual(token, run.apiToken)) {
      throw new UnauthorizedError("the attempt no longer owns this node");
    }
    return {
      flowId,
      nodeKey,
      nodeId: node.id,
      attemptId: node.attemptId,
      runRowId: run.id,
      defKey: node.type,
    };
  }

  /** The node's current `running` run row — the attempt's credential holder:
   *  its `api_token` is what the presented token compares against. */
  private async runningRunForNode(nodeId: string): Promise<{
    id: string;
    runRef: string;
    attemptId: string | null;
    apiToken: string | null;
  } | null> {
    return (
      await db.prisma.run.findFirst({
        where: { nodeId, status: RUN_STATUS.RUNNING },
        orderBy: { createdAt: "desc" },
        select: { id: true, runRef: true, attemptId: true, apiToken: true },
      })
    ) ?? null;
  }

  /** The node kind's declared allowlist decides what its agent may call —
   *  intersected with the node's own declared `agent_tools` set (task 13,
   *  Invariant 10): a def that exposes per-node config can only NARROW the
   *  kind's allowlist, never widen it (a def without per-node config — null
   *  — keeps the kind's allowlist alone, today's behavior). The registry
   *  import is lazy (same construction-cycle break NodeStore documents:
   *  container → agentTools → registry → kinds → container). */
  private async authorize(auth: AgentToolAuth, tool: AgentToolName): Promise<void> {
    const { nodeRegistry } = await import("../nodes/registry");
    const def = await nodeRegistry.resolve(auth.defKey, auth.nodeKey);
    const declared = def.declaredAgentTools();
    const allowed = def.agentTools().some(
      (t) => t.name === tool && (declared == null || declared.includes(tool)),
    );
    if (!allowed) {
      throw new ForbiddenError(`tool ${tool} is not available to the ${def.label} node`);
    }
  }

  private toCall(payload: AgentToolCallPayload): AgentToolCall {
    switch (payload.tool) {
      case AGENT_TOOL.CLAIM_CHECKLIST_PROGRESS:
        return { tool: payload.tool, stepIds: payload.stepIds };
      case AGENT_TOOL.REPORT_FAILURE:
        return { tool: payload.tool, reason: payload.reason, detail: payload.detail };
      case AGENT_TOOL.CREATE_CHANGE_REQUEST:
        return { tool: payload.tool, branchName: payload.branchName };
      default:
        return { tool: payload.tool };
    }
  }
}
