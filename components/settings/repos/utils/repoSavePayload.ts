import type { Repo } from "@/components/settings/context";
import type { RepoFormState } from "../types";

/** Policy fields persisted only when the user explicitly edits them. */
export const REPO_POLICY_FIELDS = [
  "use_worktrees",
  "install_command",
  "skip_install",
  "sync_paths",
  "shared_dirs",
  "setup_command",
  "worktree_timeout_s",
] as const satisfies readonly (keyof RepoFormState)[];

export type RepoPolicyField = (typeof REPO_POLICY_FIELDS)[number];

export type RepoSavePayload = Pick<
  RepoFormState,
  "name" | "cloud_url" | "local_path" | "default_branch"
> &
  Partial<Pick<RepoFormState, RepoPolicyField>> & { id?: string | null };

/** Which policy columns already had explicit DB values when editing started. */
export const touchedPolicyFromRepo = (repo: Repo): Set<RepoPolicyField> => {
  const touched = new Set<RepoPolicyField>();
  if (repo.installCommand != null) touched.add("install_command");
  if (repo.syncPaths != null) touched.add("sync_paths");
  if (repo.sharedDirs != null) touched.add("shared_dirs");
  if (repo.setupCommand != null) touched.add("setup_command");
  if (repo.skipInstall) touched.add("skip_install");
  if (!repo.useWorktrees) touched.add("use_worktrees");
  if (repo.worktreeTimeoutMs) touched.add("worktree_timeout_s");
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
      case "install_command":
        payload.installCommand = state.installCommand;
        break;
      case "sync_paths":
        payload.syncPaths = state.syncPaths;
        break;
      case "shared_dirs":
        payload.sharedDirs = state.sharedDirs;
        break;
      case "setup_command":
        payload.setupCommand = state.setupCommand;
        break;
      case "skip_install":
        payload.skipInstall = state.skipInstall;
        break;
      case "use_worktrees":
        payload.useWorktrees = state.useWorktrees;
        break;
      case "worktree_timeout_s":
        payload.worktree_timeout_s = state.worktree_timeout_s;
        break;
    }
  }

  return payload;
};
