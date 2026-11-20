import "server-only";

import type { z } from "zod";
import { RowDecodeError, rowIdFromRaw } from "@/lib/db/rowDecodeError";

/**
 * ORM-row helpers for the flow factory: the row decode/narrow semantics the
 * converted raw reads keep (RowGateway.get over `lib/db/rows.ts`). JSONB
 * payloads (flows.trigger_payload, tasks.fields) stay narrowed through the
 * rows.ts zod schemas; scalar columns are Prisma-typed and need no checks.
 */

/** RowGateway.get semantics over an ORM row: zod-narrow, throwing on undecodable. */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, row: unknown, source: string): z.infer<S> => {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowDecodeError(source, rowIdFromRaw(row), result.error);
  return result.data;
};
