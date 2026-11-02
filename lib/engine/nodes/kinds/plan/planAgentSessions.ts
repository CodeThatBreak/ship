import "server-only";

import type { NodeRow } from '../../../../db/rows';
import type { FlowCtx } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import { PlanOutput } from './schema';

/**
 * Resolves harness follow-up ids and persists per-thread agent cursors on the
 * plan node output blob (`branchAgents`) vs the whole-plan `agent_id`.
 */
export class PlanAgentSessions {
  constructor(private readonly support: NodeSupport) {}

  resolveFollowUp(node: NodeRow, branchRef: string | null): string | null {
    if (branchRef) {
      return this.readBranchAgents(node)?.[branchRef] ?? null;
    }
    return node.agent_id ?? this.support.lastAgentId(node.id);
  }

  recordAgent(ctx: FlowCtx, node: NodeRow, branchRef: string | null, agentId: string, wholeAgentId: string | null): void {
    if (!branchRef) {
      this.support.setNode(node.id, { agent_id: agentId });
      return;
    }
    const nodeNow = this.support.nodeByKey(ctx.flow.id, node.node_key);
    const branchAgents = { ...(this.readBranchAgents(nodeNow) ?? {}), [branchRef]: agentId };
    const merged = this.mergeBranchAgentsIntoOutput(nodeNow, branchAgents);
    this.support.setNode(node.id, {
      agent_id: wholeAgentId,
      output: merged,
    });
  }

  private readBranchAgents(node: NodeRow): Record<string, string> | undefined {
    const raw = this.outputRecord(node);
    if (!raw) return undefined;
    const agents = raw.branchAgents;
    if (!agents || typeof agents !== 'object') return undefined;
    return agents as Record<string, string>;
  }

  private mergeBranchAgentsIntoOutput(node: NodeRow, branchAgents: Record<string, string>): string {
    const raw = this.outputRecord(node) ?? {};
    const parsed = PlanOutput.safeParse({ ...raw, branchAgents });
    if (parsed.success) {
      return JSON.stringify(parsed.data);
    }
    return JSON.stringify({ ...raw, branchAgents });
  }

  private outputRecord(node: NodeRow): Record<string, unknown> | null {
    if (node.output == null) return null;
    if (typeof node.output === 'string') {
      try {
        const parsed: unknown = JSON.parse(node.output);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return node.output as Record<string, unknown>;
  }
}
