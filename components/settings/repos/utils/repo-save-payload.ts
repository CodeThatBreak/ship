import type { Repo } from "@/components/settings";
import type { RepoFormState } from "../types";

/** Policy fields persisted only when the user explicitly edits them. */
export const REPO_POLICY_FIELDS = [
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
  if (repo.install_command != null) touched.add("install_command");
  if (repo.sync_paths != null) touched.add("sync_paths");
  if (repo.shared_dirs != null) touched.add("shared_dirs");
  if (repo.setup_command != null) touched.add("setup_command");
  if (repo.skip_install) touched.add("skip_install");
  if (repo.worktree_timeout_ms) touched.add("worktree_timeout_s");
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
    cloud_url: state.cloud_url,
    local_path: state.local_path,
    default_branch: state.default_branch,
  };

  for (const key of REPO_POLICY_FIELDS) {
    if (!touched.has(key)) continue;
    switch (key) {
      case "install_command":
        payload.install_command = state.install_command;
        break;
      case "sync_paths":
        payload.sync_paths = state.sync_paths;
        break;
      case "shared_dirs":
        payload.shared_dirs = state.shared_dirs;
        break;
      case "setup_command":
        payload.setup_command = state.setup_command;
        break;
      case "skip_install":
        payload.skip_install = state.skip_install;
        break;
      case "worktree_timeout_s":
        payload.worktree_timeout_s = state.worktree_timeout_s;
        break;
    }
  }

  return payload;
};
