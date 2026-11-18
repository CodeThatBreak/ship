import "server-only";

import { db } from "../../../../db/app";
import { templateStore } from "../../../templates/templateStore";

/**
 * The failed upstream of a node, if any (step 03, target-architecture §9:
 * `waiting`/`awaiting_approval` with a dead upstream ⇒ `failed` + event —
 * verified against the template graph's incoming `next` edges, never
 * guessed from ordering). Returns the dead source's key, or null when every
 * upstream is alive or unresolved.
 */
export const deadUpstreamKey = async (flowId: string, nodeKey: string): Promise<string | null> => {
  const g = await templateStore.graphForFlow(flowId);
  if (!g) return null;
  const sources = g.edges
    .filter((e) => e.kind === "next" && e.to === nodeKey)
    .map((e) => e.from);
  if (sources.length === 0) return null;
  const rows = await db.prisma.node.findMany({
    where: { flowId, nodeKey: { in: sources } },
    select: { nodeKey: true, status: true },
  });
  const dead = rows.find((r) => r.status === "failed");
  return dead?.nodeKey ?? null;
};
