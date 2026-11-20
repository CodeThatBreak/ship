import "server-only";

import type { Prisma } from "@prisma/client";
import type { z } from "zod";

/**
 * ORM-row helpers for the fan-out stores: the row decode/narrow semantics the
 * converted raw reads keep. JSONB payloads stay narrowed through the rows.ts
 * zod schemas (`lib/db/rows.ts`).
 */

/** Narrow a Prisma row through its rows.ts schema (JSONB payloads + Date → ISO). */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> | undefined => {
  const result = schema.safeParse(raw);
  return result.success ? result.data : undefined;
};

/** A plain object as a Prisma `Json` field value (`InputJsonValue`). */
export const jsonInput = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
