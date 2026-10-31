/**
 * Files that still violate AGENTS.md §2.7 / §5 type rules at lint time.
 * New lib/ and scripts/ files are not listed here — they lint at error severity.
 * Shrink this list (and `--max-warnings`) as follow-up tasks land.
 */
export const FROZEN_PHASE0_OFFENDERS = [
  "lib/db/index.ts",
  "lib/engine/flow-engine.ts",
  "lib/engine/nodes/kinds/merge-request/merge-request-service.ts",
  "lib/engine/nodes/kinds/plan/branch-refinement.ts",
  "lib/engine/nodes/kinds/plan/plan-contract.ts",
  "lib/engine/runtime/fanout/step-flow-manager.ts",
  "lib/engine/runtime/flow-poller.ts",
  "lib/engine/runtime/hook-store.ts",
  "lib/engine/runtime/plan-step-store.ts",
  "lib/engine/tasks/providers/jira.ts",
  "lib/engine/templates/template-lint.ts",
  "lib/engine/templates/template-store.ts",
  "lib/git/local.ts",
  "lib/groupEvents.ts",
  "lib/integrations/gitlab/client.ts",
  "lib/integrations/gitlab/git-host.ts",
  "lib/integrations/jira/service.ts",
  "lib/net/ssrf-guard.ts",
];
