import "server-only";

import type { Prisma } from "@prisma/client";
import { RUN_MODE } from "../../../../../../constants/execution";
import { ARTIFACT_META } from "../../../../constants/artifactMeta";

/**
 * The dry-run provenance stamp (task 27, design §7): an artifact produced by
 * a `dry-run` execution-mode flow carries `meta.dryRun: true` so every
 * renderer shows the badge and the output is never mistaken for a real one
 * (use case 8h). Non-dry-run flows keep the caller's meta untouched.
 */
export const loadStampedArtifactMeta = async (
  tx: Prisma.TransactionClient,
  flowId: string,
  meta: unknown,
): Promise<unknown> => {
  const flow = await tx.flow.findUnique({ where: { id: flowId }, select: { executionMode: true } });
  if (flow?.executionMode !== RUN_MODE.DRY_RUN) return meta;
  if (meta == null) return { [ARTIFACT_META.DRY_RUN]: true };
  if (typeof meta === "object" && !Array.isArray(meta)) {
    return { ...(meta as Record<string, unknown>), [ARTIFACT_META.DRY_RUN]: true };
  }
  return meta;
};
