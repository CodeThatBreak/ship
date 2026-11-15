import type { Repo } from "@/components/settings/context";
import type { RepoFormState } from "../types";

/** Policy fields persisted only when the user explicitly edits them. */
export const REPO_POLICY_FIELDS = [
  "useWorktrees",
  "installCommand",
  "skipInstall",
  "syncPaths",
  "sharedDirs",
  "setupCommand",
  "worktreeTimeoutS",
] as const satisfies readonly (keyof RepoFormState)[];

export type RepoPolicyField = (typeof REPO_POLICY_FIELDS)[number];

export type RepoSavePayload = Pick<
  RepoFormState,
  "name" | "cloudUrl" | "localPath" | "defaultBranch"
> &
  Partial<Pick<RepoFormState, RepoPolicyField>> & { id?: string | null };

/** Which policy columns already had explicit DB values when editing started. */
export const touchedPolicyFromRepo = (repo: Repo): Set<RepoPolicyField> => {
  const touched = new Set<RepoPolicyField>();
  if (repo.installCommand != null) touched.add("installCommand");
  if (repo.syncPaths != null) touched.add("syncPaths");
  if (repo.sharedDirs != null) touched.add("sharedDirs");
  if (repo.setupCommand != null) touched.add("setupCommand");
  if (repo.skipInstall) touched.add("skipInstall");
  if (!repo.useWorktrees) touched.add("useWorktrees");
  if (repo.worktreeTimeoutMs) touched.add("worktreeTimeoutS");
  return touched;
};

export const isRepoPolicyField = (key: keyof RepoFormState): key is RepoPolicyField =>
  (REPO_POLICY_FIELDS as readonly string[]).includes(key);

/**
 * Build the JSON body for POST/PATCH — identity fields always ship; policy
 * fields ship only when the user touched them so auto-detection stays in effect.
 */
export const buildRepoSavePayload = (
  state: RepoFormState,
  touched: ReadonlySet<RepoPolicyField>,
  editingId: string | null,
): RepoSavePayload => {
  const payload: RepoSavePayload = {
    id: editingId,
    name: state.name,
    cloudUrl: state.cloudUrl,
    localPath: state.localPath,
    defaultBranch: state.defaultBranch,
  };

  for (const key of REPO_POLICY_FIELDS) {
    if (!touched.has(key)) continue;
    switch (key) {
      case "installCommand":
        payload.installCommand = state.installCommand;
        break;
      case "syncPaths":
        payload.syncPaths = state.syncPaths;
        break;
      case "sharedDirs":
        payload.sharedDirs = state.sharedDirs;
        break;
      case "setupCommand":
        payload.setupCommand = state.setupCommand;
        break;
      case "skipInstall":
        payload.skipInstall = state.skipInstall;
        break;
      case "useWorktrees":
        payload.useWorktrees = state.useWorktrees;
        break;
      case "worktreeTimeoutS":
        payload.worktreeTimeoutS = state.worktreeTimeoutS;
        break;
    }
  }

  return payload;
};
