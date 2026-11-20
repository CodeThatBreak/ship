import "server-only";

/** Ensure `.git` suffix for HTTPS remotes (GitLab redirect quirk). */
export const normalizeCloneUrl = (repoUrl: string): string => {
  const trimmed = repoUrl.trim();
  return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
};
