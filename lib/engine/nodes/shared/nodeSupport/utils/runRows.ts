import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "../../../../../db/app";
import type { QueryExecutor } from "../../../../../db/database";
import { RUN_AGENT_REF, RUN_STATUS } from "../../../../constants/vocabulary";
import { RUN_LEASE_SECONDS } from "../../../../constants/leases";

/**
 * Run-row bookkeeping for node support: the placeholder-run claim, the
 * agent-ref upgrade CAS and the latest-agent lookup, over Prisma. `NodeSupport`
 * delegates to these; every multi-statement sequence is one transaction
 * (step 06, Invariant 7).
 */

/** The NodeSupport transaction seam (opens a tx, or joins the caller's). */
type TransactionFn = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  tx?: Prisma.TransactionClient,
) => Promise<T>;

/**
 * Placeholder run row for the current attempt — written at the start of
 * `executeRun` so reconcile sees a run while the agent is still starting.
 * `run_ref` is the attempt token until `persistRun` upgrades the row; the
 * attempt token, capability token and a run lease are stamped next to it.
 */
export const registerStartupRunRows = async (
  transaction: TransactionFn,
  flowId: string,
  nodeId: string,
  attemptId: string,
  apiToken?: string | null,
): Promise<void> => {
  const existing = await db.prisma.run.findFirst({
    where: { nodeId, status: RUN_STATUS.RUNNING },
    orderBy: { createdAt: "desc" },
    select: { agentRef: true, runRef: true },
  });
  if (existing?.agentRef === RUN_AGENT_REF.PENDING && existing.runRef === attemptId) {
    return;
  }
  // close-prior-runs UPDATE + placeholder INSERT in ONE tx (step 06, Invariant 7)
  await transaction(async (t) => {
    await t.run.updateMany({
      where: { nodeId, status: RUN_STATUS.RUNNING },
      data: { status: RUN_STATUS.ERROR, leaseUntil: null, updatedAt: new Date() },
    });
    // api_token (step 08): the claim-minted capability token rides the startup row.
    await t.run.create({
      data: {
        id: db.uid("run_"),
        flowId,
        nodeId,
        agentRef: RUN_AGENT_REF.PENDING,
        runRef: attemptId,
        attemptId,
        apiToken: apiToken ?? null,
        // Claim insert: the lease timestamp is computed in JS instead of the
        // old `now() + make_interval(...)` SQL — the single-writer lock makes
        // app-clock skew acceptable (decision in orm-migration task 03).
        leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
        status: RUN_STATUS.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });
};

/**
 * Upgrade the placeholder run row to the real agent run — or, when the
 * placeholder is gone, close stale rows and insert a fresh one. Returns the
 * surviving run row's id.
 */
export const persistRunRows = async (
  transaction: TransactionFn,
  flowId: string,
  nodeId: string,
  agentId: string,
  runId: string,
  apiToken?: string | null,
): Promise<string> => {
  const node = await db.prisma.node.findUnique({ where: { id: nodeId }, select: { attemptId: true } });
  const attemptId = node?.attemptId;
  if (attemptId) {
    const changes = await db.prisma.run.updateMany({
      where: {
        nodeId,
        status: RUN_STATUS.RUNNING,
        agentRef: RUN_AGENT_REF.PENDING,
        runRef: attemptId,
      },
      data: {
        agentRef: agentId,
        runRef: runId,
        attemptId,
        // Lease re-stamp rides the upgrade CAS: computed in JS (single-writer
        // lock makes app-clock skew acceptable — same rationale as the claim
        // inserts) so the fenced upgrade stays ONE statement.
        leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
        updatedAt: new Date(),
      },
    });
    if (changes.count === 1) {
      const upgraded = await db.prisma.run.findFirst({ where: { runRef: runId }, select: { id: true } });
      if (upgraded) {
        await db.prisma.run.updateMany({
          where: { nodeId, status: RUN_STATUS.RUNNING, runRef: { not: runId } },
          data: { status: RUN_STATUS.ERROR, updatedAt: new Date() },
        });
        return upgraded.id;
      }
    }
  }
  // close out any prior `running` rows for this node — they're stale (their
  // process died with a previous server/run) and would otherwise be picked up
  // as the "latest running run" by reconcile; close + insert in ONE tx (step 06, Invariant 7)
  return transaction(async (t) => {
    await t.run.updateMany({
      where: { nodeId, status: RUN_STATUS.RUNNING },
      data: { status: RUN_STATUS.ERROR, updatedAt: new Date() },
    });
    const id = db.uid("run_");
    await t.run.create({
      data: {
        id,
        flowId,
        nodeId,
        agentRef: agentId,
        runRef: runId,
        attemptId: attemptId ?? null,
        apiToken: apiToken ?? null,
        // Claim insert: lease computed in JS (see registerStartupRun).
        leaseUntil: new Date(Date.now() + RUN_LEASE_SECONDS * 1000),
        status: RUN_STATUS.RUNNING,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return id;
  });
};

/** The most recent real (non-placeholder) agent ref for a node's runs. */
export const lastRunAgentId = async (nodeId: string, tx?: QueryExecutor): Promise<string | null> => {
  const row = await (tx ?? db.prisma).run.findFirst({
    where: { nodeId, agentRef: { not: RUN_AGENT_REF.PENDING } },
    orderBy: { createdAt: "desc" },
    select: { agentRef: true },
  });
  return row?.agentRef ?? null;
};

/** Update the run row with the real agent/session id once known (local mode). */
export const setRunAgentIdRow = async (runId: string, agentId: string): Promise<void> => {
  await db.prisma.run.updateMany({
    where: { runRef: runId },
    data: { agentRef: agentId, updatedAt: new Date() },
  });
};
