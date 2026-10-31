# Review task backlog

Work items generated from [`docs/code-review.md`](../code-review.md) after re-verifying every finding against `refactor/prompt-engine-inconsistency-fix` at `abaa007` (2026-10-31).

## How to use this backlog

- Pick the lowest-numbered task whose dependencies are done. One task is one PR. If a task turns out bigger than one PR, split it and say so in the PR description.
- Read [`docs/coding-patterns.md`](../coding-patterns.md) before starting. Phase 1 builds the shared primitives (typed errors, `parseJson`, `db.transaction`, query options, mutation hooks) that later tasks rely on.
- Scope is the current working flow only. Legacy or deprecated paths are deleted, never shimmed or normalized (Tasks 07 and 08).
- Security is intentionally last (Phase 6), by owner decision. Don't pull security items forward unless asked.
- When a task lands, mark its findings Fixed in `docs/code-review.md` and tick the task in the table below.
- Tasks marked "Needs approval" change `lib/db/schema.sql`, add a dependency, or need a design decision. Ask before starting them (AGENTS.md section 1).

## Status of the review at this commit

| Status | Count |
| --- | ---: |
| Open | 238 |
| Partly fixed | 24 |
| Fixed | 7 |
| Obsolete (legacy, no fix) | 4 |
| **Total** (268 original + 5 new) | **273** |

Open and partly fixed findings: 262, spread over 61 tasks.

## Tasks


### Phase 0: Hotfix and quality gates

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 01 | [Hotfix: "latest" plan artifact returns an arbitrary (oldest) version](01-plan-artifact-ordering-hotfix.md) | CR-270 | S | — |
| [ ] | 02 | [Make typecheck, lint and tests real gates](02-typecheck-and-build-gates.md) | CR-273, CR-257, CR-266 | S | — |
| [ ] | 03 | [Harden ESLint so new code cannot regress](03-lint-rule-hardening.md) | CR-162, CR-170 | M | 02 |
| [x] | 04 | [Enforce the client/server and feature-barrel boundaries](04-client-server-boundaries.md) (needs approval) | CR-161, CR-165, CR-166 | S | 03 |
| [ ] | 05 | [Fill the test gaps for mappers, YAML fixtures and check scripts](05-test-coverage-baseline.md) | CR-041, CR-164, CR-160, CR-267 | M | 02 |
| [ ] | 06 | [Separate the prod DB from the demo DB and make seed scripts safe](06-db-path-and-seed-safety.md) | CR-040, CR-157, CR-159, CR-272, CR-262 | M | 05 |
| [ ] | 07 | [Delete dead code and legacy back-compat paths](07-remove-dead-and-legacy-code.md) | CR-187, CR-207 | S | 05 |
| [ ] | 08 | [Canonical schema, atomic bootstrap, no legacy migrations](08-db-bootstrap-and-schema.md) (needs approval) | CR-021, CR-022, CR-210, CR-221 | M | 07 |

### Phase 1: Shared foundations

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 09 | [Typed domain errors and one route error mapper](09-typed-errors.md) | CR-046 | M | 02 |
| [ ] | 10 | [Zod at the API boundary: helper and flow routes](10-api-input-validation-flows.md) | CR-003, CR-042, CR-047 | L | 09 |
| [ ] | 11 | [Zod at the API boundary: settings, repos, instances, templates](11-api-input-validation-settings.md) | CR-048, CR-167 | S | 10 |
| [x] | 12 | [Transaction API and atomic multi-writes](12-db-transactions.md) | CR-012, CR-050, CR-067 | M | 08 |
| [ ] | 13 | [One queryFn per query key](13-frontend-query-ownership.md) | CR-005, CR-135, CR-121, CR-120 | M | 02 |
| [ ] | 14 | [Remove error-swallowing fetchers](14-frontend-throwing-fetchers.md) | CR-036, CR-143 | M | 13 |
| [ ] | 15 | [Every mutation reports pending and error](15-frontend-mutation-conventions.md) | CR-027, CR-126, CR-129, CR-271, CR-237 | M | 13 |

