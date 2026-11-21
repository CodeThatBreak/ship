# Extensibility implementation plan

Ordered, PR-sized tasks implementing [`design.md`](design.md) — facts (L1), declarative
effects (L2), config-as-data (L3), panels/artifact renderers (L4), runtime policy (L5) —
plus the eight artifact-rendering use cases from the 2026-11-21 analysis (agent/user diffs,
branch/MR visibility, open-PR button, plan view, pipeline monitoring/retrigger, review).

## How to use this backlog

- Pick the lowest-numbered task whose dependencies are done. **One task is one PR.** If a
  task turns out bigger than one PR, split it and say so in the PR description.
- Read [`../coding-patterns.md`](../coding-patterns.md) and the invariants in
  [`../engine-overhaul/target-architecture.md`](../engine-overhaul/target-architecture.md)
  before starting. Every task names the invariants it upholds.
- **Fan-out and split are last (Phase 5), by owner decision.** Don't pull them forward
  unless asked. Nothing before Phase 5 touches `stepFlows`/`splitManager`/the StageRunner
  gate chain.
- Tasks marked **"Needs approval"** change `prisma/schema.prisma`, add a dependency, or
  need a design decision. Ask before starting them (AGENTS.md section 1).
- When a task lands, tick it here and mark the corresponding design-doc finding (A1…E4)
  Fixed in [`design.md`](design.md) section 9.
- Per-task DoD: AGENTS.md §0 (`typecheck`, `lint`, `test`, `build`), the §4 invariants as
  arch tests where the task adds a mechanism, and co-located tests for every new
  service/reader/verb.

## Ground rules for every task

- **Facts persist in existing homes** — artifacts, branch rows, flow MR columns. No new
  storage layer, no Prisma migration anywhere in this plan except the two flagged
  "Needs approval" items.
- **Relevance from config or linkage, never a literal declarative def key** (Invariant F1).
  The registry-snapshot test (`EFFECT_KEY_ANY` + built-in keys only) is added once in
  task 04 and extended by every later effects task.
- **Rendering keys off artifact `kind`, never node `kind`/`type`** — the artifact renderer
  registry (task 01) is the only dispatch point. New renderers register; no panel gains
  an `if`.
- **Verbs are a closed union; declarations are data, capabilities are code** (§12.4). A
  new verb is a code change that lands in exactly one task and registers into the verb
  registry. Users compose; only engineering grants.
- **Claim discipline** (Invariants 7, 8, 11): every effect/verb/panel action claims
  through the TriggerGateway; git/HTTP I/O runs before or after the DB batch, never
  inside; multi-row writes are one `$transaction` with the journal riding `onPersist`.

---

## Phase 1 — Declarations the engine already half-knows (UI + small knobs)

Tier S of the design doc. Small, independent, high-leverage. No facts/effects machinery
yet — these land the rendering surface and the trivial knobs so later phases have somewhere
to put their output.

| Done | # | Task | Findings | Use case | Effort | Depends on |
| :---: | --- | --- | --- | --- | :---: | --- |
| [x] | 01 | Artifact renderer registry + generic declarative panel | B1, E4 | 5, 7 (rendering base for all) | M | — |
| [x] | 02 | Config field renderer registry (field `type` → component) | B2 | all (knob authoring) | S | — |
| [x] | 03 | `base_ref` + `retry_budget` knobs (one resolver each) | A2, C3, E2 | 3 | S | 02 |
| [x] | 04 | Flow context fact exposure + `MrTargetResolver` fact fallback | A3 | 3 | S | — |
| [x] | 05 | `SET_NODE_CONFIG` for `pending`/`failed` nodes + `config_updated` event | D2 | 8g | S | — |

### Task 01 — Artifact renderer registry + generic declarative panel

**Goal.** Rendering keyed off artifact `kind`, not node kind; a fully-functional default
panel for any declarative node; the "isn't supported yet" fallback deleted.

**Changes.**
- `components/flows/panels/artifacts/` — add `artifactRenderers.ts`:
  `Record<string, ComponentType<{artifact: ArtifactPayload}>>` with entries
  `markdown → MarkdownArtifact`, `json → JsonArtifact`, `diff → DiffView` (promoted from
  `views/DiffView.tsx`), `plan → PlanArtifactView` (promoted out of `PlanView`), and
  `GenericArtifact` (the existing `<pre>`) as the fallback. Renderers receive the loaded
  artifact only — no node config, no fetching (presentational per AGENTS §2.2).
