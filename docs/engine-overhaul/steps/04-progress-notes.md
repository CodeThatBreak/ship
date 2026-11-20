# Step 04 — progress notes

Status: **complete** (`npm run check` + `npm run build` green; the step-00
markers for this step flipped).

## What landed

- **ContractPipeline** (`lib/engine/runtime/contractPipeline.ts`): the
  Invariant-5 seam. `validateInput` checks (a) the def's `consumes` schema and
  (b) the template node's `input_map` targets (a mapped expression that
  resolves to nothing now fails loudly instead of silently vanishing);
  `validateOutput` / `validateTerminalOutput` / `validateAggregateOutput`
  guard the terminal writes. Typed errors:
  `lib/engine/errors/inputContractError.ts` (`{nodeKey, missingField,
  producerKey}`) and `outputContractError.ts` (per-path issues). New event
  kinds `input_contract_violation` / `output_contract_violation` in
  `EVENT_KIND` + the `constants/events.ts` client mirror; the feed surfaces
  the message (it names the node, field and producer), structured payload
  rides `eventData`.
- **`NodeDefinition.consumes`** (default `z.object({})`): build (`BuildConsumes`
  — plan/unit/step/feedback with an at-least-one refine, see deviations),
  step_build (same schema), review/pipeline/resolve (deliberately thin
  `branchName`-shaped contracts, see deviations). Declarative kinds keep the
  default and declare their needs through the template node's `input_map`
  targets — validated at the same stage-start seam with best-effort producer
  attribution from the expression's `nodes.<key>.output.*` address.
- **Stage-start refusal**: `FlowEngine.runNode` validates after
  `evalInputMap`, before `parseInput`; on `InputContractError` it emits the
  typed event and rethrows — the stage catch maps to `stageError` (running →
  failed) and skips the duplicate generic error line.
- **Terminal writes**: `TransitionAuthority.publishOutcome` validates every
  success-terminal output against the def's `outputSchema` (defs resolved
  through `bindOutcomeContracts`, bound by the FlowEngine at construction —
  the authority never learns how defs hydrate). `publishAggregate` validates
  the fan-out/split aggregate against the def's
  `fanoutOutput`/`splitOutput` capability (generic defaults moved next to
  each other in `nodes/shared/capabilities.ts`) and maps a violation itself:
  typed event + failed terminal, returns `false` — the runtime managers'
  finish paths stay linear and never advance on unvalidated data. The
  `finishFanout`/`finishSplit` swallow-and-publish escape is gone.
  `NodeDefinition.applyOutcome` maps an `outputSchema` violation (including
  the pre-validation it already did) to the typed event + a failed terminal
  via `failOutputContract`. Failed/skipped terminal writes are exempt from
  output validation — the violation detail travels in the event, not the
  output column.
- **Declarative kinds got real Zod contracts** (each in its own
  `schema.ts`; the inline schemas left the class files):
  - agent: markdown → `{markdown: string}`; json+`output_schema` →
    `zod-from-json-schema` conversion at config load (the def cache holds
    instances, so the conversion is once per instance); json without a schema
    → `z.record(z.string(), z.unknown())`. The prompt directive now carries
    `z.toJSONSchema(this.outputSchema)` — the advertised schema is
    byte-identical to the validator. `applyOutput` validates via the Zod
    contract and throws the same `AgentOutputError` payload (issues mapped
    from Zod; wording changed accordingly in two tests).
  - http: strict default contract `{status, ok, body, headers}`;
    `response_map` outputs validate as records (the mapped shape is
    unknowable statically — mapResponse already enforces object-ness).
  - script: `$DEVFLOW_OUTPUT` is the ONLY output channel — the last-8-stdout
    -lines scavenge is deleted and the node `-e` wrapper writes a top-level
    `return` value to the file instead of printing it. Publishing rule: no
    declared schema + produced output ⇒ typed `output_contract_violation` +
    failed; nothing produced ⇒ `{}` publishes; declared schema + wrong shape
    ⇒ the contract machinery fails it typed.
  - decision: `{chosen: string[], rationale?}` strict + one optional
    `z.unknown()` field per `pass` key; `applyChoice` now validates the
    choose-branch patch through the contract before the transition (the
    patch path was an unvalidated output write).
- **`jsonSchemaLite` deleted**; `extractJson` importers repointed to
  `nodes/shared/extractJson`; its fixtures live on as
  `jsonSchemaToZod` conversion tests (`agentOutputError.test.ts`,
  `lib/engine/templates/jsonSchemaToZod.test.ts`).
- **Template lint**: `lib/jsonata/nodeOutputRefs.ts` walks the compiled
  JSONata AST for `nodes.<key>.output.<field>` paths (wildcard/descendant
  free-pass); `templateLint.ts` runs edge/loop-condition refs through the
  same `addressesOutput` contract map — unknown node or field ⇒ save/validate
  rejects. **While wiring this we found and fixed a pre-existing lint bug**:
  `addressesOutput` was called with the `nodes.`-prefixed ref, so its first
  segment lookup always missed and the `{{nodes.*.output.*}}` field check was
  vacuous (only decision refs were enforced) — the root segment is now
  stripped at both call sites, so template refs are genuinely checked too.
- **Collision observability (decision Q8)**: `EdgeActivator.inheritedInput`
  tracks which parent supplied each field and emits a `log` event naming
  colliding keys + producers when several parents publish the same key
  (last-wins semantics unchanged, no longer hidden).
