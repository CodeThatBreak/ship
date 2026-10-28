/**
 * Probe the Cursor SDK getUsage() API. It is on a limited rollout — when it
 * doesn't answer, run costs fall back to our own list-price × tokens
 * calculation in lib/engine/nodes/shared/usage-tracker.ts (Enterprise discount
 * applied). This script just shows what the API currently returns.
 *
 *   npx tsx --env-file=.env scripts/cursor-usage.ts <agentId> [runId]
 *   npx tsx --env-file=.env scripts/cursor-usage.ts --db [limit]
 *
 * - <agentId> form: probes `Agent.getUsage(agentId, { runId? })` and the
 *   instance path (`Agent.resume(agentId, { apiKey }).getUsage()`).
 * - --db [limit]: probes the most recent agents from the runs table. Local
 *   agent ids stored without a prefix are retried as `agent-<uuid>` (the SDK
 *   requires 'agent-<uuid>' (local) or 'bc-<uuid>' (cloud)).
 */
process.env.DATABASE_PATH ??= "./data/devflow.db";
import { Agent, type AgentUsage } from "@cursor/sdk";
import { db } from "../lib/db";
import { cursorApiKey } from "../lib/integrations/cursor/credentials";

const apiKey = cursorApiKey();
if (!apiKey) {
  console.error(
    "No Cursor API key stored — save one on Settings → Integrations → Harness.",
  );
  process.exit(1);
}

/** SDK requires 'agent-<uuid>' (local) or 'bc-<uuid>' (cloud); the runs table
 *  may hold a bare uuid from older local runs — try the local prefix. */
function normalizeAgentId(id: string): string {
  return /^(agent-|bc-)/.test(id) ? id : `agent-${id}`;
}

function show(label: string, usage: AgentUsage | null) {
  if (!usage) {
    console.log(`${label}: null`);
    return;
  }
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(usage, null, 2));
  const rows = (usage.runs ?? []).map((e) => ({
    runId: e.runId,
    tokens: e.usage?.totalTokens,
    in: e.usage?.inputTokens,
    out: e.usage?.outputTokens,
    cache: e.usage?.cacheReadTokens,
    cost: e.cost
      ? { raw: e.cost.rawCostCents, charged: e.cost.chargedCents }
      : null,
  }));
  console.table(rows.length ? rows : [{ note: "no per-run entries" }]);
}

async function probeStatic(agentId: string, runId?: string): Promise<void> {
  try {
    const res = await Agent.getUsage(agentId, {
      apiKey,
      ...(runId ? { runId } : {}),
    });
    show(
      `static Agent.getUsage(${agentId}${runId ? `, runId=${runId}` : ""})`,
      res,
    );
  } catch (e) {
    console.error(
      `static Agent.getUsage(${agentId}) FAILED:`,
      e instanceof Error ? e.message : e,
    );
  }
}

async function probeInstance(agentId: string, runId?: string): Promise<void> {
  try {
    const agent = await Agent.resume(agentId, { apiKey });
    const res = await agent.getUsage(runId ? { runId } : undefined);
    show(`instance (Agent.resume → .getUsage()) for ${agentId}`, res);
  } catch (e) {
    console.error(
      `instance getUsage(${agentId}) FAILED:`,
      e instanceof Error ? e.message : e,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dbMode = args[0] === "--db";

  if (dbMode) {
    const limit = Math.max(1, Number(args[1]) || 5);
    const agents = db.all<{
      cursor_agent_id: string;
      cursor_run_id: string;
      status: string;
    }>(
      `SELECT DISTINCT cursor_agent_id, cursor_run_id, status FROM runs
       WHERE cursor_agent_id IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
      limit,
    );
    if (!agents.length) {
      console.log("no runs with agent ids in the db");
      return;
    }
    for (const { cursor_agent_id, cursor_run_id, status } of agents) {
      const id = normalizeAgentId(cursor_agent_id);
      console.log(
        `\n── agent ${id} (row id ${cursor_agent_id}, run ${cursor_run_id}, ${status})`,
      );
      await probeInstance(id, cursor_run_id);
      await probeStatic(id);
    }
    return;
  }

  const agentId = normalizeAgentId(args[0] ?? "");
  if (!agentId) {
    console.error(
      "usage: npx tsx --env-file=.env scripts/cursor-usage.ts <agentId> [runId]",
    );
    console.error(
      "   or: npx tsx --env-file=.env scripts/cursor-usage.ts --db [limit]",
    );
    process.exit(1);
  }
  const runId = args[1];
  await probeInstance(agentId, runId);
  await probeStatic(agentId, runId);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
