/** Keeps an open drawer index valid after an item at `removedIndex` is deleted:
 *  null stays null, the removed item closes, later items shift down by one. */
export const indexAfterRemoval = (
  current: number | null,
  removedIndex: number,
): number | null => {
  if (current == null || current === removedIndex) return null;
  if (current > removedIndex) return current - 1;
  return current;
};