- **Secret-echo closure (Phase-1 finding A2)**: the http node redacts the raw
  response body via `secretStore.redact` BEFORE parsing — the default output,
  the `response_map` input, the artifact digest and the reply all carry
  redacted text; previously only event URLs and error text were redacted, so
  a secret reflected by an endpoint persisted into `nodes.output` in
  plaintext. Pure seam in `http/utils/redactResponseBody.ts` (+ test); the
  JSON-parse fallback now also emits a `log` event.
- **`buildNode` `splitUnitItemOf`** → `build/utils/splitUnitItem.ts` as a
  Zod-validated parser (`build/schema.ts` carries `SplitUnitItem`): a present
  but malformed unit now throws instead of silently falling through to the
  plan-based build; the title→name and scope→"" silent defaults are gone.
- **Tests**: flipped `consumesValidation` (skip → real, engine-level via the
  seeded `nt_st_summarize`/`nt_st_write_doc` pair — the docs-generation
  shape), `edgeConditionLint` (fails → green, against `nt_st_triage`'s real
  contract + a good-case test), `unvalidatedAggregate` (fails → green). New:
  `contractPipeline.test.ts` (14 cases), `jsonSchemaToZod.test.ts`,
  `redactResponseBody.test.ts`.
- **Fixture migration report** (the step's breaking-contracts mitigation):
  `docs/flow-templates/docs-generation.yaml` + the seeder's `nt_st_write_doc`
  script now write `{"written":true}` to `$DEVFLOW_OUTPUT` and declare an
  `output_schema`. Every other fixture audited clean (sentry-triage declares
  a schema; open_pr/release-notes/review-notes are markdown agents; http
  templates fit the default contract; only sdlc-loop carries an edge
  condition and free-passes as a builtin contract).
- **New dependency (approved)**: `zod-from-json-schema@0.5.6` (MIT; zod ^4
  peer — matches our zod 4.6.7).

## Design calls worth knowing

- **`BuildConsumes` is not the audit's literal `{plan: string}`**: the
  engine-constructed inputs legitimately arrive as `plan: null` +
  `feedback` (commit-fix, merge-fix), a `step` payload (fan-out children),
  or a split `unit` — so the schema is nullable-optional members with an
  at-least-one refine. A literal `{plan}` contract would have failed the
  commit-fix loop (the risk the step doc warns about: "consumes too strict
  on day one blocks running flows").
- **review/pipeline/resolve consumes are deliberately thin** (`branchName`
  /`pipelineId` overrides): the audit's "MR facts" / "open comments in input
  map" are flow-state facts — the MR resolves via `mrTargetResolver` at run
  time and the comments live in the comment store, not the input map. The
  typed seam gets its real workout on the declarative `input_map` targets
  and the aggregates.
- **Aggregate failures map inside the authority** (`publishAggregate` →
  typed event + `stageError` + `false`), while `publishOutcome` throws and
  the def-side `applyOutcome` maps — the def owns its attempt fencing, the
  aggregate publish has none of the caller's context.
- **`unvalidatedAggregate`/`fanoutAggregatePublish` fixtures fixed**: the
  step-02 aggregate test had published `steps: [{key: …}]` — a shape the
  fanout contract (`id`, not `key`) rejects — and only passed because the
  old code published unvalidated. The fixtures now carry contract-conforming
  steps; the tests' semantics (publish through the declared transition, stale
  publish loses) are unchanged.
- **UI**: `FailureAlert` is the plan panel's static alert, not an event
  renderer — no payload handling to extend; the feed renders the typed
  events' messages (which carry producer + field) out of the box. Structured
  `{field, producer}` / `{issues}` payloads sit in `eventData` for future UI
  work.
- **Size gates**: moving the HMR brand + type guard out of
  `nodeDefinition.ts` (`nodeDefinitionGuard.ts`) and the aggregate-failure
  helper into the authority kept every touched engine file under its frozen
  ceiling without touching the shrink-only lists' semantics; the purity and
  schema allowlists SHRANK (buildNode, httpNode, splitManager,
  decision/http/script schema entries removed).

## Deviations / flags for review

- **Script stdout is no longer an output channel** — a breaking change for
  user scripts that printed their output JSON: they must write
  `$DEVFLOW_OUTPUT` (the node `-e` wrapper's `return` value is re-channeled
  automatically) or declare an `output_schema` and produce nothing. The
  config-field help strings and the class contract doc now say so.
- **Declarative `consumes` lives on the template node's `input_map`**, not on
  the def: `input_map` is per flow-template-node data, unavailable at def
  hydration — the ContractPipeline takes it as a stage-time option. A
  declarative node without `input_map` consumes nothing (unchanged
  inheritance semantics for `{{input.*}}` prompt refs).
- **Agent prompt bytes change** for json-output agents WITH a schema: the
  directive now carries `z.toJSONSchema(converted)` (adds the draft-2020-12
  `$schema` marker, normalizes `integer` bounds) — that is the step's
  "byte-identical to the validator" requirement, not a regression.
- The audit's "resolve: open comments present in input map" was not
  implementable as stated (comments come from the store) — documented above.
- `templateLint.ts` remains over the 400-line guideline (frozen giant, pin
  712, now ~708); the lint split is the step-04 entry in the decomposition
  table's spirit — the growth here is the new check only.
- Pre-existing: plan's `(empty response)` markdown fabrication stays (step
  05's output-pipeline scope); `planOutput?.model ?? undefined` read stays
  (step 05 routes it through the pipeline).
