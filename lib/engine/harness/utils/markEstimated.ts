import { db } from "../../../db/app";

/** Persist an estimated cost, flagging it in the usage JSON so a later
 *  backfill (e.g. after the pricing rates change) re-prices it. */
export const markEstimated = async (runRowId: string, cents: number, existingUsage: unknown): Promise<void> => {
  const base =
    existingUsage != null && typeof existingUsage === "object" && !Array.isArray(existingUsage)
      ? (existingUsage as object)
      : null;
  // JSONB column: bind the payload object directly (no JSON.stringify)
  const raw = { ...(base ?? {}), costSource: "estimate" };
  await db.run(`UPDATE runs SET cost_cents=$1, usage=$2, updated_at=$3 WHERE id=$4`, cents, raw, db.now(), runRowId);
};