### Phase 2: Engine and backend bugs

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 16 | [Late-write guard and run-row lifecycle](16-run-lifecycle-late-writes.md) | CR-014, CR-081, CR-269, CR-082, CR-205 | M | 09, 05 |
| [ ] | 17 | [Atomic node claims and attempt identity](17-node-claim-and-attempts.md) | CR-015, CR-054, CR-055, CR-056, CR-072, CR-066 | L | 16 |
| [ ] | 18 | [One terminal-status writer per node](18-terminal-outcome-writer.md) | CR-092, CR-206, CR-074, CR-088, CR-203 | M | 17 |
| [ ] | 19 | [Fan-out rollup idempotency and floating promises](19-fanout-rollup-and-promises.md) | CR-009, CR-010, CR-061, CR-057, CR-058, CR-064 | L | 17, 12 |
| [ ] | 20 | [Merge arena locking and workspace directories](20-merge-arena-and-workspaces.md) | CR-008, CR-059, CR-106, CR-107 | M | 19 |
| [ ] | 21 | [Multi-branch (complex plan) flows](21-multi-branch-correctness.md) (needs approval) | CR-011, CR-017, CR-019, CR-020, CR-083, CR-094 | M | 18 |
| [ ] | 22 | [Pipeline gate, review posting and resolve correctness](22-pipeline-review-resolve.md) | CR-075, CR-085, CR-086, CR-209 | M | 18 |
| [ ] | 23 | [Graph validation: loops, cycles, edge shapes, one validator](23-graph-semantics-and-validation.md) | CR-007, CR-062, CR-063, CR-032 | M | 05 |
| [ ] | 24 | [Flow graph snapshot and YAML round-trip](24-template-snapshot-and-yaml.md) | CR-065, CR-191 | L | 23, 12 |
| [ ] | 25 | [Durable waits and a well-behaved poller](25-wait-timers-and-poller.md) (needs approval) | CR-006, CR-060, CR-045, CR-193, CR-194 | M | 17 |
| [ ] | 26 | [Validate node config at run time](26-node-config-validation.md) | CR-076, CR-077, CR-078, CR-079, CR-080, CR-089, CR-200 | M | 07 |
| [ ] | 27 | [Plan checklist edits keep step identity and order](27-plan-checklist-integrity.md) | CR-013, CR-192, CR-097, CR-090, CR-084 | M | 12, 01 |
| [ ] | 28 | [Prompt preview matches the prompt that is sent](28-prompt-preview-parity.md) | CR-004, CR-049 | S | 05 |
| [ ] | 29 | [Webhook delivery reliability](29-webhook-reliability.md) | CR-043, CR-044 | S | 09 |
| [ ] | 30 | [Event feed ordering, cursor and tail loading](30-events-feed.md) | CR-026, CR-119, CR-108 | M | 13 |
| [ ] | 31 | [GitLab and Jira clients: timeouts, paging, typed errors](31-git-host-clients.md) (needs approval) | CR-025, CR-098, CR-099, CR-225, CR-219, CR-220, CR-198 | L | 09 |
| [ ] | 32 | [Agent port reliability (Cursor SDK and local agent)](32-agent-ports.md) | CR-109, CR-110, CR-111, CR-223, CR-101, CR-102 | M | 09 |
| [ ] | 33 | [Git wrappers, worktree setup and process lifetime](33-git-and-worktree-process-safety.md) | CR-103, CR-104, CR-214, CR-215, CR-218, CR-222, CR-224, CR-073 | M | 20 |
| [ ] | 34 | [Row decoding, repo delete and query indexes](34-db-row-safety.md) (needs approval) | CR-112, CR-114, CR-171, CR-115, CR-113 | M | 08, 09 |

### Phase 3: Frontend bugs and gaps

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 35 | [Cockpit panels: per-node state and render-time bugs](35-cockpit-panel-state.md) | CR-028, CR-124, CR-122, CR-123, CR-127, CR-130, CR-235 | M | 15 |
| [ ] | 36 | [Cockpit accessibility, keys and rendering cost](36-cockpit-a11y-and-rendering.md) | CR-131, CR-128, CR-233, CR-234, CR-236, CR-227 | M | 35 |
| [ ] | 37 | [Template editor: never lose an edit on save](37-editor-save-integrity.md) | CR-029, CR-030, CR-136, CR-140, CR-142 | M | 14 |
| [ ] | 38 | [Template editor: draft updates, undo/redo and read-only](38-editor-draft-machine.md) | CR-133, CR-139, CR-132, CR-134, CR-141, CR-240 | M | 37 |
| [ ] | 39 | [Template editor: fields that write correct values](39-editor-fields-and-effects.md) | CR-031, CR-033, CR-034, CR-137, CR-138, CR-241, CR-242, CR-146, CR-163 | L | 38 |
| [ ] | 40 | [Template editor: stable references and contract requests](40-editor-performance.md) | CR-144, CR-145 | M | 39 |
| [ ] | 41 | [Settings: per-page data and scoped errors](41-settings-data-and-errors.md) | CR-038, CR-151, CR-152, CR-255, CR-052, CR-256 | M | 14 |
| [ ] | 42 | [Settings forms: detected values, paths, deletes, labels](42-settings-forms.md) | CR-035, CR-147, CR-149, CR-150, CR-250 | M | 41 |
| [ ] | 43 | [Tasks feed: errors, refresh and start-build](43-tasks-feature.md) | CR-037, CR-148, CR-153 | S | 14 |