- `components/flows/panels/genericDeclarativePanel.tsx` (new) — driven entirely by
  `node.capabilities` + `configFields` + artifacts: header (`capabilities.panelTitle ??
  label`), prompt/config summary from the config snapshot, artifacts rendered by kind via
  the registry, approval affordance when the node is approval-triggered, chat rail via
  `capabilities.refinable` (already resolved generically in `panelFactory.resolveChat`).
- `panelFactory.tsx` — `PANEL_BY_KIND` fallback becomes `GenericDeclarativePanel` instead
  of `null`; delete the "isn't supported yet" branch in `NodePanel.tsx:88-93`. Built-ins
  stay as overrides in `PANEL_BY_TYPE` untouched.
- `AgentView.tsx` — replace the hardcoded `json`/`markdown` filter (line 38) with the
  renderer registry; non-output artifacts (diff, etc.) render below the output.

**Invariants/tests.** Component test: a node of unknown declarative kind with `markdown` +
`diff` artifacts renders both via the registry (no fallback text). Registry snapshot test
pins built-in kinds. `DiffView` and `PlanArtifactView` keep their existing DOM (move, not
rewrite — AGENTS §4 minimal diffs).

### Task 02 — Config field renderer registry

**Goal.** Adding a knob stops requiring an edit to a shared component (B2).

**Changes.**
- `components/templates/configFieldRenderers.tsx` (new): `Record<ConfigFieldType,
  ComponentType<ConfigFieldProps>>` with the existing ten renderers as entries and
  `ConfigPlainField` as fallback.
- `ConfigFieldRow.tsx` — the if-chain becomes one registry lookup.
- `lib/engine/templates/nodeConfig.ts` — `ConfigField.type` stays a closed union (types
  are still code); new field *types* are added here + one registry entry.

**Tests.** Registry snapshot pins the ten built-in types; a test registers nothing new and
asserts the fallback renders an unknown type.

### Task 03 — `base_ref` + `retry_budget` knobs

**Goal.** A declarative node can branch off any ref; retry budget is data, not class-level
(A2, C3). Fixes E2 (the contract retry path drops `startingRef`).

**Changes** (follow the `fanoutConfigFields` recipe — field set + defensive reader + lint
+ one consuming seam).
- `lib/engine/nodes/kinds/agent/constants/agentConfigFields.ts` — add
  `baseRefConfigFields` + `retryBudgetConfigFields`, spread into `AGENT_CONFIG_FIELDS`.
- `lib/engine/nodes/schemas/declarativeSchemas.ts` — `AgentDefSchema` gains
  `base_ref: z.string().nullable().default(null)` (`{{...}}` allowed, rendered at run
  time) and `retry_budget: z.number().int().min(0).max(5).default(1)`.
- `lib/engine/nodes/kinds/agent/baseRefResolver.ts` (new) — one resolver:
  `startingRef: render(cfg.base_ref, ctx) ?? ctx.flow.mrBranch ?? undefined`.
- `agentTemplateNode.ts` — `run` (242), `chat` (275), and the `executeRetry` path
  (331-343) all call the one resolver (fixes E2 — the retry no longer loses the base ref).
- `finalizeOutput` — `budget: retryBudgetOf(cfg, this.retryBudget)`; config wins, class
  default is the floor's fallback.

**Tests.** Reader unit tests; an agent node with `base_ref: "develop"` runs with
`startingRef "develop"`; a contract retry passes the *same* `startingRef` as the first
run; `retry_budget: 2` spends two retries then fails with `output_exhausted`.

### Task 04 — Flow context fact exposure + `MrTargetResolver` fact fallback

**Goal.** Templates and resolvers can see `mr_iid` and per-branch MRs (A3) — reads
existing branch rows, no new storage.

**Changes.**
- `lib/engine/nodes/shared/runContext/flowVariables.ts` — expose `flow.mr_iid` and
  `branches.<name>.{mr_iid, mr_url, status}` from `branchStore` (currently only
  `mr_url`/`mr_branch` at lines 73-76).
- `mrTargetResolver.ts` — add the third source: flow MR → plan-branch MR → **most recent
  branch row with an `mrIid`** (the change_request fact fallback). No new tables — reads
  `branchStore`.
- `lib/engine/runtime/effects/effectRegistry.test.ts` (new) — add the **registry-snapshot
  arch test** here (built-in def keys + `EFFECT_KEY_ANY` only), the F1 guard every later
  effects task extends.

