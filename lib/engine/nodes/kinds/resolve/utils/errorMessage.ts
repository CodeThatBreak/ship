import "server-only";

/** Message of an unknown thrown value (Error message, else String). */
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
