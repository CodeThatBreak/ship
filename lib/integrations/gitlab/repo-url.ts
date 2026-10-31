import "server-only";

import { z } from "zod";

/**
 * Lowercased host from an HTTPS, ssh://, or scp-style (`git@host:path`) repo URL.
 */
export const hostOfRepoUrl = (url: string): string | null => {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?/i);
  if (sshMatch) return sshMatch[1].toLowerCase();
  const scpMatch = trimmed.match(/^[^@/]+@([^:/]+):/);
  if (scpMatch) return scpMatch[1].toLowerCase();
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
};

const stripGitSuffix = (path: string): string => path.replace(/\.git$/i, "").replace(/\/+$/, "");

/**
 * Project path (`group/sub/repo`) without URL-encoding — suitable for display.
 */
export const projectPathFromRepoUrl = (repoUrl: string): string => {
  const trimmed = repoUrl.trim().replace(/\/+$/, "");
  const sshWithPort = trimmed.match(/^ssh:\/\/(?:[^/@]+@)?[^/:]+:\d+\/(.+)$/i);
  if (sshWithPort) return stripGitSuffix(sshWithPort[1]);
  const ssh = trimmed.match(/^ssh:\/\/(?:[^/@]+@)?[^/]+\/(.+)$/i);
  if (ssh) return stripGitSuffix(ssh[1]);
  const https = trimmed.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
  if (https) return stripGitSuffix(https[1]);
  const scp = trimmed.match(/^[^@/]+@[^:]+:(.+)$/);
  if (scp) return stripGitSuffix(scp[1]);
  return stripGitSuffix(trimmed);
};

export const encodedProjectPathFromRepoUrl = (repoUrl: string): string =>
  encodeURIComponent(projectPathFromRepoUrl(repoUrl));

const repoUrlRefine = (value: string, ctx: z.RefinementCtx): void => {
  const path = projectPathFromRepoUrl(value);
  if (!path || !path.includes("/")) {
    ctx.addIssue({
      code: "custom",
      message: "cloud_url must include a project path (e.g. https://gitlab.example.com/group/repo or git@host:group/repo.git)",
    });
  }
  if (!hostOfRepoUrl(value)) {
    ctx.addIssue({ code: "custom", message: "cloud_url host is not parseable" });
  }
};

/** Validates repo registry URLs at the API boundary (HTTPS + ssh/scp forms). */
export const gitLabRepoCloudUrlSchema = z.string().trim().min(1).superRefine(repoUrlRefine);
