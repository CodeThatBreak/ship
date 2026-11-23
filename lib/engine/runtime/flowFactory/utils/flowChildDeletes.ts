import "server-only";

import type { Prisma } from "@prisma/client";

/**
 * Delete one flow's owned child rows in FK-safe order (children before
 * `flows`). The raw era's dynamic `DELETE FROM ${table}` loop becomes an
 * explicit, ordered list of typed `deleteMany` calls — the order mirrors
 * `FLOW_CHILD_TABLES` (`lib/engine/constants/flowChildTables.ts`, kept in
 * sync with `scripts/lib/seed-db.mjs`).
 */
export const deleteFlowChildRows = async (tx: Prisma.TransactionClient, flowId: string): Promise<void> => {
  await tx.planStep.deleteMany({ where: { flowId } });
  await tx.event.deleteMany({ where: { flowId } });
  await tx.message.deleteMany({ where: { flowId } });
  await tx.run.deleteMany({ where: { flowId } });
  await tx.artifact.deleteMany({ where: { flowId } });
  await tx.comment.deleteMany({ where: { flowId } });
  await tx.branch.deleteMany({ where: { flowId } });
  await tx.node.deleteMany({ where: { flowId } });
  await tx.hook.deleteMany({ where: { flowId } }); // flow-bound inbound webhooks (wait_for nodes)
};
