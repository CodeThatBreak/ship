import "server-only";

import { db } from "../../../db/app";
import { jsonInput } from "@/lib/db/ormRowHelpers";

/** Persist an estimated cost, flagging it in the usage JSON so a later
 *  backfill (e.g. after the pricing rates change) re-prices it. */
export const markEstimated = async (runRowId: string, cents: number, existingUsage: unknown): Promise<void> => {
  const base =
    existingUsage != null && typeof existingUsage === "object" && !Array.isArray(existingUsage)
      ? (existingUsage as object)
      : null;
  // JSONB column: bind the payload object directly (no JSON.stringify).
  // updateMany keeps the raw write's no-op-on-missing-row semantics.
  const raw = { ...(base ?? {}), costSource: "estimate" };
  await db.prisma.run.updateMany({
    where: { id: runRowId },
    data: { costCents: cents, usage: jsonInput(raw), updatedAt: new Date() },
  });
};
