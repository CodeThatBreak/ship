/**
 * Vitest-only probe for eslint-config.test.ts (ignored in normal lint).
 * Not on the frozen offender list — must report `no-explicit-any` at error when linted with --no-ignore.
 */
export const eslintPolicyProbe = (value: unknown): boolean => {
  const loose = value as any;
  return Boolean(loose);
};
