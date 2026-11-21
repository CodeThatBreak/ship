import "server-only";

/**
 * The port harness keys the engine registers itself (§2.7 — domain values
 * from named constants). A harness key is the registry identity a port
 * registers under (`AgentPort.kind`/`harness`, `GitHostService.kind`);
 * `forMode` matches it against the `default_harness` setting within an
 * execution mode.
 */
export const HARNESS_KEYS = {
  /**
   * The whole-template dry-run simulation harness (design §7, task 27):
   * the promoted test fakes (`FakeAgentPort`/`FakeGitHost`) register under
   * this distinct key — the registries forbid duplicate kinds, so the fakes
   * are selected by the `dry-run` execution mode, never by resolution
   * surgery on the real ports.
   */
  DRY_RUN: "dry-run",
} as const;

export type HarnessKey = (typeof HARNESS_KEYS)[keyof typeof HARNESS_KEYS];
