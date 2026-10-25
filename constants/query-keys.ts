/**
 * Single source of truth for TanStack Query keys — every useQuery fetch and
 * mutation invalidation pulls from here so invalidation can never drift away
 * from its fetching key (AGENTS.md §1.6).
 */
export const queryKeys = {
  settings: ["settings"] as const,
  repos: ["repos"] as const,
  /** detected worktree policy for one local checkout (form prefill) */
  reposDetect: (localPath: string) => ["repos", "detect", localPath] as const,
  gitHosts: ["git-hosts"] as const,
  integrations: {
    /** instance list of one provider kind (host = git hosts, task = task providers) */
    instances: (surface: string, kind: string) =>
      ["integrations", "instances", surface, kind] as const,
    /** localStorage-persisted connection-test outcomes, keyed `provider:id` */
    testResults: ["integrations", "test-results"] as const,
  },
} as const;
