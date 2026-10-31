# Task 48: Constructor injection and a smaller `Database` class

- **Phase:** Phase 4: Code quality and structure
- **Depends on:** [Task 08: Canonical schema, atomic bootstrap, no legacy migrations](08-db-bootstrap-and-schema.md)
- **Findings:** CR-095, CR-118, CR-116
- **Effort:** L

## Goal

`AgentRunner`, the integration services and `RowGateway` import module singletons, and `Database` is about 1,000 lines. Inject dependencies and split `Database` into connection, migrator, seeder and stores.

## Findings

Each finding was re-verified against `refactor/prompt-engine-inconsistency-fix` at `abaa007`. The full original write-up (problem, evidence, suggested fix) is in [`docs/code-review.md`](../code-review.md); search for the CR id.

### CR-095 [Medium] Nodes and base services reach into the DB and other nodes' rows directly, and the "injected" services aren't really injected

- **Status:** Partly fixed
- **Type:** Code quality
- **Effort:** L
- **Where:** lib/engine/harness/agent-runner.ts:1-3, 12, 56, 60-61, 117-118, 168, 176; lib/engine/nodes/kinds/build/build-node.ts:179-180; lib/engine/nodes/kinds/pipeline/pipeline-node.ts:170-179; lib/engine/nodes/kinds/review/review-node.ts:102
- **What to do:** `NodeDefinition`/`AgentRunNode` now take support/runner/ctxHelper through the constructor, and resolve updates comments via `NodeSupport.resolveComment`. `AgentRunner` still uses the `db`, `config`, `agentPortRegistry` and `worktreeManager` singletons and raw run/node SQL. Build still reads the plan node's row and `input.model` by type. Nodes call `gitHostRegistry` directly. Fix: inject the db/event sink, port registry and worktree manager into `AgentRunner`, have the plan publish `model` in its output, and inject a git-host resolver.

### CR-118 [Medium] Integrations and row gateway import the global `db` instead of taking injected dependencies

- **Status:** Open
- **Type:** Code quality
- **Effort:** M
- **Where:** lib/integrations/gitlab/client.ts:3, lib/integrations/gitlab/client.ts:176-200, lib/integrations/jira/service.ts:3, lib/integrations/jira/service.ts:25-60, lib/integrations/local-agent/agent.ts:13, lib/integrations/local-agent/agent.ts:86-94, lib/integrations/gitlab/git-host.ts:167-239, lib/db/rows.ts:4, lib/db/rows.ts:413-430
- **What to do:** `GitLabService`, `JiraService`, `LocalAgentService` and `RowGateway` still import the module-level `db`, and `GitLabHostService` still calls the module-level `gitLab`. The instance-table SQL still lives inside the HTTP integration classes. Fix: extract `GitLabInstanceStore` and `JiraInstanceStore`, then constructor-inject the stores, `GitLabService` and `Database`, wired in the singletons.

### CR-116 [Medium] `lib/db/index.ts` is a god module: connection, migrations, data fixes, seed content and four domain stores

- **Status:** Open
- **Type:** Code quality
- **Effort:** L
- **Where:** lib/db/index.ts:34-991 (migrations and data fixes 73-585, template seed 586-845, stores 870-990)
- **What to do:** `Database` is now about 1,000 lines and still owns the connection, about 12 migration and data-fix routines, the SDLC template seed and the messages, events, settings and repo stores. Many of those routines are legacy back-compat (tickets→tasks rename, `migrateLegacyTicketRefs`, the legacy SDLC `mcp_sources` fix, binding pre-template flows), so most can be deleted rather than moved, given the no-legacy policy. Fix: delete the legacy migrations, then split into `Database`, `SchemaMigrator`, `TemplateSeeder` and `lib/db/stores/*`, each registered via `processSingleton`.
- **Fix after:** CR-210 ([Task 08](08-db-bootstrap-and-schema.md))

## Done when

- [ ] Every finding above is fixed, or a remaining part is written up in the PR description.
- [ ] Each bug fix has a regression test (Vitest for `lib/`; at least a hook or utility test for UI where practical).
- [ ] Code follows [`docs/coding-patterns.md`](../coding-patterns.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (before Task 02 lands, `npx tsc --noEmit` instead of `typecheck`).
- [ ] The status of each finding in [`docs/code-review.md`](../code-review.md) is updated (Fixed, with the PR link).
