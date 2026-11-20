import type { Prisma } from "@prisma/client";
import { HookRow } from "../../../../db/rows";

/** Tx-scoped hook read: same aliased select, validated by the same {@link HookRow} schema. */
export const firstHookRow = async (
  tx: Prisma.TransactionClient,
  sql: string,
  ...args: unknown[]
): Promise<HookRow | undefined> => {
  const raw = (await tx.$queryRawUnsafe<unknown[]>(sql, ...args))[0];
  return raw ? HookRow.parse(raw) : undefined;
};
