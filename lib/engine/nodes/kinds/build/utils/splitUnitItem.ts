import "server-only";

import { SplitUnitPayload, type SplitUnitItem } from "../schema";

export type { SplitUnitItem };

/** Parse the split child's trigger-payload unit into the build's branch input.
 *  Returns null when the payload carries no unit at all (an ordinary
 *  parent-flow build — the plan-based path runs). A PRESENT but malformed
 *  unit throws: the linkage is broken, and a silent fall-through to the
 *  plan-based behavior would run the wrong build (fail loud, step 04 — the
 *  old hand-narrow silently defaulted title/scope and dropped bad items). */
export const splitUnitItemOf = (payload: unknown): SplitUnitItem | null => {
  const raw = typeof payload === "string" ? tryJsonParse(payload) : payload;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!("unit" in raw) || (raw as Record<string, unknown>).unit == null) return null;
  const parsed = SplitUnitPayload.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `split child payload: the unit item is malformed (${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "invalid"})`,
    );
  }
  return parsed.data.unit.item;
};

const tryJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
