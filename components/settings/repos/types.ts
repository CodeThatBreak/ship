/** Editable shape of the add/edit repo modal form. */
export type RepoFormState = {
  name: string;
  cloud_url: string;
  local_path: string;
  default_branch: string;
  install_command: string;
  skip_install: boolean;
  sync_paths: string;
  shared_dirs: string;
  setup_command: string;
  worktree_timeout_s: string;
};

/** One advisory check line of a setup dry-run (see /api/repos/test-setup). */
export type SetupTestCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

/** The dry-run result: overall ok plus the per-check lines. */
export type SetupTestResult = {
  ok: boolean;
  checks: SetupTestCheck[];
};
