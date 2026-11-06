# Engine overhaul — plan index

Structural overhaul of the DevFlow flow engine, per `docs/engine-overhaul-prompt.md`.
Read [`target-architecture.md`](target-architecture.md) first, then the step files in order.

## Decision log (from Phase 1 review, 2026-11-06)

| # | Decision | Answer |
| --- | --- | --- |
| Q1 | Persistence | **Migrate to Postgres + Prisma** (typed models, JSONB, real enums/timestamps). Done as step 01, before any new columns are built, so nothing is built twice. Single-writer still enforced — via a Postgres advisory lock instead of a runbook line. |
| Q2 | Agent self-repair | **Per-node-kind tools.** Each node kind declares the tools its agent gets (read state / claim checklist progress / report_failure), gated by a per-attempt capability token. |
| Q3 | Prompt injection | Fix the resolve prompt now; shared `untrustedData()` prompt-block helper used by resolve/plan/build. |
| Q4 | Characterization tests | Assert **target** behavior from the start. Implemented with `test.fails` / marked `test.skip` so the suite documents red behavior loudly without breaking the gate between steps; each step flips its markers. |
| Q5 | `flows.current_node` | Delete the column. UI derives the active node from `nodes.status`. |
| Q6 | Architecture rules | Vitest source-scan tests (like `serverOnlyPolicy.test.ts`), plus ratchet `--max-warnings` to 0 (step 09). |
| Q7 | Fan-out vs split | Keep both runtimes; unify the **effect/join declaration layer** they register into. No runtime migration. |
| Q8 | `nodes.output` history | Latest-wins, documented. Edge-condition lint is the safety net. No output-history table. |
| Q9 | Singletons | **Remove `processSingleton` everywhere except the DB client.** All services are constructor-injected via a composition root (`lib/composition/`). Process-bound daemons (poller, reconciler, lock) are owned by a dedicated **worker process** (Q10); the PG advisory lock makes startup idempotent. Truth lives in Postgres (Invariant 2), so per-request instances are correct by construction. |
| Q10 | `instrumentation.ts` | **Deleted** — it's for telemetry, not code logic. Background work moves to a dedicated worker process (`worker/main.ts`, `npm run worker`): poller, reconciler, job sweeps, `ProcessLock`. The web process is pure request/response; user-initiated actions claim synchronously in-request via the same DB-fenced paths. The lazy "background-workers" side effect in `lib/db/app.ts` dies with it. |
| Q11 | Naming | **camelCase for all variables/fields everywhere** — TS variables, Prisma model fields (declared camelCase + `@map("snake_case")` columns), and JSONB payload keys in Zod schemas. **SCREAMING_SNAKE_CASE is reserved for constants** (`as const` domain objects like `NODE_STATUS`). Enforced by `@typescript-eslint/naming-convention` (step 09) and the Prisma-schema convention (step 01). |

## Steps

| # | Step | Maps to prompt phase | Key invariants |
| --- | --- | --- | --- |
| 00 | [Characterization tests](steps/00-characterization-tests.md) | Phase 0 | test harness for edgeActivator / waitScheduler / sdlcChain / flowReconciler |
| 01 | [Postgres + Prisma migration](steps/01-postgres-prisma-migration.md) | (new — Q1) | typed persistence foundation for everything after |
| 02 | [Transition authority](steps/02-transition-authority.md) | Phase 1 (first half) | 1 |
| 03 | [Durable waits, leases, reconcile-all, job queue](steps/03-durable-waits-leases-reconcile.md) | Phase 1 (second half) | 2, 3 |
| 04 | [Contract integrity](steps/04-contract-integrity.md) | Phase 2 | 5 |
| 05 | [One agent-output pipeline + recover ABI](steps/05-agent-output-pipeline-recover.md) | Phase 3 | 4, 6, 9 |
| 06 | [Concurrency + half-apply](steps/06-concurrency-half-apply.md) | Phase 4 | 7, 11 |
| 07 | [Effect/join layer](steps/07-effect-join-layer.md) | Phase 6 (first half) | 8 |
| 08 | [Agent self-repair tools](steps/08-agent-tools-surface.md) | Phase 5 | 10 |
| 09 | [Consistency pass, docs, lint ratchet](steps/09-consistency-docs.md) | Phase 6 (second half) | — |

## Code quality bar (applies to every step)

Reliability is the goal; readability is how it survives. Enforced by arch tests
(`tests/architecture/`), not prose:

- **Size:** no new or rewritten file over ~400 lines (engine classes) / ~200
  (components). `engineClassSize.test.ts` fails over 450 in `lib/engine/**`; the
  frozen-giants allowlist only shrinks, never grows.
- **One class per file**, named after the class (`oneClassPerFile.test.ts`).
- **Class files are pure** — a class file contains only the class. Module-scope
  functions, constants, schemas and types are banned; they live in `constants/`,
  `types/`, `schema.ts`/`schemas/`, `utils/` with relevant names
  (`classFilePurity.test.ts` + `domainFolders.test.ts`, `lib/**`-wide with a
  shrink-only frozen allowlist; zero tolerance for new files).
- **Folders over piles:** every feature/kind/runtime module organizes into
  `constants/`, `types/`, `utils/` with named files — no `index.ts` barrel
  aggregators (AGENTS §2.3).
- **Header doc on every new class**: role in the mental model, invariants upheld,
  must-never list. Constraint comments on intricate parts (claim SQL, lease time,
  dedup keys) — never narration (AGENTS.md rule).
- **Layout:** new modules land in the target tree (`target-architecture.md` §12),
  not wherever is convenient.
- **God classes are decomposed in the step that migrates them** (table in
  `target-architecture.md` §12) — never left for a later cleanup pass.
- Every new class has a co-located test.

## Definition of done (from the overhaul prompt, mapped to steps)

- [ ] No `nodes.status` write outside the transition authority (enforced by test) — **step 02**
- [ ] No silent-default fallback for agent output (grep checklist) — **steps 04 + 05**
- [ ] Webhook/timer resume actually runs the node, incl. after restart — **step 03**
- [ ] Concurrent triggers ⇒ one run + one `skipped_duplicate_trigger` event — **step 06**
- [ ] Reconciler resolves every non-terminal state without guessing — **step 03**
- [ ] `recover()` can never throw out of the reconciler — **step 05**
- [ ] Restart during pipeline wait resumes the gate — **step 05**
- [ ] `consumes` validated at stage start, typed error names the producer — **step 04**
- [ ] Plan-node Retry dead-end (`docs/current-issue-plan.md` Issue 2) closed — **step 05**
- [ ] Edge conditions referencing nonexistent output keys rejected by lint/validate — **step 04**
- [ ] `npm run check` + build green; zero new `any`; no suppressed `exhaustive-deps` — **every step**
