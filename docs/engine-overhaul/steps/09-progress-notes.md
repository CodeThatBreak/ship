# Step 09 — progress notes

Status: **complete** (`npm run check` — typecheck, lint `--max-warnings=0`,
test 210 files / 908 tests, zero expected fails — plus `npm run build` green).

## What landed

- **Legacy `steps` knob retired (task 1).** The plan node's
  `execution_default: "steps"` value — the retired per-step child-flow
  fan-out — now fails everywhere instead of degrading:
  `planNode.executionDefault` resolves through the declared `configSchema`
  (typed config error on `"steps"`), the UI `resolveExecution` legacy branch
  is gone, the two legacy-degrade tests were replaced with loud-failure
  coverage, and `templateLint` reports the value at save/import
  (`lib/engine/templates/lintPlanExecution.ts`). The live fan-out runtime
  knob (`fanout.mode: "steps"`) and the published plan-meta
  `execution: "steps"` value are untouched — they are the legitimate
  per-branch vocabulary.
- **Seeds author the turn envelope (task 2).** `seed-demo-flow.mjs` and
  `seed-demo-fanout.mjs` now take plan content/meta from
  `scripts/demoPlanFixtures.mjs` and write the artifact meta as a plain JSON
  object in the `planStore.persistPlan` shape — the markdown
  ` ```json plan-meta ` fence and both `metaOf` regexes are deleted. The demo
  stories survived (DEMO-142 mid-review checklist, DEMO-143
  `execution: "steps"` fan-out with six mixed-state children — verified via
  psql against the `devflow` demo DB, no `--reset`). Fixture test
  `tests/demoSeedPlanFixtures.test.ts` validates the metas through the real
  `parsePlanArtifactMeta`/`PlanResponse` contracts. No YAML carried
  plan-meta or the knob — none needed changes.
- **Docs sweep (task 3).** README (turn envelope, agent-tools surface,
  post-overhaul lib tree, plan-meta/plan-meta-parser.ts rot removed),
  AGENTS.md (target-architecture pointer, Prisma-transaction rule),
  coding-patterns.md (§3.5 jobs journaling, §3.6 transition-authority
  recipe, §3.6.1 contracts, §3.12 effects, §3.13 agent-output pipeline),
  all `docs/architecture/*.md` de-rotted (processSingleton/sqlite/
  waitScheduler/edgeActivator), `docs/current-issue-plan.md` Issue 2
  deleted (closed by step 05; Issue 1 untouched).
- **Lint ratchet (task 4).** The three surviving warnings fixed
  (unused imports/params); `--max-warnings=0` — zero tolerance.
- **Review backlog + DoD (tasks 5–6).** 20 findings marked Fixed/Obsolete
  with step links + verifying evidence (CR-006 durable waits → step 03;
  CR-070 → step 07; the task-18 and task-34 sets; CR-021/022/210/221
  obsolete via the Prisma migration; CR-162 → this step's ratchet); counts
  updated (Open 23 / Partly 14 / Fixed 229 / Obsolete 7). The DoD checklist
  in `docs/engine-overhaul/README.md` is fully ticked, each item linked to
  its enforcing test.
- **Q9 close-out (task 7).** Every `processSingleton` call site is gone:
  stateless/DB-fenced services are plain module consts (the `engineParts`
  precedent), genuinely process-bound ones (`cursorAgent`, `localAgent`,
  `worktrees`, `mergeArena`, `worktreeManager`, `liveTaskFeed`,
  `declarativeDefCache`) pin through `lib/composition/processServices.ts`
  (inline `Symbol.for`, no `processSingleton(` string). The prisma client
  pins inline; `lib/singleton.ts` is DELETED;
  `noProcessSingletonOutsideDb.test.ts` is green with exactly one allowed
  site; AGENTS §3.3/§3.1 and coding-patterns §3.8 rewritten to the
  composition-root rule.
- **Quality gates (task 8).** `engineClassSize`: every frozen giant
  decomposed under 450 — `agentNode` (→ `agentTemplateNode` + prompt/
  split/outcome collaborators), `buildNode` (→ trigger planner + prompt
  assembler + finalizer), `planContract` (→ `PlanScopedOutcome` +
  `PlanApplyRefusedError` + outcome utils), `worktreeLifecycle` (→ a
  `worktreeLifecycle/` folder of five collaborators; pin preserved),
  `templateLint` (→ 142-line orchestrator + eleven rule modules) — leaving
  ONE documented exception, `templateStore/templateStore.ts` (1155, shrunk
  from the frozen 1268; store decomposition deferred). `classFilePurity` and
  `domainFolders` allowlists are EMPTY for `lib/engine/**` (49 class files
  purified into `constants/`/`types/`/`utils/`/`schema.ts` homes; every
  inline Zod schema moved; singleton classes split into pin module + class
  folder per the worktreeLifecycle precedent). New arch test:
  `engineClassHeaderDoc.test.ts` (24 previously undocumented classes got
  §12 header docs). coding-patterns §7 + AGENTS §2.7/§3.2 amended to the
  constants-folder/purity rules.
- **Naming lock-in (task 9, Q11).** `@typescript-eslint/naming-convention`
  is on: camelCase variables/functions/params/methods in `lib/**`,
  UPPER_CASE only for true constants, PascalCase type-likes; 11 stragglers
  fixed. `prismaSchemaCasing.test.ts` extended with enum naming/`@@map`
  checks — zero schema violations; `schema.prisma` untouched.

## Deliberate deviations from the step text (for the PR description)

- **`worktrees` joins the process-pinned set** (target-architecture §11
  names `cursorAgent.runs` as "the one genuinely process-bound map"):
  `Worktrees.dirChains` is a per-directory mutex — per-graph copies would
  allow concurrent worktree mutations. Same reasoning pinned
  `worktreeManager` (`ensureInFlight` coalescing), `liveTaskFeed`
  (external-provider TTL cache feeding stale-on-error fallback) and
  `declarativeDefCache` (explicit-`invalidate()` cache that must not serve
  stale defs).
- **`dbAccess.ts`/`rowGatewayAccess.ts` keep lazy globalThis slots** (no
  `processSingleton`) — they exist so jira/gitlab proxies resolve the DB
  without forcing construction; the arch test's invariant (no globalThis
  pinning outside the DB client) is satisfied at the `processSingleton`
  level and the slots are documented.
- **Naming rule scope:** the object-literal-property check was measured and
  dropped — a blanket check flags ~1,600 legitimate wire-shape keys
  (DB-row aliases, YAML template keys, HTTP headers); the enforceable core
  (variables/functions/params/methods/type-likes) is what's on. `const`
  bindings may be PascalCase (React components, Zod schemas are repo
  convention); `let`/`var` in UPPER_CASE stays an error.
- **Prisma enum members stay snake_case** — they ARE the persisted PG enum
  values (sticky per AGENTS §1); the arch test asserts they are
  lowercase + `@map`ped, not camelCased.
- **`MrCreateHandler` dependency inversion:** the singleton removal
  surfaced a real import cycle (`flowEngine/flowEngine.ts → sdlcChain →
  mrCreateHandler → flowEngine pin`, TDZ); fixed by injecting a narrow
  `MrCreateEngine` port instead of importing the pin.
- **templateLint's unknown-field message** contains a literal
  `" — not .${field}"` in a non-template string (renders the placeholder
  verbatim) — preserved byte-for-byte by the behavior-preserving carve;
  flagged as a pre-existing nit for a follow-up.

## Not done (explicitly out of scope)

- **`templateStore` full decomposition** — the one documented
  `engineClassSize` exception (1155 lines; purity-cleaned and shrunk, not
  carved; follow-up tracked here).
- **Security Phase 6** remains by owner decision — the agent-tools surface
  got its own mitigations in step 08; the backlog's security tasks are
  untouched.
- **Structured logging (A8)** — the `console.*` sites in `lib/` stay; events
  go to the DB; `pino` is an optional follow-up.
- **Non-engine `classFilePurity` offenders** (31 files in `lib/db`, `lib/git`,
  `lib/integrations`, service modules) stay on the frozen list, flagged per
  AGENTS §2.10 rather than fixed in this diff.
- **Visual seed verification** — the demo seeds were verified at the data
  layer (psql); opening the flows in the UI is left to the user
  (`/flows/flow_mwp4t0i4m72n5qk`, `/flows/flow_fanoutdemo`).
- **CR-185** is recorded Fixed in the review indexes but its re-verification
  note says the N+1 was "unchanged" — flagged for an owner look.
- 29 pre-existing import cycles reported by madge outside the flowEngine
  graph are untouched.
