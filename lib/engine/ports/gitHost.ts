import "server-only";

import { GitHostRegistry } from "./gitHost/gitHostRegistry";
import { AuthedUrlResolutionError } from "../../git/gitErrors";
import type { GitRemoteContext } from "../../git/local";

/**
 * The engine's git-host seam — the registry pin plus the repo-auth helpers
 * that route through it. The GitHostRegistry class lives in `gitHost/`
 * (its normalized types in `gitHost/types/`); class files are pure
 * (classFilePurity arch test), so this module keeps the pin, the
 * registry-bound helpers and the surface's re-exports so every existing
 * consumer keeps its import path.
 */
export const gitHostRegistry = new GitHostRegistry();

/**
 * Plain clone URL plus out-of-band auth for local git operations. Keeps
 * `lib/git` free of engine imports while the registry stays the router.
 */
export const gitRemoteContextFor = async (repoUrl: string): Promise<GitRemoteContext> => {
  const svc = await gitHostRegistry.forRepo(repoUrl);
  return {
    cloneUrl: await svc.authedCloneUrl(repoUrl),
    env: await svc.gitAuthEnv(repoUrl),
    redactSecrets: await svc.gitRedactValues(repoUrl),
  };
};

/**
 * Token-authed clone/push URL for a repo. Engine-side resolution handed to
 * `lib/git` local operations (ensureClone / pushBranch) — keeps `lib/git` free
 * of engine imports while the registry stays the only instance router.
 */
export const authedCloneUrlFor = async (repoUrl: string): Promise<string> => {
  try {
    return (await gitRemoteContextFor(repoUrl)).cloneUrl;
  } catch (e: unknown) {
    throw new AuthedUrlResolutionError(repoUrl, e);
  }
};

export { hostOf } from "./gitHost/utils/hostOf";
export { normalizeCloneUrl } from "./gitHost/utils/normalizeCloneUrl";
export type {
  ChangeRequest,
  ChangeRequestDiffRefs,
  ChangeRequestDiffs,
  CreateChangeRequestInput,
  GitHostClient,
  GitHostService,
  HeadPipelineInfo,
  HostComment,
  HostInstance,
  HostJob,
  HostNote,
  HostProject,
  HostWebhookEvent,
  InlineCommentInput,
  InlineCommentPositionContext,
  Pipeline,
} from "./gitHost/types/gitHost";
export type { GitHostResolver } from "./gitHost/types/gitHostResolver";
