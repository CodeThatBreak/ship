/** Effective branch pick: user override wins; otherwise follow the polled proposal. */
export const effectiveDecisionSelection = (
  override: string[] | null,
  proposed: string[],
): string[] => override ?? proposed;

export const isSameDecisionPick = (sel: string[], proposed: string[]): boolean =>
  sel.length === proposed.length && sel.every((label) => proposed.includes(label));

export const toggleDecisionLabel = (current: string[], label: string): string[] =>
  current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