**Tests.** A template referencing `{{flow.mr_iid}}` and
`{{branches.<name>.mr_url}}` renders; a resolver with no flow MR but a branch-row MR
resolves to the branch MR (no "approve the build first" throw).

### Task 05 — `SET_NODE_CONFIG` for `pending`/`failed` nodes + `config_updated` event

**Goal.** In-flow reconfiguration of not-yet-started nodes (D2); the deliberate snapshot
semantics (README:152) are unchanged — this edits *this flow's* snapshot only.

**Changes.**
- `lib/engine/nodes/shared/nodeDefinition.ts` — the `nodeConfig()` re-read at run time
  already exists (260-271); the action handler gains a guard: `status ∈ {pending,
  failed}` ⇒ allow, else reject with a typed error.
- Emit a typed `config_updated` event (EVENT_KIND addition) with the changed keys.
- `components/flows/panels/genericDeclarativePanel.tsx` — the Configure dialog works when
  the node is `pending`/`failed` (reuses the `AgentView.tsx:117-153` dialog pattern); the
  feed renders `config_updated`.

**Tests.** Editing a `pending` node's config succeeds and emits `config_updated`; editing
a `running`/`done` node rejects; the next run re-reads the edited snapshot.

---

## Phase 2 — Facts (L1)

The keystone: typed side-effect facts persisted in existing homes, consumed by resolvers
and the renderer registry. Everything after this phase reads facts; nothing writes a
parallel store.

| Done | # | Task | Findings | Use case | Effort | Depends on |
| :---: | --- | --- | --- | --- | :---: | --- |
| [x] | 06 | Fact vocabulary + `FactStore` + `produces` on the agent def | A1, F2, F4 | 1 | M | 01, 04 |
| [x] | 07 | `result.git` → facts in `finalizeOutput` + fact persistence in the batch | A1, F2 | 1 | M | 06 |
| [x] | 08 | Diff attribution: `baseSha`/`headSha` meta, uncommitted flag, refresh action | — | 2 | M | 07 |
| [x] | 09 | Branch/change_request fact rows in the generic panel | A3 | 3 | S | 06 |

### Task 06 — Fact vocabulary + `FactStore` + `produces` on the agent def

**Goal.** The typed fact vocabulary (`branch`, `diff`, `change_request`) as a
formalization over existing homes — never a parallel storage layer (design §4.1).

**Changes.**
- `lib/engine/facts/types/facts.ts` (new) — `FACT_KIND = { BRANCH, DIFF, CHANGE_REQUEST
  }` + derived union (AGENTS §2.7 constants pattern).
- `lib/engine/facts/factStore.ts` (new, thin class) — persists facts into the existing
  homes: `branch` → `branchStore` row (status `pushed`); `diff` → artifact kind `diff`
  with `meta {branch, stat}` (the exact shape `stepRollup.ts:170` writes);
  `change_request` → branch row `mrIid/mrUrl` or `flows.mrIid`. Also resolves fact
  lookups for resolvers and the flow context. Constructor-injected (AGENTS §3.1);
  composed from `lib/composition/container.ts`.
- `declarativeSchemas.ts` — `AgentDefSchema` gains `produces:
  z.array(z.enum(["branch","diff"])).default([])`.
- `agentConfigFields.ts` — `produces` field (type `multi`).

**Invariants.** F2 — every fact write lands in the terminal write's transaction or
journals through `jobs`. F4 — `result.git` is consumed iff the def declares `produces`;
undeclared git facts stay dropped (arch test: an agent def without `produces` persists no
branch/diff rows even when `result.git.branches` is set).

### Task 07 — `result.git` → facts in `finalizeOutput`

**Goal.** Agent code changes stop being invisible (A1) — the 80%-built capability that
today is dropped at `agentTemplateNode.ts:311-349`.

**Changes.**
- `agentTemplateNode.finalizeOutput` — when `cfg.produces` includes `branch`/`diff`, map
  `result.git.branches[]`: a `branch` fact per branch (FactStore), then
  `ctxHelper.makeDiff(ctx, branch)` → a `diff` artifact per branch. Git I/O runs **before**
  the `applyOutcome` DB batch (the `stepRollup.ts:42` precedent — git never joins a
  transaction); facts persist inside it.
- `agentOutcome.ts` — `shapeAgentOutcome` gains an optional facts side-channel (shaping
  stays pure; persistence stays in `applyOutcome`).

