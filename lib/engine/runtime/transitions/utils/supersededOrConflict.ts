import "server-only";

import type { Database } from "../../../../db/database";
import { ConflictError } from "../../../../errors";
import type { EngineNodeStatus } from "../../../constants/nodeStatus";
import { RunSupersededError } from "../../../errors/runSupersededError";

/**
 * Distinguish a superseded attempt from an undeclared from-state after a
 * fenced write missed: the node row's attempt token decides which typed
 * error to throw (the token no longer matching ⇒ the run was superseded;
 * the token intact but the status outside the from-set ⇒ conflict).
 */
export const supersededOrConflict = async (
  database: Database,
  nodeId: string,
  attemptId: string,
  from: readonly EngineNodeStatus[],
  nodeKey: string,
): Promise<never> => {
  const node = await database.prisma.node.findUnique({
    where: { id: nodeId },
    select: { attemptId: true, status: true },
  });
  if (!node || node.attemptId !== attemptId) {
    throw new RunSupersededError(nodeId, node?.status ?? "unknown", attemptId);
  }
  throw new ConflictError(`Node ${nodeKey} is not in ${from.join("/")}`);
};
