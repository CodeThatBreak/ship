# Step 04 — Contract integrity

## Goal

Invariant 5: **contracts all the way down.** Every node kind declares
`outputSchema` **and** `consumes` (the upstream fields it needs). The stage runner
validates materialized input against `consumes` and refuses to proceed on failure
(typed error naming the field and the producing node). Nothing is published
unvalidated — the `finishFanout`/`finishSplit` escape becomes fail-loud. Declarative
nodes get real Zod contracts; `jsonSchemaLite` is deleted. Edge conditions are
lint-checked against producing nodes' output schemas.

## Depends on

Step 02 (terminal writes flow through `publishOutcome`, the enforcement seam).
Step 03 is independent; landing after it is fine but not required.

## Files affected

- Edit: `lib/engine/nodes/shared/nodeDefinition.ts` — add `readonly consumes:
  ZodType<…>` (default empty object) + docs.
- New: `lib/engine/runtime/contractPipeline.ts` — `validateInput(node, materialized)`
  and `validateOutput(node, outcome)`; wired into the stage runner and
  `TransitionAuthority.publishOutcome`.
- Edit: `lib/engine/runtime/edgeActivator.ts` — stage start calls
  `validateInput`; inherited-input merge emits a `log` event on field collision
  (keeps last-wins semantics, decision Q8, but stops hiding it).
- Edit: `flowEngine.ts` `finishFanout`/`finishSplit` — remove the "publishing it
  unvalidated" path; contract failure ⇒ `failed` + typed
  `output_contract_violation` event (retriable), flow does not advance.
- Edit: declarative kinds — `httpNode.ts` (real output schema
  `{status, ok, body, headers}`; JSON-parse fallback emits a `log` event),
  `scriptNode.ts` (declared `output_schema` required to publish; no contract ⇒
  output must be absent; **stdout scavenging deleted**, L192-203),
  `decisionNode.ts` (real output schema), `agentNode.ts` (contract via Zod).
- Edit: `lib/engine/templates/nodeConfig.ts` / node-template boundary — raw JSON
  Schema configs converted to Zod at load via `zod-from-json-schema` (node
  templates keep their JSON-Schema authoring format; conversion happens once at
  the boundary).
- Delete: `lib/engine/nodes/kinds/agent/jsonSchemaLite.ts` (+ tests).
- Edit: `lib/engine/templates/templateLint.ts` — new check: walk edge-condition
  JSONata for `nodes.<key>.output.<field>` references and verify each field exists
  in the producing node's `outputSchema` (reuse the `addressesOutput` machinery
  currently applied only to `{{…}}` refs); surface in
  `app/api/templates/[id]/validate/route.ts`.
- Edit: `lib/db/templateSeeder.ts`, `docs/flow-templates/sdlc-loop.yaml` — the
  `nodes.resolve.output.pushed = true` condition stays (it's correct) but is now
  lint-backed; `tests/flowTemplatesFixtures.test.ts` keeps pinning it.
- Tests: flip `consumesValidation`, `edgeConditionLint`, `unvalidatedAggregate`;
  new `contractPipeline.test.ts`.

## Concrete tasks

1. `consumes` declarations per kind (audit-derived):
   - build: `{ plan: string }` + optional `unit`; review: MR facts; resolve: open
     comments present in input map; pipeline: `mr_iid`/`branch` facts from build
     output; agent/http/script/decision: declare from their config's `input_map`
     targets.
2. `contractPipeline.validateInput` error shape: `InputContractError { nodeKey,
   missingField, producerKey }` → node `failed` with a typed event; the UI
   surfaces producer + field (check `FailureAlert` rendering handles the payload).
3. Wire `validateOutput` into `publishOutcome` for **all** terminal writes —
   including fan-out/split aggregates (this closes the unvalidated-publish escape
   at the single seam).
4. Replace `jsonSchemaLite` usage: agent `output_schema` (JSON Schema in template
   config) → `zod-from-json-schema` at config load, cached on the def; directive
   text keeps using `z.toJSONSchema` output so the agent contract is byte-identical
   to the validator. While writing the real contracts, apply the purity rule: the
   inline schemas in `decisionNode.ts` / `httpNode.ts` / `scriptNode.ts` /
   `agentNode.ts` move into each kind's `schema.ts`, and `buildNode.ts`'s
   `splitUnitItemOf` hand-narrow moves into the kind's `utils/` as a Zod-validated
   parser (this also closes its silent-default hole from the audit). Both leave
   the `domainFolders` allowlist.
5. Script node: delete the last-8-stdout-lines scavenge; output comes only from
   `$DEVFLOW_OUTPUT`; publishing requires a declared `output_schema`; no schema ⇒
   `output: {}` only when the script produced nothing, otherwise
   `output_contract_violation` + `failed`.
6. Template lint: JSONata AST walk for `nodes.*.output.*` in edge conditions;
   unknown key ⇒ problem entry with node/field; validate route returns it;
   fixture test for a bad template rejected.
7. Collision event: when two parents' outputs share a key, emit `log` naming the
   key and producers (observability for the documented last-wins rule).
8. Secret-echo closure (Phase-1 finding A2): http node response bodies pass
   through `secretStore.redact` **before** they become output/artifact data —
   today only event URLs and error text are redacted, so a secret reflected by an
   endpoint persists into `nodes.output` in plaintext. Same pass for the
   response-map path. Test: a response body containing a configured secret is
   stored redacted.

## Libraries used

- `zod-from-json-schema` (MIT, actively maintained) — **new dependency, needs
  approval** (converts template-authored JSON Schema to Zod validators at the
  boundary; the alternative is forcing template authors to write TS, rejected).

## Risks

- **Breaking existing templates**: real contracts for http/script/agent may reject
  payloads that looseObject tolerated. Mitigation: run the lint over every seeded
  template + YAML fixture; migration report in the PR; fix fixtures in the same PR.
- **`zod-from-json-schema` coverage** (it may not support every JSON Schema
  keyword): unsupported keywords ⇒ loud load-time error on the template, never a
  silent pass. Keep `jsonSchemaLite`'s test fixtures as conversion tests.
- **`consumes` too strict on day one** blocks running flows: built-in SDLC flow is
  covered by the happy-path test; custom-template users get the typed error naming
  exactly what to fix (that's the intended UX).
- Over-validating inherited input: `consumes` checks only the fields the node
  declared it needs — do not validate the whole input map against an invented
  schema.

## Acceptance criteria / tests

- Flip green: `consumesValidation.test.ts` (missing field ⇒ `failed` + typed error
  naming producer), `edgeConditionLint.test.ts` (bad template rejected by
  `lintDraft` and the validate route), `unvalidatedAggregate.test.ts` (aggregate
  contract failure ⇒ `failed`, no advance).
- New: `contractPipeline.test.ts` (input + output paths, collision event);
  conversion tests from the old `jsonSchemaLite` fixtures.
- Grep checklist: `"publishing it unvalidated"` gone; `jsonSchemaLite` gone;
  `z.looseObject({})` gone from http/script/decision/agent.
- All seeded templates + `docs/flow-templates/*.yaml` pass the strengthened lint.
- `npm run check` + build green.