**Tests.** An agent run reporting `git.branches: [{branch:"changelog/x"}]` persists one
`branch` row (`pushed`) + one `diff` artifact with `meta {branch, stat}`; an undeclared
run persists neither (F4). Co-located `finalizeOutput` test + a FactStore transaction test.

### Task 08 — Diff attribution (agent vs user)

**Goal.** Distinguish "what the agent changed" from "what's on the branch" (use case 2);
surface uncommitted work; let the panel detect a stale diff.

**Changes.**
- `flowContextHelper.makeDiff` — record `baseSha` (at run start, from the resolved
  `base_ref`) and `headSha` (at finalize) into the diff artifact `meta`. Add an
  `uncommitted: true` variant that diffs the worktree against `baseSha` for changes the
  agent left uncommitted (the branch row carries last-seen head SHA).
- Fact meta gains `attribution: "agent" | "all"`. "Agent" = `git diff baseSha..head`
  (user commits made *after* the run are excluded; commits the agent built on are
  included — correct). Author-email filtering is deliberately rejected (fragile: local
  agents commit as the user's git config).
- `DiffView` renderer — a "Agent only / Whole branch" toggle when both projections are
  computable (renderer concern, one fact); a "branch updated since capture" badge +
  **Refresh diff** action (re-runs `makeDiff` under the node's claim — read-only) when the
  branch row's head SHA differs from the artifact's `headSha`. An `uncommitted` banner
  ("not yet on a branch") so an approval/MR verb can't silently target unpushed code.

**Tests.** A branch with an agent commit + a later user commit: "agent" diff excludes the
user commit, "all" includes it; a worktree-only change produces `uncommitted: true`; the
refresh action re-captures and bumps `headSha`.

### Task 09 — Branch/change_request fact rows in the generic panel

**Goal.** The agent's branch and its MR render for any declarative node (use case 3).

**Changes.**
- `components/flows/panels/artifacts/branchFactRow.tsx` (new, shared) — extract the
  per-branch row from `BuildView.tsx:141-174` into `components/shared/` (domain-neutral
  name per AGENTS §2.4): branch name, status badge, `MR !iid ↗` link.
- `genericDeclarativePanel.tsx` — renders a `branch` fact via `BranchFactRow` and a
  `change_request` fact as the MR link; `BuildView` swaps its inline row for the shared
  component (touch-and-fix per AGENTS §2.10).

**Tests.** A declarative node with a `branch` fact renders the row; a `change_request`
fact renders the MR link; `BuildView` renders unchanged (snapshot).

---

## Phase 3 — Declarative effects + verbs (L2)

Facts are what effects consume; effects are how declarative nodes change the world. This
phase lands the wildcard dispatch and the first verb — `create_change_request` — exposed
three ways: declarative `afterApproval`, a panel button, and an agent tool.

| Done | # | Task | Findings | Use case | Effort | Depends on |
| :---: | --- | --- | --- | --- | :---: | --- |
| [x] | 10 | Verb registry + declarative wildcard effects | B3, F1, F3 | 4 | M | 06 |
| [x] | 11 | `create_change_request` verb over `MergeRequestService` | A4, F2 | 4 | M | 10 |
| [x] | 12 | "Open PR" panel action (claim-gated) | A4 | 4 | S | 11 |
| [x] | 13 | `create_change_request` agent tool + per-node `agent_tools` allowlist | C4 | 4 | M | 11 |
| [x] | 14 | Fact-need lint (`needs` / `effects` static validation) | — | 3, 4 | S | 06 |

### Task 10 — Verb registry + declarative wildcard effects

**Goal.** Declarative nodes declare effects in config; dispatch decides relevance from
config, never a def key (B3, design §4.2).

**Changes.**
- `lib/engine/runtime/effects/verbRegistry.ts` (new) — the closed verb union
  (`EFFECT_VERB = { CREATE_CHANGE_REQUEST, PUBLISH_DIFF }` to start). Each verb: a
  service-wrapping function + its **required facts** declaration. Verbs run under the
  node's attempt claim.
- `declarativeSchemas.ts` — all declarative kinds gain
  `effects: z.object({ afterApproval: z.array(z.enum(["create_change_request"])).default([]),
  afterSuccess: z.array(z.enum(["publish_diff"])).default([]) }).default({})` (loose
  schemas tolerate it today).
- `lib/engine/nodes/declarativeEffects.ts` (new) — one `EFFECT_KEY_ANY` registration per
  lifecycle, registered in the `FlowEngine` constructor beside
  `registerSdlcEffects`/`registerFanoutEffects`: reads the node's config `effects` map,
  dispatches to `verbRegistry.run(verb, ctx)`. Returning `true` when a verb ran preserves
  the "an effect owns the follow-on" rule (Invariant 8). Registry ordering (exact defKey
  first, wildcard second — `effectRegistry.ts:59-64`) keeps built-ins' compiled effects
  untouched.

**Invariants.** F1 — extend the task-04 snapshot: wildcard registration only, no literal
declarative def key. F3 — a declarative effect never runs for a built-in node and vice
versa (config-absent ⇒ wildcard no-ops ⇒ default edge walk, byte-for-byte today).

### Task 11 — `create_change_request` verb over `MergeRequestService`

**Goal.** Open an MR from any declarative node (A4, use case 4) — the capability is
already 80% built in `mergeRequestService.ts:40-175`.

**Changes.**
- `lib/engine/runtime/effects/verbs/createChangeRequest.ts` (new) — wraps
  `MergeRequestService.create(ctx, branchName?)`; declares required fact `branch`; a node
  without one **fails loudly** with a typed event naming the missing fact + verb (the
  effect-layer analogue of `input_contract_violation`). Journals through `jobs` via the
  existing `onPersist` hook (F2 / Invariant 7).

**Tests.** A declarative node with a `branch` fact + `afterApproval:
["create_change_request"]` opens the MR on approval and persists to the branch row; a node
without the fact fails with the typed event and the MR is not created (no half-established
fact).

### Task 12 — "Open PR" panel action

**Goal.** A direct button, not just approval (use case 4).

**Changes.**
- `genericDeclarativePanel.tsx` — an "Open PR" affordance shown when the node has a
  `branch` fact and the def declares the `create_change_request` capability. Fires a
  typed flow action routed through the TriggerGateway claim (the same path as approval —
  no new dispatch path, Invariant 11).
- `app/api/flows/[id]/action/route.ts` — the action dispatches to the verb via the
  gateway (thin route per AGENTS §3.2).

**Tests.** Clicking "Open PR" on a node with a `branch` fact claims the attempt and runs
the verb; the button is absent without the fact/capability.

### Task 13 — `create_change_request` agent tool + per-node `agent_tools`

**Goal.** A running agent can *ask* to open the MR (C4, use case 4) — "the engine
authoritatively establishes facts," not agent prose claiming success.

**Changes.**
- `lib/engine/agentTools/constants/agentTools.ts` — add `create_change_request` to
  `AGENT_TOOL`; descriptor + Zod payload schema + registry entry (the closed-union
  precedent).
- `declarativeSchemas.ts` — `agent_tools:
  z.array(z.enum(AGENT_TOOL_NAMES)).default(["read_flow_state","report_failure"])`.
- `agentConfigFields.ts` — `agent_tools` field (type `multi`).
- `lib/engine/agentTools/agentToolService.ts` — `authorize` becomes
  `def.agentTools() ∩ node's declared set` (one seam, Invariant 10).

**Tests.** A node whose `agent_tools` includes `create_change_request` lets the agent run
the verb (claims through the authenticated route); a node without it denies with the
typed authorization failure.

### Task 14 — Fact-need lint

**Goal.** A node whose config declares `needs: ["change_request"]` fails lint when no
upstream node can establish one (static `change_request` coverage, design §4.1).

**Changes.**
- `declarativeSchemas.ts` — optional `needs: z.array(z.enum(["change_request","branch"])).default([])`.
- `lib/engine/templates/lintExpressions.ts` — extend the existing output-ref lint: a
  node's `needs` must be satisfiable by some upstream node's `produces`/`effects`
  declarations (graph-walk over the snapshot).

**Tests.** A gate with `needs: ["change_request"]` downstream of an agent with
`effects.afterApproval: ["create_change_request"]` passes; without it, lint fails with a
named unsatisfiable fact.

---

## Phase 4 — Runtime policy knobs + remaining artifact kinds

Per-node tool/secret policy (L5 partial) and the extra artifact renderers the eight use
cases surfaced. Each artifact kind is one registry entry + one renderer — no panel `if`s.

| Done | # | Task | Findings | Use case | Effort | Depends on |
| :---: | --- | --- | --- | --- | :---: | --- |
| [ ] | 15 | `secret_refs` → `AgentStartSpec.env` + scoped prompt resolver | C1 | — | M | 03 |
| [ ] | 16 | Recorded effective tool/MCP policy on the run row | C2 | 6 | S | 13 |
| [ ] | 17 | `retrigger_pipeline` verb + panel button | — | 6 | S | 10 |
| [ ] | 18 | `pipeline` artifact renderer (status/jobs/fix history) | — | 6 | S | 01 |
| [x] | 19 | `review`/`resolve` artifact renderers + `publish_review_comments` verb | — | 7 | M | 10, 01 |
| [ ] | 20 | `failed_output` artifact on retry exhaustion | — | 8e | S | 01 |
| [x] | 21 | `usage` artifact / run-row cost columns (needs approval) | — | 8d | S | 06 |
| [ ] | 22 | `transcript` artifact (capped tool-call log) | — | 8c | M | 01 |
| [ ] | 23 | Dry-run artifact provenance badge | D1 (partial) | 8h | S | 01 |

### Task 15 — `secret_refs` → `AgentStartSpec.env` + scoped prompt resolver

**Goal.** Agent prompts can use secrets without leaking them (C1) — per-node secrets ride
the existing `AgentStartSpec.env` channel (design §7).

**Changes.**
- `declarativeSchemas.ts` — `secret_refs: z.array(z.string()).default([])`; field type
  `multi` (options from the secrets list API).
- `agentTemplateNode.run` — resolve `secret_refs` via `SecretStore` →
  `AgentStartSpec.env` (never persisted, never in the recorded input).
- `lib/engine/shared/templateRenderer.ts` — prompt-level `{{secrets.NAME}}` gets a
  resolver scoped to the declared refs; **fix the silent-`""` hole** (line 56): with a
  resolver present but the value missing, throw (today it silently renders `""` when no
  resolver is supplied — keep that, but a *declared* ref that resolves to nothing must
  fail loudly). `flowVariables.ts:21-23` keeps secrets out of the context map.

**Tests.** A declared secret reaches `env`; a `{{secrets.X}}` with `X` undeclared fails
loudly; a declared-but-missing value throws (no silent `""`); no secret is persisted.

### Task 16 — Recorded effective tool/MCP policy

**Goal.** Cloud-vs-local tool divergence stops being folklore (C2) — the effective set is
recorded, not silent.

**Changes.**
- `agentRunNode.ts` — write the resolved tool/MCP set (the `env` channel's sibling) to the
  run row: `def.agentTools() ∩ declared`, plus the effective `settingSources` the mode
  adapter applied. The cloud adapter's "local-runtime only" drop (`cursor/agentPort.ts:37-39`)
  becomes an explicit recorded decision instead of a silent one.

**Tests.** A cloud run records the ambient layers it used (and that `settingSources` was
dropped by policy); a local run records the layers it loaded.

### Task 17 — `retrigger_pipeline` verb + panel button

**Goal.** A real "retrigger pipeline" action (use case 6) — today only "Re-check" exists
(`PipelineView.tsx:28`), and `host.retryPipeline` (`gitHost.ts:156,228`) is never called
by the gate.

**Changes.**
- `lib/engine/runtime/effects/verbs/retriggerPipeline.ts` (new) — wraps
  `host.retryPipeline(pipelineId)`; required fact `change_request`. Runs under the node's
  claim.
- `PipelineView.tsx` — a "Retrigger pipeline" button when `output.pipelineId` exists and
  status is failed (alongside the existing re-check), dispatching to the verb via the
  gateway.

**Tests.** The button calls `retryPipeline` with the recorded `pipelineId`; the verb
fails loudly without a `change_request` fact.

### Task 18 — `pipeline` artifact renderer

**Goal.** The gate's durable-wait progress renders for any gate node, not just the
built-in `pipeline` def.

**Changes.**
- `artifactRenderers.ts` — register `pipeline → PipelineStatusView`: status badge, job
  list, fix-run history, the retrigger action (task 17). Promote the status/progress UI
  out of `PipelineView.tsx` (which keeps its footer/actions).

**Tests.** A `pipeline` artifact renders status + fix history via the registry; the
built-in `PipelineView` is unchanged (snapshot).

### Task 19 — `review`/`resolve` artifact renderers + `publish_review_comments` verb

**Goal.** A declarative review node renders threads and posts comments (use case 7) —
today these are built-in-only panels.

**Changes.**
- `artifactRenderers.ts` — register `review → ReviewArtifactView` (threads via the shared
  `ThreadList`, promoted from `review/`) and `resolve → ResolveArtifactView` (the
  summary/decisions ledger).
- `lib/engine/runtime/effects/verbs/publishReviewComments.ts` (new) — wraps the posting
  logic from `reviewNode.ts` (inline + summary via the host), keeping the `postedHashes`
  idempotency ledger in the artifact meta. Required fact `change_request`.
- Optional: `review_verdict` as a structured fact in the artifact meta (approve /
  request-changes) so a downstream `decision`/gate consumes it via the output contract
  (Invariant 5), with the artifact as the human-facing projection.

**Tests.** A declarative review node renders threads via the registry; the verb posts
inline comments idempotently (re-running does not double-post); the verdict fact is
consumable by a downstream contract.

### Task 20 — `failed_output` artifact on retry exhaustion

**Goal.** Post-mortem and in-flow reconfiguration see the exact bad output (use case 8e).

**Changes.**
- `agentTemplateNode.finalizeOutput` — when the output pipeline exhausts `retry_budget`,
  save a `failed_output` artifact (raw response head + the schema violations) alongside
  the typed `output_exhausted` event.
- `artifactRenderers.ts` — register `failed_output → FailedOutputView` (raw response +
  violations list).

**Tests.** Exhaustion persists the artifact and the event; the panel renders the bad
output; pairs with task 05 (edit the failed node's config, retry in place).

### Task 21 — `usage` artifact / run-row cost columns (Needs approval)

**Goal.** Flow-level cost becomes a queryable fact (use case 8d) — today `AgentRunUsage`
is ephemeral (`CostChip`).

**Decision needed.** Artifact (kind `usage`, no schema change) vs run-row columns (needs a
`prisma/schema.prisma` migration — AGENTS §1 approval). Default to the artifact unless ops
needs SQL-queryable cost.

**Changes.** Persist `AgentRunUsage` (input/output/cache tokens, cost, model) per run;
register `usage → UsageView`; a flow header rollup sums across runs.

### Task 22 — `transcript` artifact (capped tool-call log)

**Goal.** Long agent runs leave an inspectable record of what tools ran (use case 8c) —
today only the event feed has it.

**Changes.** Capture the agent's tool-call stream (capped like `TASK_PRD_CAP`) as a
`transcript` artifact; register `transcript → TranscriptView` (collapsible timeline).
Complements task 16 (policy = capabilities; transcript = behavior).

### Task 23 — Dry-run artifact provenance badge

**Goal.** A dry-run artifact is never mistaken for a real one (use case 8h) — lands the
renderer half of D1 ahead of the dry-run mode itself.

**Changes.** `artifactRenderers` — a `meta.dryRun: true` flag renders an unmissable badge
on every renderer (one shared wrapper component). No mode yet — just the rendering hook
the dry-run task (26) sets.

---

## Phase 5 — Fan-out & split (LAST, by owner decision)

The structural completions. Nothing here blocks the earlier phases; all of it touches the
stage-ownership axis the EffectRegistry never had.

| Done | # | Task | Findings | Use case | Effort | Depends on |
| :---: | --- | --- | --- | --- | :---: | --- |
| [ ] | 24 | `StageGateRegistry` (fan-out/split re-register; StageRunner slims) | E1 | — | M | 10 |
| [ ] | 25 | Per-step diff facts in the fan-out rollup | — | 8b | S | 07, 24 |
| [ ] | 26 | `subflow` declarative kind on the new gate (needs approval) | B4 | — | L | 24 |
| [ ] | 27 | `"dry-run"` execution mode + promoted fake ports | D1 | 8h | L | 23 |

### Task 24 — `StageGateRegistry`

**Goal.** The hardcoded two-branch chain in `stageRunner.ts:190-195` becomes a registered
axis — a third runtime stops editing engine code (E1).

**Changes.**
- `lib/engine/runtime/staging/stageGateRegistry.ts` (new) —
  `interface StageGate { gate(flowId, nodeKey): Promise<"own" | "run" | { run: true;
  afterRun(): Promise<void> }> }`. `"own"` = the gate ran the stage (skip the def run);
  `"run"` = not mine; `{run, afterRun}` = run the def then post-process (fan-out's
  whole-wrap).
- `stageRunner.ts` — the literal `stepFlows.gate()` → `splitManager.stageGate()` chain
  (190-195) is replaced by registry iteration; `stepFlows` and `splitManager` **register**
  instead of being called. The StageRunner keeps zero fan-out/split knowledge
  (target-architecture §1, completed).

**Invariants.** Invariant 8 — gates claim through the same gateway. Registry-snapshot test
pins the two built-in gates.

### Task 25 — Per-step diff facts in the fan-out rollup

**Goal.** Show a step's individual diff before merge-back (use case 8b) — today only the
merged result is an artifact (`stepRollup.ts:170` attaches the merged diff to the parent).

**Changes.** `stepRollup.ts` — alongside the parent-attached merged diff, capture a
per-step `diff` fact keyed by the step's branch row (`makeDiff` on the child branch,
pre-merge — the merge runs in the arena clone per `mergeArena.ts:50`). `FanoutStepList`
shows "step N's changes vs step base" next to "merged result vs integration base."

**Tests.** A fanned-out run persists one merged `diff` (parent) + one per-step `diff`;
the step card renders the step diff.

### Task 26 — `subflow` declarative kind (Needs approval)

**Goal.** One delegated child flow as a small addition on the new gate, not a new runtime
(B4, design §7).

**Decision needed.** Reuse `FlowKind.step` for the child (least invasive — the
child-creation path already validates start contracts) vs a distinct `FlowKind` (cleaner
if the reconciler/UX ever distinguishes "one delegated child" from "fan-out sibling").
Decide with evidence from tasks 24-25 (design §12.1); enum values are sticky (AGENTS §1).

**Changes.** A declarative `subflow` kind whose config is `{child: templateId,
parallel_max}`; a registered gate expanding **one** child via the existing
`createStepChild`-style path (start-contract-validated payload from `input_map`, the same
validation `flowFactory.ts:131-139` runs); a wildcard `onChildTerminal` rollup publishing
the child's terminal output (or a declared `pass` mapping) as the parent's aggregate.

### Task 27 — `"dry-run"` execution mode

**Goal.** Whole-template simulated execution: real graph, real snapshots, real contracts
and effects, fake side effects (D1).

**Changes.**
- Promote `tests/helpers/fakeAgentPort.ts` + `fakeGitHost.ts` into `lib/`; register them
  under a distinct `dry-run` harness key (the registries forbid duplicate kinds — no
  resolution-context surgery). `flows.executionMode` is already a plain string
  (`schema.prisma:186`) — `"dry-run"` needs no migration.
- Template editor: a "Dry run" button beside "Run" creates a flow with
  `execution_mode="dry-run"`, streams the same events, keeps the run as a trace (or
  deletes it).
- Reconciler/poller MR-duty seams exclude dry-run flows by the mode check already present
  (design §12.3). Sets `meta.dryRun: true` on facts (task 23 renders the badge).

**Tests.** A dry-run flow runs end-to-end on fake ports; no real MR/pipeline is touched;
the provenance badge renders; a registry-snapshot test pins the `dry-run` harness key.

---

## Sequencing rationale

- **Phase 1 first** because it's UI + trivial knobs with no facts/effects machinery — it
  lands the rendering surface (task 01) every later phase renders into, and the two
  config registries (01, 02) mean no later knob touches a shared component.
- **Phase 2 (facts) before Phase 3 (effects)** because facts are what effects and
  resolvers consume — `create_change_request` requires a `branch` fact, so it can't land
  before task 07.
- **Phases 1-2 unlock the eight use cases fastest**: 1/2/3 land in tasks 06-09; 4 lands
  in tasks 10-13; 5 in task 01; 6 in tasks 17-18; 7 in task 19.
- **Phase 5 (fan-out/split) last per owner decision** — it's the structural completion
  with the most coupling (stage ownership), deliberately sequenced after the mechanisms
  it builds on (verbs, facts) exist.
- **Two "Needs approval" items** (21 cost columns, 26 subflow FlowKind) are the only
  tasks touching `prisma/schema.prisma` or a sticky enum — flagged per AGENTS §1.

## What this plan deliberately does NOT do

- **No new storage layer.** Facts persist into artifacts / branch rows / flow MR columns
  (Invariant F2). The only candidate migration (task 21) is flagged "Needs approval" and
  defaults to an artifact instead.
- **No built-in class rewrites.** Compiled declarations (effects, tools, retry budgets)
  stay exactly as compiled; declarative declarations are additive data (registry-snapshot
  pins this, F1/F3).
- **No shim for legacy flows.** Snapshot semantics are untouched; task 05 edits only *this
  flow's* snapshot for not-yet-started nodes (README:152).
- **Security hardening stays in the review backlog's Phase 6** (owner decision); this
  plan's `agent_tools`/secret work is capability-gating, not the deferred auth/hygiene
  tasks.
