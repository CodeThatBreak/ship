import "server-only";

/** Best-effort producer attribution for an `input_map` expression: the
 *  `nodes.<key>` address it reads from, or null when the expression addresses
 *  anything else (trigger payload, task, … — no upstream node owns the field). */
export const producerKeyOf = (expr: string): string | null => {
  const m = /^nodes\.([A-Za-z0-9_-]+)\./.exec(expr.trim());
  return m?.[1] ?? null;
};
