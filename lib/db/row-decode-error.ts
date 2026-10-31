import "server-only";

import type { z } from "zod";

export class RowDecodeError extends Error {
  constructor(
    readonly sql: string,
    readonly rowId: string | undefined,
    readonly zodError: z.ZodError,
  ) {
    const idPart = rowId ? ` id=${rowId}` : "";
    super(`Row decode failed${idPart} (${sql}): ${zodError.message}`);
    this.name = "RowDecodeError";
  }
}

export const rowIdFromRaw = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null || !("id" in raw)) return undefined;
  const id = (raw as { id: unknown }).id;
  return typeof id === "string" ? id : undefined;
};
