import "server-only";

/** Lowercased URL host ("gitlab.company.com"), null when unparseable. */
export const hostOf = (url: string): string | null => {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?/i);
  if (sshMatch) return sshMatch[1].toLowerCase();
  const scpMatch = trimmed.match(/^[^@]+@([^:/]+):/);
  if (scpMatch) return scpMatch[1].toLowerCase();
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
};
