/** Editable shape of the add/edit repo modal form. */
export type RepoFormState = {
  name: string;
  cloudUrl: string;
  localPath: string;
  defaultBranch: string;
  useWorktrees: boolean;
  installCommand: string;
  skipInstall: boolean;
  syncPaths: string;
  sharedDirs: string;
  setupCommand: string;
  worktreeTimeoutS: string;
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
