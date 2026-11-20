import "server-only";

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
export const must = <T>(row: T | undefined, what: string): T => {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
};
