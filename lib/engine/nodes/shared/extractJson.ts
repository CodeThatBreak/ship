import "server-only";

/**
 * Pull the JSON payload out of an agent's free-text answer: a bare JSON body,
 * a ```json fenced block, or the first balanced {...} / [...] region.
 * Returns null when nothing parseable is found.
 */
export const extractJson = (text: string): unknown => {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* keep trying */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* keep trying */
    }
  }
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* give up */
      }
    }
  }
  return null;
};
