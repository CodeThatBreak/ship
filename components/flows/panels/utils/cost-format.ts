/** Format fractional cent amounts stored as cent floats (0.4 = 0.4¢). */
export const formatCostCents = (c?: number | null): string => {
  if (c == null) return "—";
  if (c < 1 && c > 0) return `$${(c / 100).toFixed(4)}`;
  return `$${(c / 100).toFixed(2)}`;
};
