import "server-only";

import type { z } from "zod";
import { RowDecodeError, rowIdFromRaw } from "@/lib/db/rowDecodeError";

/**
 * ORM-row helpers for prompt preview: the row decode/narrow semantics the
 * converted raw reads keep (RowGateway.get/all over `lib/db/rows.ts`). JSONB
 * payloads (nodes.config/input/output) stay narrowed through the rows.ts zod
 * schemas; scalar columns are Prisma-typed and need no checks.
 */

/** RowGateway.get semantics over an ORM row: zod-narrow, throwing on undecodable. */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, row: unknown, source: string): z.infer<S> => {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowDecodeError(source, rowIdFromRaw(row), result.error);
  return result.data;
};

/** RowGateway.all semantics: drop (and log) rows that no longer decode. */
export const parseRows = <S extends z.ZodTypeAny>(schema: S, rowList: readonly unknown[], source: string): z.infer<S>[] => {
  const decoded: z.infer<S>[] = [];
  for (const row of rowList) {
    const result = schema.safeParse(row);
    if (!result.success) {
      console.error("[promptPreview] skipping undecodable row", {
        source,
        rowId: rowIdFromRaw(row),
        issues: result.error.issues,
      });
      continue;
    }
    decoded.push(result.data);
  }
  return decoded;
};
