import "server-only";

/** Remove embedded credentials from an HTTPS remote URL (for origin rewrite). */
export const stripCredentialsFromRemoteUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const u = new URL(trimmed);
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return trimmed.replace(/\/\/[^@/]+@/, "//");
  }
};
