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

/** The end-to-end setup probe result (see /api/repos/test-setup). */
export type SetupTestResult = {
  ok: boolean;
  error?: string;
  /** what the real setup did (lifecycle-action strings, in order) */
  actions: string[];
  worktree?: string;
  branch?: string;
  /** set when the post-run cleanup couldn't fully finish */
  cleanup?: string;
  durationMs: number;
};
