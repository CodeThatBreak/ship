import "server-only";

import type { z } from "zod";
import { RowDecodeError, rowIdFromRaw } from "../../db/rowDecodeError";

/**
 * ORM-row helper for the artifact service: the decode semantics the raw query
 * used to get from the RowGateway (`lib/db/rows.ts`), now over a Prisma row.
 * The `artifacts.meta` JSONB payload stays narrowed through the rows.ts zod
 * schema; scalar columns are Prisma-typed and need no checks.
 */

/** RowGateway.get semantics over an ORM row: zod-narrow, throwing on undecodable. */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, row: unknown, source: string): z.infer<S> => {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowDecodeError(source, rowIdFromRaw(row), result.error);
  return result.data;
};
