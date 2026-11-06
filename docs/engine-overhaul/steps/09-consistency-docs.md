# Step 09 — Consistency pass, docs, lint ratchet

## Goal

Close the overhaul: delete legacy shims the new architecture made dead, align every
document and fixture with reality, ratchet the lint gate to zero warnings
(decision Q6), and tick the review-backlog findings the overhaul resolved.

## Depends on

Steps 02–08 (deletions must not pull rugs from code still in use).

## Files affected

- Delete: legacy `steps` fan-out knob shim (the per-step value that currently
  resolves to per-branch — old configs now fail lint loudly, AGENTS §4.6),
  `docs/current-issue-plan.md` Issue 2 (closed by step 05 — keep Issue 1's note
  untouched; it's a separate production-build concern), dead re-arm/grace-window
  constants if any remain.
- Edit: `scripts/seed-*.mjs` + `docs/flow-templates/*.yaml` — replace the markdown
  `plan-meta` convention with the real JSON turn envelope the parser consumes
  (seeds author artifacts in the same shape `planContract` writes); the bespoke
  `metaOf` regexes in the seeds are deleted.
- Edit: `README.md` (plan/build/resolve sections: turn envelope, tools surface,
  Postgres setup, single-writer lock), `AGENTS.md` (new invariants pointer to
  `docs/engine-overhaul/target-architecture.md`; safety rules for the demo
  Postgres DB; Prisma transaction rule), `docs/coding-patterns.md` (§3.5 Prisma
  transactions, §3.6 transition-authority recipe, `consumes` contracts, effect
  registry, agent-output pipeline), `docs/architecture/*.md` (resolve-node,
  templates, database) for the new columns/jobs/effects.
- Edit: `package.json` — `--max-warnings=53` → `--max-warnings=0` after fixing the
  53 tolerated warnings (or the remaining count at that point).
- Edit: `docs/code-review.md` + `docs/review-tasks/README.md` — mark resolved
  findings (at minimum: CR-006 durable waits, plus the findings steps 02–08
  absorbed — enumerate during the step by matching the audit's file:line evidence
  to CR numbers).
- Tests: `tests/architecture/` consolidation (no-raw-status-write, no-sqlite-in-lib,
  transition-table assert); fixture tests for refreshed YAML/seeds.

## Concrete tasks

1. Delete the legacy `steps` knob resolution path + its tests; add a lint error
   for templates still carrying it.
2. Refresh seeds/YAML to the turn envelope; run each seed and open the flow to
   verify panels render (the demo story must survive).
3. Docs sweep listed above — behavior changes from every step written down where
   the next agent will look.
4. Fix remaining lint warnings; set `--max-warnings=0`; keep the architecture
   tests as vitest (Q6).
5. Review-backlog bookkeeping: mark Fixed/Obsolete with links to the step files;
   note explicitly what was **not** done:
   - Security Phase 6 remains by owner decision — the agent-tools surface got its
     own mitigations in step 08 but the backlog's security tasks are untouched.
   - Structured logging (Phase-1 finding A8): the 24 `console.*` sites in `lib/`
     stay. Events go to the DB (the durable trail); a `pino` adoption is an
     optional follow-up if ops debugging demands it — deliberately not bundled
     into this overhaul.
6. Final DoD pass: walk `docs/engine-overhaul/README.md`'s DoD checklist, link each
   item to its enforcing test.
7. Singleton sweep (Q9 close-out): remove the remaining `processSingleton` sites
   not already absorbed (git/worktree wrappers, settings/repo/status/contract/
   artifact services, taskService, liveTaskFeed, graphService, secretStore,
   integration adapters — cursorSdk/cursorClient/jira/gitLab/localAgent —
   declarativeKindRegistry, modelCatalogService, `background-workers`), all
   constructor-injected from the container (or the process-services container for
   the run-handle registry). `noProcessSingletonOutsideDb.test.ts` flips to green
   with an allowlist of exactly one (`prismaClient`); `lib/singleton.ts` shrinks
   to that single use (or moves inline into `prismaClient.ts` and is deleted).
   AGENTS.md §3.3 and coding-patterns §3.8 rewritten (composition-root rule
   replaces the globalThis-singleton rule).
8. Quality-gate close-out: `engineClassSize` allowlist empty (or one documented
   exception); `oneClassPerFile` green; `classFilePurity` and `domainFolders`
   allowlists empty for `lib/engine/**` (non-engine `lib/**` offenders found by
   the scan are fixed if touched or flagged in the PR per AGENTS §2.10);
   coding-patterns.md gains the §12 engine layout + class-header-doc convention +
   the class-file-purity rule (constants/schemas/types in their own folders) so
   the next feature lands in the right shape by default; AGENTS.md §2.7/§3.2
   amended — the "module-level const in a backend module" allowance is replaced
   by the `constants/` folder rule, and the coding-patterns "constants/ types/
   barrelled" note is corrected to named files, no `index.ts` barrels (AGENTS
   §2.3 wins); arch test asserts a header doc on exported classes in
   `lib/engine/**`.
9. Naming lock-in (Q11): enable `@typescript-eslint/naming-convention` with the
   ratchet — variables/functions camelCase, UPPER_CASE only for true constants,
   type-likes PascalCase, engine-owned object-literal payload keys camelCase;
   Prisma-schema arch test asserts camelCase fields + `@map` on every snake_case
   column. Fix the stragglers the rule surfaces (the bulk was converted in
   step 01); AGENTS.md §2.9 gains the casing rule (camelCase variables,
   SCREAMING_SNAKE_CASE constants only).

## Libraries used

None new.

## Risks

- **Doc rot is the historical norm here** (README sold a contract the parser never
  consumed): the fixture/arch tests added in steps 00–07 are the guards — this step
  only has to make prose match tested behavior, not create new truth.
- `--max-warnings=0` may surface warnings unrelated to the overhaul: fix trivially
  or file as review tasks; do not broaden the diff with drive-by rewrites.
- Seed refresh changes demo content: keep the demo *story* (mid-review, fan-out
  mixed states) identical; only the authoring shape changes.

## Acceptance criteria / tests

- `npm run check` (with `--max-warnings=0`) + `npm run build` green.
- Seeds run against the demo Postgres DB; all YAML fixtures lint clean; fixture
  tests pass.
- `rg "plan-meta" scripts docs/flow-templates README.md` only hits historical
  notes (if any are intentionally kept).
- Overhaul DoD checklist in `docs/engine-overhaul/README.md` fully ticked, each
  linked to a test.
- `docs/review-tasks/README.md` counts updated; resolved findings marked with step
  links.
