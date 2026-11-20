import "server-only";

import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { RowDecodeError, rowIdFromRaw } from "./rowDecodeError";

/**
 * Shared ORM-row decode helpers — the row semantics the raw era got from the
 * RowGateway (`lib/db/rows.ts`), now applied to Prisma rows: JSONB payloads
 * and `@map`ped scalars stay narrowed through the rows.ts zod schemas.
 * Feature modules import these directly (AGENTS §2.3 — no per-feature
 * copies); feature-specific mappers stay feature-local.
 */

/**
 * Strict single-row decode: an undecodable row throws `RowDecodeError` — a
 * singular read of a corrupt payload must fail loudly, not silently vanish.
 */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, row: unknown, source: string): z.infer<S> => {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowDecodeError(source, rowIdFromRaw(row), result.error);
  return result.data;
};

/**
 * Tolerant single-row decode: an undecodable row reads as `undefined` — for
 * read-model paths where one corrupt row must not blank a whole view.
 */
export const parseRowTolerant = <S extends z.ZodTypeAny>(schema: S, row: unknown): z.infer<S> | undefined => {
  const result = schema.safeParse(row);
  return result.success ? result.data : undefined;
};

/**
 * Tolerant multi-row decode: rows that no longer decode are dropped (and
 * logged) instead of failing the whole query — the RowGateway.all semantics.
 */
export const parseRows = <S extends z.ZodTypeAny>(
  schema: S,
  rowList: readonly unknown[],
  source?: string,
): z.infer<S>[] => {
  const decoded: z.infer<S>[] = [];
  for (const row of rowList) {
    const result = schema.safeParse(row);
    if (!result.success) {
      console.error("[rows] skipping undecodable row", {
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

/** A plain object as a Prisma `Json` field value (`InputJsonValue`). */
export const jsonInput = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