### Phase 4: Code quality and structure

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 44 | [Engine stores and status constants](44-engine-stores-and-constants.md) | CR-071, CR-180, CR-184, CR-217, CR-201, CR-181 | L | 17 |
| [ ] | 45 | [Split the `FlowEngine` god class](45-flow-engine-decomposition.md) | CR-070, CR-185 | L | 44 |
| [ ] | 46 | [Remove `any`, `!` and unsafe casts in the backend](46-backend-types-cleanup.md) | CR-182, CR-183, CR-202, CR-213, CR-173 | M | 03 |
| [ ] | 47 | [Thin route handlers backed by services](47-thin-routes-and-services.md) | CR-051, CR-053, CR-168, CR-169, CR-172, CR-175, CR-177, CR-178, CR-179 | L | 11 |
| [ ] | 48 | [Constructor injection and a smaller `Database` class](48-backend-dependency-injection.md) | CR-095, CR-118, CR-116 | L | 08 |
| [ ] | 49 | [Declarative node base class and registry](49-node-kind-structure.md) | CR-093, CR-096, CR-208 | M | 26 |
| [ ] | 50 | [Convert loose function modules and stop input mutation](50-small-module-cleanups.md) | CR-186, CR-216, CR-197, CR-195 | M | 48 |
| [ ] | 51 | [Stricter TypeScript flags](51-tsconfig-strictness.md) | CR-258 | M | 46 |
| [ ] | 52 | [Shared UI components and one `cn()`](52-shared-ui-components.md) | CR-174, CR-231, CR-243, CR-252, CR-259, CR-251, CR-156 | M | 04 |
| [ ] | 53 | [App shell out of `shared/`, settings tab de-duplication](53-app-shell-and-settings-dedup.md) | CR-244, CR-245, CR-248, CR-249 | M | 52, 42 |
| [ ] | 54 | [Feature folder layout and file naming](54-feature-layout-and-naming.md) | CR-229, CR-230, CR-239 | L | 52 |
| [ ] | 55 | [Frontend domain constants and single-source types](55-frontend-constants-and-types.md) | CR-228, CR-238, CR-246, CR-247, CR-155, CR-232, CR-253 | M | 54 |

### Phase 5: Docs

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 56 | [README, AGENTS.md commands and stale plan docs](56-docs-refresh.md) | CR-260, CR-261, CR-268 | S | 06 |

### Phase 6: Security (last)

| Done | # | Task | Findings | Effort | Depends on |
| :---: | --- | --- | --- | :---: | --- |
| [ ] | 57 | [Security: authenticate the local API](57-security-local-api-hardening.md) | CR-001, CR-002 | M | — |
| [ ] | 58 | [Security: webhook authentication and limits](58-security-webhook-auth.md) | CR-069, CR-196, CR-176 | S | 57 |
| [ ] | 59 | [Security: tokens out of URLs, logs and the client](59-security-credential-hygiene.md) | CR-023, CR-024, CR-254, CR-264, CR-265 | M | 57 |
| [ ] | 60 | [Security: script env, SSRF redirects, injection in URLs and git refs](60-security-process-and-network-isolation.md) | CR-016, CR-068, CR-199, CR-100, CR-105, CR-188, CR-189, CR-190 | M | 57 |
| [ ] | 61 | [Security: secrets at rest and remote images in Markdown](61-security-secrets-at-rest-and-rendering.md) (needs approval) | CR-117, CR-154 | L | 59 |
